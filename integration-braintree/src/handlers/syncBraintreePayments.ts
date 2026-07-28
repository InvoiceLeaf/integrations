import type { IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import { toBoundedInt, toDateOnly, toErrorMessage, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type {
  BraintreeIntegrationConfig,
  BraintreeTransactionSyncState,
  PaymentSyncResult,
  SyncFailure,
} from '../types.js';
import type { BraintreeTransaction } from '../braintree/client.js';
import { SYSTEM, createBraintreeClient } from '../braintree/connection.js';

const ENTITY_PAYMENT = 'payment';
const SYNC_STATE_KEY = 'braintree:transactionsLastSyncAt';
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_MAX_TRANSACTIONS_PER_RUN = 100;
const PAGE_SIZE = 50;
const MAX_REPORTED_FAILURES = 25;
const MATCH_LOOKUP_LIMIT = 10;

interface RecordOptions {
  includeSubmittedForSettlement: boolean;
  matchByOrderId: boolean;
  recordUnmatched: boolean;
}

export const syncBraintreePayments: IntegrationHandler<
  ScheduleInput,
  PaymentSyncResult,
  BraintreeIntegrationConfig
> = async (_input, context: IntegrationContext<BraintreeIntegrationConfig>): Promise<PaymentSyncResult> => {
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
    const client = await createBraintreeClient(context);

    const lookbackHours = toBoundedInt(context.config.initialSyncLookbackHours, DEFAULT_LOOKBACK_HOURS, 1, 720);
    const maxTransactionsPerRun = toBoundedInt(
      context.config.maxTransactionsPerRun,
      DEFAULT_MAX_TRANSACTIONS_PER_RUN,
      1,
      1000
    );
    const options: RecordOptions = {
      includeSubmittedForSettlement: context.config.includeSubmittedForSettlement ?? true,
      matchByOrderId: context.config.matchByOrderId ?? true,
      recordUnmatched: context.config.recordUnmatchedTransactions ?? true,
    };

    const fallbackCreatedAtGte = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString();
    let createdAtGte = fallbackCreatedAtGte;
    try {
      const syncState = await context.state.get<BraintreeTransactionSyncState>(SYNC_STATE_KEY);
      const checkpoint = trimToUndefined(syncState?.lastCreatedAt);
      if (checkpoint && Number.isFinite(Date.parse(checkpoint))) {
        createdAtGte = checkpoint;
      }
    } catch (stateError) {
      context.logger.warn('Could not read Braintree transaction sync checkpoint; using fallback lookback window.', {
        key: SYNC_STATE_KEY,
        error: toErrorMessage(stateError),
      });
    }

    // Collect the window first so we can process oldest-first and only
    // advance the checkpoint over a fully processed prefix. The filter is
    // inclusive (greaterThanOrEqualTo), so the checkpoint transaction is
    // re-fetched next run and skipped via mapping dedupe.
    const transactions: BraintreeTransaction[] = [];
    let after: string | undefined;
    let exhaustedWindow = false;
    for (;;) {
      const page = await client.searchTransactions({ createdAtGte, first: PAGE_SIZE, after });
      transactions.push(...page.transactions);
      if (!page.hasNextPage || page.transactions.length === 0) {
        exhaustedWindow = true;
        break;
      }
      if (transactions.length >= maxTransactionsPerRun) {
        break;
      }
      after = page.endCursor ?? undefined;
    }

    transactions.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const toProcess = exhaustedWindow ? transactions : transactions.slice(0, maxTransactionsPerRun);

    let maxFullyProcessedCreatedAt: string | null = null;
    let sawFailure = false;

    for (const transaction of toProcess) {
      resultBase.processed += 1;
      try {
        const outcome = await recordTransaction(context, transaction, options);
        if (outcome === 'allocated') {
          resultBase.recorded += 1;
          resultBase.allocated += 1;
        } else if (outcome === 'unmatched') {
          resultBase.recorded += 1;
          resultBase.unmatched += 1;
        } else {
          resultBase.skipped += 1;
        }
        if (
          !sawFailure &&
          (maxFullyProcessedCreatedAt === null ||
            Date.parse(transaction.createdAt) > Date.parse(maxFullyProcessedCreatedAt))
        ) {
          maxFullyProcessedCreatedAt = transaction.createdAt;
        }
      } catch (error) {
        sawFailure = true;
        resultBase.failed += 1;
        if (failures.length < MAX_REPORTED_FAILURES) {
          failures.push({ externalId: transaction.id, reason: toErrorMessage(error) });
        }
        context.logger.error('Braintree transaction sync failed', {
          transactionId: transaction.id,
          error: toErrorMessage(error),
        });
      }
    }

    // Advance the checkpoint only across the contiguous, fully processed
    // prefix; failed or unprocessed transactions are retried next run
    // (payment creation is idempotent via mapping + externalRef dedupe).
    if (maxFullyProcessedCreatedAt !== null && Date.parse(maxFullyProcessedCreatedAt) > Date.parse(createdAtGte)) {
      try {
        await context.state.set<BraintreeTransactionSyncState>(SYNC_STATE_KEY, {
          lastCreatedAt: maxFullyProcessedCreatedAt,
        });
        resultBase.checkpointUpdated = true;
      } catch (stateError) {
        context.logger.warn('Could not persist Braintree transaction sync checkpoint.', {
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
          ? `Recorded ${resultBase.recorded} Braintree payment(s) (${resultBase.allocated} allocated to invoices).`
          : `Recorded Braintree payments with ${resultBase.failed} failure(s).`,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('Braintree payment sync run failed', { error: message });
    return {
      ...resultBase,
      completedAt: new Date().toISOString(),
      success: false,
      error: message,
    };
  }
};

function isRecordableStatus(status: string, includeSubmittedForSettlement: boolean): boolean {
  if (status === 'SETTLED' || status === 'SETTLING') {
    return true;
  }
  if (status === 'SUBMITTED_FOR_SETTLEMENT') {
    return includeSubmittedForSettlement;
  }
  return false;
}

async function recordTransaction(
  context: IntegrationContext<BraintreeIntegrationConfig>,
  transaction: BraintreeTransaction,
  options: RecordOptions
): Promise<'allocated' | 'unmatched' | 'skipped'> {
  const status = (transaction.status ?? '').toUpperCase();
  if (!isRecordableStatus(status, options.includeSubmittedForSettlement)) {
    return 'skipped';
  }

  const existing = await context.mappings.findByExternal({
    system: SYSTEM,
    entity: ENTITY_PAYMENT,
    externalId: transaction.id,
  });
  if (existing?.localId) {
    return 'skipped';
  }

  const amount = trimToUndefined(transaction.amount?.value);
  if (!amount) {
    throw new Error(`Braintree transaction ${transaction.id} has no amount.`);
  }
  const currency = trimToUndefined(transaction.amount?.currencyCode)?.toUpperCase();
  if (!currency) {
    throw new Error(`Braintree transaction ${transaction.id} has no currency code.`);
  }
  const paymentDate = toDateOnly(transaction.createdAt);
  if (!paymentDate) {
    throw new Error(`Braintree transaction ${transaction.id} has an invalid createdAt: ${transaction.createdAt}`);
  }

  // Resolve the InvoiceLeaf document whose invoice number equals the
  // transaction's orderId. Only an unambiguous (single) exact match is
  // allocated; zero or multiple matches leave the payment unmatched.
  const orderId = trimToUndefined(transaction.orderId ?? undefined);
  let allocatedDocumentId: string | undefined;
  if (options.matchByOrderId && orderId) {
    const documents = await context.data.listDocuments({ search: orderId, limit: MATCH_LOOKUP_LIMIT });
    const matches = documents.items.filter((document) => document.invoiceId === orderId);
    if (matches.length === 1) {
      allocatedDocumentId = matches[0]!.id;
    }
  }

  if (!allocatedDocumentId && !options.recordUnmatched) {
    return 'skipped';
  }

  const legacyId = trimToUndefined(transaction.legacyId ?? undefined);
  const created = await context.payments.create({
    paymentDate,
    amount,
    currency,
    direction: 'INCOMING',
    reference: `Braintree transaction ${legacyId ?? transaction.id}`,
    notes: buildPaymentNotes(transaction, orderId),
    externalRef: `braintree:transaction:${transaction.id}`,
    allocations: allocatedDocumentId
      ? [{ documentId: allocatedDocumentId, amount }]
      : undefined,
  });

  if (created.allocationError) {
    context.logger.warn('Braintree payment recorded but allocation failed; payment left unmatched.', {
      transactionId: transaction.id,
      paymentId: created.paymentId,
      allocationError: created.allocationError,
    });
  }

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_PAYMENT,
    localId: created.paymentId,
    externalId: transaction.id,
    metadata: {
      orderId: orderId ?? null,
      allocatedDocumentId: allocatedDocumentId ?? null,
      amount,
      currencyCode: currency,
      status,
      legacyId: legacyId ?? null,
      duplicate: created.duplicate,
      allocationError: created.allocationError ?? null,
    },
  });

  return allocatedDocumentId && !created.allocationError ? 'allocated' : 'unmatched';
}

function buildPaymentNotes(transaction: BraintreeTransaction, orderId: string | undefined): string {
  const parts: string[] = [];
  const name = [
    trimToUndefined(transaction.customer?.firstName ?? undefined),
    trimToUndefined(transaction.customer?.lastName ?? undefined),
  ]
    .filter((part) => part !== undefined)
    .join(' ');
  const email = trimToUndefined(transaction.customer?.email ?? undefined);
  if (name && email) {
    parts.push(`Customer: ${name} (${email})`);
  } else if (name) {
    parts.push(`Customer: ${name}`);
  } else if (email) {
    parts.push(`Customer: ${email}`);
  }
  if (orderId) {
    parts.push(`Order: ${orderId}`);
  }
  return parts.join('\n');
}
