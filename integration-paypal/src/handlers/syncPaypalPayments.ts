import type { IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import { toBoundedInt, toDateOnly, toErrorMessage, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type { PaymentSyncResult, PaypalIntegrationConfig, SyncFailure } from '../types.js';
import type { PaypalClient, PaypalInvoice, PaypalTransaction } from '../paypal/client.js';
import { PaypalApiError, toPaypalTimestamp } from '../paypal/client.js';
import { createPaypalClient, SYSTEM } from './auth.js';
import { ENTITY_PAYMENT, recordInvoicePaymentTransaction } from './invoicePayments.js';

const ENTITY_INVOICE = 'invoice';
const TRANSACTIONS_SYNC_STATE_KEY = 'paypal:transactionsLastSyncAt';
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_MAX_INVOICES_PER_RUN = 50;
const DEFAULT_MAX_TRANSACTIONS_PER_RUN = 100;
const INVOICE_PAGE_SIZE = 50;
const TRANSACTION_PAGE_SIZE = 100;
const MAX_REPORTED_FAILURES = 25;
/** PayPal Transaction Search caps the start/end window at 31 days. */
const MAX_SEARCH_WINDOW_MS = 31 * 24 * 3600 * 1000;
const PAID_STATUSES = new Set(['PAID', 'PARTIALLY_PAID', 'MARKED_AS_PAID']);

type MutableResult = Omit<PaymentSyncResult, 'success' | 'message' | 'error'>;

export const syncPaypalPayments: IntegrationHandler<
  ScheduleInput,
  PaymentSyncResult,
  PaypalIntegrationConfig
> = async (_input, context: IntegrationContext<PaypalIntegrationConfig>): Promise<PaymentSyncResult> => {
  const startedAt = new Date().toISOString();
  const failures: SyncFailure[] = [];

  const resultBase: MutableResult = {
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
    transactionSearchUnavailable: false,
  };

  try {
    const client = await createPaypalClient(context);
    const lookbackHours = toBoundedInt(context.config.initialSyncLookbackHours, DEFAULT_LOOKBACK_HOURS, 1, 720);
    const maxInvoicesPerRun = toBoundedInt(context.config.maxInvoicesPerRun, DEFAULT_MAX_INVOICES_PER_RUN, 1, 500);
    const maxTransactionsPerRun = toBoundedInt(
      context.config.maxTransactionsPerRun,
      DEFAULT_MAX_TRANSACTIONS_PER_RUN,
      1,
      1000
    );
    const recordUnmatched = context.config.recordUnmatchedTransactions ?? true;

    // Source 1: payments registered against mapped PayPal invoices (imported
    // inbound or pushed outbound; the mapping covers both directions).
    // Dedupe is purely mapping/externalRef based, so no checkpoint here.
    const recordedInvoicePaymentIds = await syncInvoicePayments(
      context,
      client,
      maxInvoicesPerRun,
      resultBase,
      failures
    );

    // Source 2: account transactions without a mapped invoice, recorded as
    // unmatched payments for manual reconciliation.
    let searchNote: string | undefined;
    if (recordUnmatched) {
      searchNote = await syncSearchedTransactions(
        context,
        client,
        { lookbackHours, maxTransactionsPerRun, recordedInvoicePaymentIds },
        resultBase,
        failures
      );
    }

    const completedAt = new Date().toISOString();
    const messages: string[] = [
      resultBase.failed === 0
        ? `Recorded ${resultBase.recorded} PayPal payment(s) (${resultBase.allocated} allocated to invoices).`
        : `Recorded PayPal payments with ${resultBase.failed} failure(s).`,
    ];
    if (searchNote) {
      messages.push(searchNote);
    }
    return {
      ...resultBase,
      completedAt,
      success: resultBase.failed === 0,
      message: messages.join(' '),
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('PayPal payment sync run failed', { error: message });
    return {
      ...resultBase,
      completedAt: new Date().toISOString(),
      success: false,
      error: message,
    };
  }
};

/**
 * Record payments registered against mapped PayPal invoices, allocated to
 * the mapped InvoiceLeaf documents. Returns the PayPal payment ids that are
 * recorded (this run or earlier), so the transaction search can skip them.
 */
async function syncInvoicePayments(
  context: IntegrationContext<PaypalIntegrationConfig>,
  client: PaypalClient,
  maxInvoicesPerRun: number,
  result: MutableResult,
  failures: SyncFailure[]
): Promise<Set<string>> {
  const recordedPaymentIds = new Set<string>();

  const invoices: PaypalInvoice[] = [];
  let page = 1;
  for (;;) {
    const response = await client.listInvoices({ page, pageSize: INVOICE_PAGE_SIZE });
    const items = response.items ?? [];
    invoices.push(...items);
    const totalPages = response.total_pages;
    const lastPage = items.length === 0 || !Number.isFinite(totalPages) || page >= (totalPages as number);
    if (lastPage || invoices.length >= maxInvoicesPerRun) {
      break;
    }
    page += 1;
  }

  for (const invoice of invoices.slice(0, maxInvoicesPerRun)) {
    const status = (invoice.status ?? '').toUpperCase();
    if (!PAID_STATUSES.has(status)) {
      continue;
    }
    try {
      const invoiceMapping = await context.mappings.findByExternal({
        system: SYSTEM,
        entity: ENTITY_INVOICE,
        externalId: invoice.id,
      });
      if (!invoiceMapping?.localId) {
        // Not synced (yet); the invoice import trigger picks it up first.
        continue;
      }

      const detail = await client.getInvoice(invoice.id);
      const transactions = detail.payments?.transactions ?? [];
      for (const transaction of transactions) {
        const paymentId = trimToUndefined(transaction.payment_id ?? undefined);
        if (!paymentId) {
          // External cash or check payments carry no PayPal payment id.
          continue;
        }
        result.processed += 1;
        try {
          const outcome = await recordInvoicePaymentTransaction(
            context,
            detail,
            invoiceMapping.localId,
            transaction,
            paymentId
          );
          if (outcome === 'allocated') {
            result.recorded += 1;
            result.allocated += 1;
          } else if (outcome === 'unallocated') {
            result.recorded += 1;
            result.unmatched += 1;
          } else {
            result.skipped += 1;
          }
          recordedPaymentIds.add(paymentId);
        } catch (error) {
          result.failed += 1;
          if (failures.length < MAX_REPORTED_FAILURES) {
            failures.push({ externalId: paymentId, reason: toErrorMessage(error) });
          }
          context.logger.error('PayPal invoice payment sync failed', {
            invoiceId: invoice.id,
            paymentId,
            error: toErrorMessage(error),
          });
        }
      }
    } catch (error) {
      result.failed += 1;
      if (failures.length < MAX_REPORTED_FAILURES) {
        failures.push({ externalId: invoice.id, reason: toErrorMessage(error) });
      }
      context.logger.error('PayPal invoice payment sync failed', {
        invoiceId: invoice.id,
        error: toErrorMessage(error),
      });
    }
  }

  return recordedPaymentIds;
}

/**
 * Record successful PayPal transactions that are not invoice payments as
 * unmatched incoming payments. The checkpoint advances only over the
 * contiguous fully processed prefix; a clean exhausted pass advances to the
 * end of the (clamped) search window.
 */
async function syncSearchedTransactions(
  context: IntegrationContext<PaypalIntegrationConfig>,
  client: PaypalClient,
  options: { lookbackHours: number; maxTransactionsPerRun: number; recordedInvoicePaymentIds: Set<string> },
  result: MutableResult,
  failures: SyncFailure[]
): Promise<string | undefined> {
  const nowMs = Date.now();
  const fallbackStartMs = nowMs - options.lookbackHours * 3600 * 1000;

  let startMs = fallbackStartMs;
  try {
    const checkpoint = await context.state.get<string>(TRANSACTIONS_SYNC_STATE_KEY);
    const parsed = typeof checkpoint === 'string' ? Date.parse(checkpoint) : Number.NaN;
    if (Number.isFinite(parsed)) {
      startMs = parsed;
    }
  } catch (stateError) {
    context.logger.warn('Could not read PayPal transaction sync checkpoint; using fallback lookback window.', {
      key: TRANSACTIONS_SYNC_STATE_KEY,
      error: toErrorMessage(stateError),
    });
  }

  if (startMs > nowMs) {
    startMs = nowMs;
  }
  const endMs = Math.min(nowMs, startMs + MAX_SEARCH_WINDOW_MS);

  const transactions: PaypalTransaction[] = [];
  let exhaustedWindow = false;
  try {
    let page = 1;
    for (;;) {
      const response = await client.searchTransactions({
        startDate: toPaypalTimestamp(startMs),
        endDate: toPaypalTimestamp(endMs),
        page,
        pageSize: TRANSACTION_PAGE_SIZE,
      });
      const items = response.transaction_details ?? [];
      transactions.push(...items);
      const totalPages = response.total_pages;
      if (items.length === 0 || !Number.isFinite(totalPages) || page >= (totalPages as number)) {
        exhaustedWindow = true;
        break;
      }
      if (transactions.length >= options.maxTransactionsPerRun) {
        break;
      }
      page += 1;
    }
  } catch (error) {
    // Transaction Search must be enabled on the REST app; treat it being
    // unavailable as a soft condition rather than a run failure.
    if (error instanceof PaypalApiError && (error.status === 403 || error.status === 401)) {
      result.transactionSearchUnavailable = true;
      context.logger.warn('PayPal Transaction Search is unavailable; skipping unmatched payment sync.', {
        status: error.status,
      });
      return 'PayPal Transaction Search is unavailable; enable the Transaction Search feature on your REST app to record unmatched payments.';
    }
    throw error;
  }

  transactions.sort((a, b) => initiationMs(a) - initiationMs(b));
  const toProcess = exhaustedWindow ? transactions : transactions.slice(0, options.maxTransactionsPerRun);

  let maxFullyProcessedMs = 0;
  let sawFailure = false;

  for (const transaction of toProcess) {
    const transactionId = trimToUndefined(transaction.transaction_info?.transaction_id ?? undefined);
    if (!transactionId) {
      continue;
    }
    result.processed += 1;
    try {
      const outcome = await recordSearchedTransaction(
        context,
        transaction,
        transactionId,
        options.recordedInvoicePaymentIds
      );
      if (outcome === 'recorded') {
        result.recorded += 1;
        result.unmatched += 1;
      } else {
        result.skipped += 1;
      }
      if (!sawFailure) {
        maxFullyProcessedMs = Math.max(maxFullyProcessedMs, initiationMs(transaction));
      }
    } catch (error) {
      sawFailure = true;
      result.failed += 1;
      if (failures.length < MAX_REPORTED_FAILURES) {
        failures.push({ externalId: transactionId, reason: toErrorMessage(error) });
      }
      context.logger.error('PayPal transaction sync failed', {
        transactionId,
        error: toErrorMessage(error),
      });
    }
  }

  // Advance the checkpoint only over the contiguous, fully processed prefix;
  // failed or unprocessed transactions are retried next run (payments are
  // idempotent via mapping + externalRef dedupe).
  let nextCheckpointMs = 0;
  if (!sawFailure && exhaustedWindow) {
    nextCheckpointMs = endMs;
  } else if (maxFullyProcessedMs > 0) {
    nextCheckpointMs = maxFullyProcessedMs;
  }

  if (nextCheckpointMs > startMs) {
    try {
      await context.state.set<string>(TRANSACTIONS_SYNC_STATE_KEY, new Date(nextCheckpointMs).toISOString());
      result.checkpointUpdated = true;
    } catch (stateError) {
      context.logger.warn('Could not persist PayPal transaction sync checkpoint.', {
        key: TRANSACTIONS_SYNC_STATE_KEY,
        error: toErrorMessage(stateError),
      });
    }
  }

  return undefined;
}

function initiationMs(transaction: PaypalTransaction): number {
  const raw = transaction.transaction_info?.transaction_initiation_date;
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

async function recordSearchedTransaction(
  context: IntegrationContext<PaypalIntegrationConfig>,
  transaction: PaypalTransaction,
  transactionId: string,
  recordedInvoicePaymentIds: Set<string>
): Promise<'recorded' | 'skipped'> {
  const info = transaction.transaction_info ?? {};
  const status = trimToUndefined(info.transaction_status ?? undefined)?.toUpperCase();
  if (status !== 'S') {
    return 'skipped';
  }

  const amount = trimToUndefined(info.transaction_amount?.value ?? undefined);
  const currency = trimToUndefined(info.transaction_amount?.currency_code ?? undefined);
  // Negative amounts are fees, refunds, or payouts; only record money received.
  if (!amount || !currency || !(Number(amount) > 0)) {
    return 'skipped';
  }

  if (recordedInvoicePaymentIds.has(transactionId)) {
    return 'skipped';
  }

  const externalId = `paypal:txn:${transactionId}`;
  const existing = await context.mappings.findByExternal({
    system: SYSTEM,
    entity: ENTITY_PAYMENT,
    externalId,
  });
  if (existing?.localId) {
    return 'skipped';
  }
  // The same transaction may already be recorded as an invoice payment in an
  // earlier run.
  const existingInvoicePayment = await context.mappings.findByExternal({
    system: SYSTEM,
    entity: ENTITY_PAYMENT,
    externalId: `paypal:invpay:${transactionId}`,
  });
  if (existingInvoicePayment?.localId) {
    return 'skipped';
  }

  const paymentDate =
    toDateOnly(info.transaction_initiation_date ?? undefined) ?? new Date().toISOString().slice(0, 10);

  const created = await context.payments.create({
    paymentDate,
    amount,
    currency: currency.toUpperCase(),
    direction: 'INCOMING',
    reference: `PayPal transaction ${transactionId}`,
    notes: buildTransactionNotes(transaction),
    externalRef: externalId,
  });

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_PAYMENT,
    localId: created.paymentId,
    externalId,
    metadata: {
      amount,
      currency: currency.toUpperCase(),
      transactionStatus: status,
      subject: trimToUndefined(info.transaction_subject ?? undefined) ?? null,
      duplicate: created.duplicate,
    },
  });

  return 'recorded';
}

function buildTransactionNotes(transaction: PaypalTransaction): string {
  const parts: string[] = [];
  const subject = trimToUndefined(transaction.transaction_info?.transaction_subject ?? undefined);
  if (subject) {
    parts.push(subject);
  }
  const payer = transaction.payer_info;
  const payerName =
    trimToUndefined(payer?.payer_name?.alternate_full_name ?? undefined) ??
    [payer?.payer_name?.given_name, payer?.payer_name?.surname]
      .map((part) => trimToUndefined(part ?? undefined))
      .filter((part): part is string => part !== undefined)
      .join(' ');
  if (payerName) {
    parts.push(`Payer: ${payerName}`);
  }
  const email = trimToUndefined(payer?.email_address ?? undefined);
  if (email) {
    parts.push(`Payer email: ${email}`);
  }
  return parts.join('\n');
}
