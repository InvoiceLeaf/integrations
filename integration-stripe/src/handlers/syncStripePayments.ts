import type { IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import { toBoundedInt, toErrorMessage, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type {
  PaymentSyncResult,
  StripeChargeSyncState,
  StripeIntegrationConfig,
  SyncFailure,
} from '../types.js';
import type { StripeCharge } from '../stripe/client.js';
import { StripeClient, stripeAmountToDecimalString } from '../stripe/client.js';

const SYSTEM = 'stripe';
const ENTITY_INVOICE = 'invoice';
const ENTITY_PAYMENT = 'payment';
const SYNC_STATE_KEY = 'stripe:chargesLastSyncAt';
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_MAX_CHARGES_PER_RUN = 100;
const PAGE_SIZE = 100;
const MAX_REPORTED_FAILURES = 25;

export const syncStripePayments: IntegrationHandler<
  ScheduleInput,
  PaymentSyncResult,
  StripeIntegrationConfig
> = async (_input, context: IntegrationContext<StripeIntegrationConfig>): Promise<PaymentSyncResult> => {
  const startedAt = new Date().toISOString();
  const failures: SyncFailure[] = [];

  const resultBase: Omit<PaymentSyncResult, 'success' | 'message' | 'error'> = {
    startedAt,
    completedAt: startedAt,
    processed: 0,
    recorded: 0,
    allocated: 0,
    unmatched: 0,
    skipped: 0,
    failed: 0,
    failures,
    checkpointUpdated: false,
  };

  try {
    const apiKey = await context.credentials.getApiKey(SYSTEM);
    const client = new StripeClient(apiKey, trimToUndefined(context.config.apiBaseUrl));

    const lookbackHours = toBoundedInt(context.config.initialSyncLookbackHours, DEFAULT_LOOKBACK_HOURS, 1, 720);
    const maxChargesPerRun = toBoundedInt(context.config.maxChargesPerRun, DEFAULT_MAX_CHARGES_PER_RUN, 1, 1000);
    const recordUnmatched = context.config.recordUnmatchedCharges ?? true;

    const fallbackCreatedGt = Math.floor(Date.now() / 1000) - lookbackHours * 3600;
    let createdGt = fallbackCreatedGt;
    try {
      const syncState = await context.state.get<StripeChargeSyncState>(SYNC_STATE_KEY);
      if (syncState && Number.isFinite(syncState.lastCreatedAt) && syncState.lastCreatedAt > 0) {
        createdGt = syncState.lastCreatedAt;
      }
    } catch (stateError) {
      context.logger.warn('Could not read Stripe charge sync checkpoint; using fallback lookback window.', {
        key: SYNC_STATE_KEY,
        error: toErrorMessage(stateError),
      });
    }

    const charges: StripeCharge[] = [];
    let startingAfter: string | undefined;
    let exhaustedWindow = false;
    for (;;) {
      const page = await client.listCharges({ createdGt, startingAfter, limit: PAGE_SIZE });
      charges.push(...page.data);
      if (!page.has_more || page.data.length === 0) {
        exhaustedWindow = true;
        break;
      }
      if (charges.length >= maxChargesPerRun) {
        break;
      }
      startingAfter = page.data[page.data.length - 1]!.id;
    }

    charges.sort((a, b) => a.created - b.created);
    const toProcess = exhaustedWindow ? charges : charges.slice(0, maxChargesPerRun);

    let maxFullyProcessedCreated = 0;
    let sawFailure = false;

    for (const charge of toProcess) {
      resultBase.processed += 1;
      try {
        const outcome = await recordCharge(context, charge, recordUnmatched);
        if (outcome === 'allocated') {
          resultBase.recorded += 1;
          resultBase.allocated += 1;
        } else if (outcome === 'unmatched') {
          resultBase.recorded += 1;
          resultBase.unmatched += 1;
        } else {
          resultBase.skipped += 1;
        }
        if (!sawFailure) {
          maxFullyProcessedCreated = Math.max(maxFullyProcessedCreated, charge.created);
        }
      } catch (error) {
        sawFailure = true;
        resultBase.failed += 1;
        if (failures.length < MAX_REPORTED_FAILURES) {
          failures.push({ externalId: charge.id, reason: toErrorMessage(error) });
        }
        context.logger.error('Stripe charge sync failed', {
          chargeId: charge.id,
          error: toErrorMessage(error),
        });
      }
    }

    if (maxFullyProcessedCreated > createdGt) {
      try {
        await context.state.set<StripeChargeSyncState>(SYNC_STATE_KEY, {
          lastCreatedAt: maxFullyProcessedCreated,
        });
        resultBase.checkpointUpdated = true;
      } catch (stateError) {
        context.logger.warn('Could not persist Stripe charge sync checkpoint.', {
          key: SYNC_STATE_KEY,
          error: toErrorMessage(stateError),
        });
      }
    }

    const completedAt = new Date().toISOString();
    return {
      ...resultBase,
      completedAt,
      success: resultBase.failed === 0,
      message:
        resultBase.failed === 0
          ? `Recorded ${resultBase.recorded} Stripe payment(s) (${resultBase.allocated} allocated to invoices).`
          : `Recorded Stripe payments with ${resultBase.failed} failure(s).`,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('Stripe payment sync run failed', { error: message });
    return {
      ...resultBase,
      completedAt: new Date().toISOString(),
      success: false,
      error: message,
    };
  }
};

async function recordCharge(
  context: IntegrationContext<StripeIntegrationConfig>,
  charge: StripeCharge,
  recordUnmatched: boolean
): Promise<'allocated' | 'unmatched' | 'skipped'> {
  if (charge.paid !== true || (charge.status ?? '').toLowerCase() !== 'succeeded') {
    return 'skipped';
  }

  const existing = await context.mappings.findByExternal({
    system: SYSTEM,
    entity: ENTITY_PAYMENT,
    externalId: charge.id,
  });
  if (existing?.localId) {
    return 'skipped';
  }

  // Resolve the InvoiceLeaf document when this charge pays a Stripe invoice
  // that a previous run imported.
  let allocatedDocumentId: string | undefined;
  const stripeInvoiceId = trimToUndefined(charge.invoice ?? undefined);
  if (stripeInvoiceId) {
    const invoiceMapping = await context.mappings.findByExternal({
      system: SYSTEM,
      entity: ENTITY_INVOICE,
      externalId: stripeInvoiceId,
    });
    if (invoiceMapping?.localId) {
      allocatedDocumentId = invoiceMapping.localId;
    }
  }

  if (!allocatedDocumentId && !recordUnmatched) {
    return 'skipped';
  }

  const amount = stripeAmountToDecimalString(charge.amount, charge.currency);
  const paymentDate = new Date(charge.created * 1000).toISOString().slice(0, 10);
  const payerName = trimToUndefined(charge.billing_details?.name ?? undefined);

  const created = await context.payments.create({
    paymentDate,
    amount,
    currency: charge.currency.toUpperCase(),
    direction: 'INCOMING',
    reference: `Stripe charge ${charge.id}`,
    notes: buildPaymentNotes(charge, payerName),
    externalRef: `stripe:charge:${charge.id}`,
    allocations: allocatedDocumentId
      ? [{ documentId: allocatedDocumentId, amount }]
      : undefined,
  });

  if (created.allocationError) {
    context.logger.warn('Stripe payment recorded but allocation failed; payment left unmatched.', {
      chargeId: charge.id,
      paymentId: created.paymentId,
      allocationError: created.allocationError,
    });
  }

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_PAYMENT,
    localId: created.paymentId,
    externalId: charge.id,
    metadata: {
      stripeInvoiceId: stripeInvoiceId ?? null,
      allocatedDocumentId: allocatedDocumentId ?? null,
      amount,
      currency: charge.currency.toUpperCase(),
      refunded: charge.refunded ?? false,
      duplicate: created.duplicate,
      allocationError: created.allocationError ?? null,
    },
  });

  return allocatedDocumentId && !created.allocationError ? 'allocated' : 'unmatched';
}

function buildPaymentNotes(charge: StripeCharge, payerName: string | undefined): string {
  const parts: string[] = [];
  if (payerName) {
    parts.push(`Payer: ${payerName}`);
  }
  const description = trimToUndefined(charge.description ?? undefined);
  if (description) {
    parts.push(description);
  }
  if (charge.refunded) {
    parts.push('Note: this charge was later refunded in Stripe.');
  }
  const receiptUrl = trimToUndefined(charge.receipt_url ?? undefined);
  if (receiptUrl) {
    parts.push(`Receipt: ${receiptUrl}`);
  }
  return parts.join('\n');
}
