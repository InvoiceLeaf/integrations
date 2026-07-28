import type { Document, IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import { firstFinite, toBoundedInt, toDateOnly, toErrorMessage, toFiniteNumber, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type {
  PaypalIntegrationConfig,
  PaypalPushSyncState,
  PushFailure,
  PushInvoicesResult,
} from '../types.js';
import type { PaypalClient, PaypalInvoiceCreatePayload } from '../paypal/client.js';
import { createPaypalClient, SYSTEM } from './auth.js';

const ENTITY_INVOICE = 'invoice';
const SYNC_STATE_KEY = 'paypal:pushLastSyncAt';
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_MAX_PUSH_PER_RUN = 50;
const PAGE_SIZE = 50;
const MAX_REPORTED_FAILURES = 25;

/**
 * Pushes InvoiceLeaf receivable invoices to PayPal as invoices so customers
 * can pay them there. Payments collected in PayPal flow back through the
 * payment sync, which allocates them to the original document via the
 * mapping created here (marking it paid).
 */
export const pushInvoicesToPaypal: IntegrationHandler<
  ScheduleInput,
  PushInvoicesResult,
  PaypalIntegrationConfig
> = async (_input, context: IntegrationContext<PaypalIntegrationConfig>): Promise<PushInvoicesResult> => {
  const startedAt = new Date().toISOString();
  const failures: PushFailure[] = [];

  const resultBase: Omit<PushInvoicesResult, 'success' | 'message' | 'error'> = {
    startedAt,
    completedAt: startedAt,
    processed: 0,
    pushed: 0,
    skipped: 0,
    failed: 0,
    failures,
    checkpointUpdated: false,
  };

  try {
    const client = await createPaypalClient(context);

    const lookbackHours = toBoundedInt(context.config.initialSyncLookbackHours, DEFAULT_LOOKBACK_HOURS, 1, 720);
    const maxPushPerRun = toBoundedInt(context.config.maxPushPerRun, DEFAULT_MAX_PUSH_PER_RUN, 1, 500);
    const autoSend = context.config.autoSendInvoices ?? false;
    const includeDrafts = context.config.includeDraftDocuments ?? false;

    const fallbackFromDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
    let fromDate = fallbackFromDate;
    try {
      const syncState = await context.state.get<PaypalPushSyncState>(SYNC_STATE_KEY);
      const checkpointValue = syncState?.lastSuccessfulSyncAt;
      if (checkpointValue && Number.isFinite(Date.parse(checkpointValue))) {
        fromDate = checkpointValue;
      }
    } catch (stateError) {
      context.logger.warn('Could not read PayPal push checkpoint; using fallback lookback window.', {
        key: SYNC_STATE_KEY,
        error: toErrorMessage(stateError),
      });
    }

    let page = 1;
    let hasMore = true;
    while (hasMore && resultBase.processed < maxPushPerRun) {
      const parsedStartDate = Date.parse(fromDate);
      const pageResult = await context.data.listDocuments({
        startDate: Number.isFinite(parsedStartDate) ? parsedStartDate : Date.parse(fallbackFromDate),
        page,
        limit: Math.min(PAGE_SIZE, maxPushPerRun - resultBase.processed),
      });

      if (pageResult.items.length === 0) {
        break;
      }

      for (const document of pageResult.items) {
        if (resultBase.processed >= maxPushPerRun) {
          break;
        }
        resultBase.processed += 1;

        if (!isPushableDocument(document, includeDrafts)) {
          resultBase.skipped += 1;
          continue;
        }

        try {
          const outcome = await pushDocument(context, client, document, { autoSend });
          if (outcome === 'pushed') {
            resultBase.pushed += 1;
          } else {
            resultBase.skipped += 1;
          }
        } catch (error) {
          resultBase.failed += 1;
          const message = toErrorMessage(error);
          if (failures.length < MAX_REPORTED_FAILURES) {
            failures.push({ documentId: document.id, reason: message });
          }
          context.logger.error('Failed to push document to PayPal', {
            documentId: document.id,
            error: message,
          });

          try {
            await context.data.patchDocumentIntegrationMeta({
              documentId: document.id,
              system: SYSTEM,
              status: 'failed',
              lastSyncedAt: new Date().toISOString(),
              errorSummary: message.slice(0, 500),
            });
          } catch (metaError) {
            context.logger.warn('Failed to patch document sync metadata after PayPal push error', {
              documentId: document.id,
              error: toErrorMessage(metaError),
            });
          }
        }
      }

      hasMore = pageResult.hasMore;
      page += 1;
    }

    const completedAt = new Date().toISOString();
    if (resultBase.failed === 0) {
      try {
        await context.state.set<PaypalPushSyncState>(SYNC_STATE_KEY, {
          lastSuccessfulSyncAt: completedAt,
        });
        resultBase.checkpointUpdated = true;
      } catch (stateError) {
        context.logger.warn('Could not persist PayPal push checkpoint.', {
          key: SYNC_STATE_KEY,
          error: toErrorMessage(stateError),
        });
      }
    }

    return {
      ...resultBase,
      completedAt,
      success: resultBase.failed === 0,
      message:
        resultBase.failed === 0
          ? `Pushed ${resultBase.pushed} invoice(s) to PayPal.`
          : `Pushed invoices to PayPal with ${resultBase.failed} failure(s).`,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('PayPal push run failed', { error: message });
    return {
      ...resultBase,
      completedAt: new Date().toISOString(),
      success: false,
      error: message,
    };
  }
};

function isPushableDocument(document: Document, includeDrafts: boolean): boolean {
  if (!document.id || document.deleted || trimToUndefined(document.duplicateOfId)) {
    return false;
  }
  // Only receivable invoices are pushed: PayPal collects money owed to the user.
  if (document.accountingType !== 'RECEIVABLE') {
    return false;
  }
  if (document.documentStatus === 'CANCELLED') {
    return false;
  }
  if (!includeDrafts && document.documentStatus === 'DRAFT') {
    return false;
  }
  // Already (partially) paid invoices are not pushed; collecting the full
  // amount again through PayPal would double-charge the customer.
  if (document.paymentStatus === 'PAID' || document.paymentStatus === 'PARTIAL') {
    return false;
  }
  const amount = firstFinite(document.totalAmount, document.amountDue, document.netAmount);
  if (amount === undefined || amount === 0) {
    return false;
  }
  return true;
}

async function pushDocument(
  context: IntegrationContext<PaypalIntegrationConfig>,
  client: PaypalClient,
  document: Document,
  options: { autoSend: boolean }
): Promise<'pushed' | 'skipped'> {
  // A mapping in either direction means this document already exists in
  // PayPal: outbound (pushed before) or inbound (imported FROM PayPal, which
  // must never be pushed back; that would loop).
  const existingMapping = await context.mappings.get({
    system: SYSTEM,
    entity: ENTITY_INVOICE,
    localId: document.id,
  });
  if (existingMapping?.externalId) {
    return 'skipped';
  }
  if (document.uploadSource === 'paypal') {
    return 'skipped';
  }

  const currency = (trimToUndefined(document.currency?.code) ?? 'EUR').toUpperCase();
  const invoiceNumber = trimToUndefined(document.invoiceId) ?? document.id;
  const invoiceDate = toDateOnly(document.invoiceDate);
  const dueDate = toDateOnly(document.dueDate);

  const payload: PaypalInvoiceCreatePayload = {
    detail: {
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      currency_code: currency,
      note: trimToUndefined(document.description)?.slice(0, 500),
      payment_term: dueDate ? { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: dueDate } : undefined,
    },
    primary_recipients: buildRecipients(document),
    items: buildPaypalItems(document, currency),
  };

  const invoiceId = await client.createDraftInvoice(payload);

  if (options.autoSend) {
    await client.sendInvoice(invoiceId);
  }

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_INVOICE,
    localId: document.id,
    externalId: invoiceId,
    metadata: {
      direction: 'outbound',
      invoiceNumber: trimToUndefined(document.invoiceId) ?? null,
      sent: options.autoSend,
    },
  });

  await context.data.patchDocumentIntegrationMeta({
    documentId: document.id,
    system: SYSTEM,
    externalId: invoiceId,
    status: 'synced',
    lastSyncedAt: new Date().toISOString(),
    metadata: {
      direction: 'outbound',
      paypalInvoiceId: invoiceId,
      sent: options.autoSend,
    },
  });

  return 'pushed';
}

function buildRecipients(document: Document): PaypalInvoiceCreatePayload['primary_recipients'] {
  const company = document.receiver ?? undefined;
  const name = trimToUndefined(company?.name);
  const email = trimToUndefined(company?.email);
  if (!name && !email) {
    return undefined;
  }
  return [
    {
      billing_info: {
        business_name: name,
        email_address: email,
      },
    },
  ];
}

function buildInvoiceDescription(document: Document): string {
  const invoiceNumber = trimToUndefined(document.invoiceId);
  const description = trimToUndefined(document.description);
  if (invoiceNumber && description) {
    return `${invoiceNumber}: ${description}`.slice(0, 200);
  }
  return (description ?? (invoiceNumber ? `Invoice ${invoiceNumber}` : `InvoiceLeaf document ${document.id}`)).slice(0, 200);
}

/**
 * PayPal amounts are decimal strings in the currency's major unit, so no
 * cent conversion is needed, only formatting.
 */
function toDecimalString(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function buildPaypalItems(document: Document, currency: string): PaypalInvoiceCreatePayload['items'] {
  const items: PaypalInvoiceCreatePayload['items'] = [];
  for (const item of document.lineItems ?? []) {
    const quantityRaw = Math.abs(toFiniteNumber(item.quantity, 1)) || 1;
    const unit = toFiniteNumber(item.unitAmount, Number.NaN);
    let quantity: number;
    let unitAmount: number;
    if (Number.isFinite(unit) && unit !== 0) {
      quantity = quantityRaw;
      unitAmount = Math.abs(unit);
    } else {
      const amount = firstFinite(item.totalAmount, item.netAmount) ?? 0;
      if (amount === 0) {
        continue;
      }
      quantity = 1;
      unitAmount = Math.abs(amount);
    }
    items.push({
      name: trimToUndefined(item.name) ?? buildInvoiceDescription(document),
      quantity: String(quantity),
      unit_amount: { currency_code: currency, value: toDecimalString(unitAmount) },
    });
  }
  if (items.length > 0) {
    return items;
  }

  const fallbackAmount = firstFinite(document.totalAmount, document.amountDue, document.netAmount);
  if (fallbackAmount === undefined || fallbackAmount === 0) {
    throw new Error(
      `Document ${document.id} has no line items and no valid amount. Cannot create a PayPal invoice with 0.`
    );
  }
  return [
    {
      name: buildInvoiceDescription(document),
      quantity: '1',
      unit_amount: { currency_code: currency, value: toDecimalString(Math.abs(fallbackAmount)) },
    },
  ];
}
