import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncPaypalPayments } from '../handlers/syncPaypalPayments.js';
import { toPaypalTimestamp } from '../paypal/client.js';
import {
  createMockContext,
  invoiceList,
  jsonResponse,
  mockFetch,
  tokenResponse,
  transactionList,
} from './helpers.js';
import type { ScheduleInput } from '@invoiceleaf/integration-sdk';

const SCHEDULE_INPUT: ScheduleInput = { scheduledAt: '2026-07-28T00:00:00Z' } as ScheduleInput;
const MS_PER_DAY = 24 * 3600 * 1000;

function paidInvoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'INV2-1',
    status: 'PAID',
    detail: { invoice_number: 'INV-0001', currency_code: 'EUR' },
    amount: { value: '119.00', currency_code: 'EUR' },
    ...overrides,
  };
}

function invoicePaymentTxn(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'PAYPAL',
    payment_id: 'PAY-1',
    payment_date: '2026-07-02',
    method: 'PAYPAL',
    amount: { value: '119.00', currency_code: 'EUR' },
    ...overrides,
  };
}

function invoiceDetail(transactions: Record<string, unknown>[] = [invoicePaymentTxn()]): Record<string, unknown> {
  return {
    ...paidInvoice(),
    payments: {
      paid_amount: { value: '119.00', currency_code: 'EUR' },
      transactions,
    },
  };
}

function searchTxn(infoOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transaction_info: {
      transaction_id: 'TXN-1',
      transaction_status: 'S',
      transaction_amount: { value: '50.00', currency_code: 'EUR' },
      transaction_initiation_date: '2026-07-27T10:00:00Z',
      transaction_subject: 'T-shirt order',
      ...infoOverrides,
    },
    payer_info: { email_address: 'buyer@example.test' },
  };
}

function installFetch(
  options: {
    invoices?: unknown[];
    details?: Record<string, unknown>;
    transactions?: unknown[];
    transactionsStatus?: number;
  } = {}
): void {
  mockFetch.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/v1/oauth2/token')) {
      return tokenResponse();
    }
    if (url.includes('/v1/reporting/transactions')) {
      if (options.transactionsStatus) {
        return jsonResponse({ name: 'NOT_AUTHORIZED' }, options.transactionsStatus);
      }
      return transactionList(options.transactions ?? []);
    }
    const detailMatch = /\/v2\/invoicing\/invoices\/([^/?#]+)$/.exec(url);
    if (detailMatch) {
      const detail = options.details?.[decodeURIComponent(detailMatch[1]!)];
      if (!detail) {
        return jsonResponse({ name: 'RESOURCE_NOT_FOUND' }, 404);
      }
      return jsonResponse(detail);
    }
    if (url.includes('/v2/invoicing/invoices')) {
      return invoiceList(options.invoices ?? []);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

function mapInvoiceMapping(context: ReturnType<typeof createMockContext>, invoiceId: string, docId: string): void {
  (context.mappings.findByExternal as ReturnType<typeof vi.fn>).mockImplementation(
    async (input: { entity: string; externalId: string }) => {
      if (input.entity === 'invoice' && input.externalId === invoiceId) {
        return { system: 'paypal', entity: 'invoice', localId: docId, externalId: invoiceId };
      }
      return null;
    }
  );
}

describe('syncPaypalPayments', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('records an invoice payment allocated to the mapped document', async () => {
    const context = createMockContext();
    mapInvoiceMapping(context, 'INV2-1', 'doc-42');
    installFetch({ invoices: [paidInvoice()], details: { 'INV2-1': invoiceDetail() }, transactions: [] });

    const result = await syncPaypalPayments(SCHEDULE_INPUT, context);

    expect(result.success).toBe(true);
    expect(result.recorded).toBe(1);
    expect(result.allocated).toBe(1);
    expect(context.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentDate: '2026-07-02',
        amount: '119.00',
        currency: 'EUR',
        direction: 'INCOMING',
        reference: 'PayPal payment PAY-1',
        externalRef: 'paypal:invpay:PAY-1',
        allocations: [{ documentId: 'doc-42', amount: '119.00' }],
      })
    );
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'payment', externalId: 'paypal:invpay:PAY-1', localId: 'payment-1' })
    );
  });

  it('skips invoice payments that were already recorded', async () => {
    const context = createMockContext();
    (context.mappings.findByExternal as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { entity: string; externalId: string }) => {
        if (input.entity === 'invoice' && input.externalId === 'INV2-1') {
          return { system: 'paypal', entity: 'invoice', localId: 'doc-42', externalId: 'INV2-1' };
        }
        if (input.entity === 'payment' && input.externalId === 'paypal:invpay:PAY-1') {
          return { system: 'paypal', entity: 'payment', localId: 'payment-9', externalId: 'paypal:invpay:PAY-1' };
        }
        return null;
      }
    );
    installFetch({ invoices: [paidInvoice()], details: { 'INV2-1': invoiceDetail() }, transactions: [] });

    const result = await syncPaypalPayments(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(context.payments.create).not.toHaveBeenCalled();
  });

  it('ignores paid invoices that have no mapping yet', async () => {
    const context = createMockContext();
    installFetch({ invoices: [paidInvoice()], transactions: [] });

    const result = await syncPaypalPayments(SCHEDULE_INPUT, context);

    expect(result.recorded).toBe(0);
    expect(context.payments.create).not.toHaveBeenCalled();
  });

  it('records unmatched transactions from the transaction search', async () => {
    const context = createMockContext();
    installFetch({ invoices: [], transactions: [searchTxn()] });

    const result = await syncPaypalPayments(SCHEDULE_INPUT, context);

    expect(result.recorded).toBe(1);
    expect(result.unmatched).toBe(1);
    expect(context.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentDate: '2026-07-27',
        amount: '50.00',
        currency: 'EUR',
        direction: 'INCOMING',
        reference: 'PayPal transaction TXN-1',
        externalRef: 'paypal:txn:TXN-1',
      })
    );
    const createInput = (context.payments.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createInput.allocations).toBeUndefined();
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'payment', externalId: 'paypal:txn:TXN-1' })
    );
  });

  it('skips transactions that match an invoice payment recorded in the same run', async () => {
    const context = createMockContext();
    mapInvoiceMapping(context, 'INV2-1', 'doc-42');
    installFetch({
      invoices: [paidInvoice()],
      details: { 'INV2-1': invoiceDetail() },
      transactions: [searchTxn({ transaction_id: 'PAY-1' })],
    });

    const result = await syncPaypalPayments(SCHEDULE_INPUT, context);

    expect(context.payments.create).toHaveBeenCalledTimes(1);
    expect(result.recorded).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('skips negative and non-successful transactions', async () => {
    const context = createMockContext();
    installFetch({
      invoices: [],
      transactions: [
        searchTxn({ transaction_id: 'TXN-NEG', transaction_amount: { value: '-10.00', currency_code: 'EUR' } }),
        searchTxn({ transaction_id: 'TXN-PENDING', transaction_status: 'P' }),
      ],
    });

    const result = await syncPaypalPayments(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(2);
    expect(context.payments.create).not.toHaveBeenCalled();
  });

  it('does not run the transaction search when recordUnmatchedTransactions is false', async () => {
    const context = createMockContext({ recordUnmatchedTransactions: false });
    installFetch({ invoices: [] });

    const result = await syncPaypalPayments(SCHEDULE_INPUT, context);

    expect(result.success).toBe(true);
    const searchCalls = mockFetch.mock.calls.filter((call) => String(call[0]).includes('/v1/reporting/transactions'));
    expect(searchCalls).toHaveLength(0);
  });

  it('treats 403 from the transaction search as a soft warning', async () => {
    const context = createMockContext();
    installFetch({ invoices: [], transactionsStatus: 403 });

    const result = await syncPaypalPayments(SCHEDULE_INPUT, context);

    expect(result.success).toBe(true);
    expect(result.transactionSearchUnavailable).toBe(true);
    expect(result.checkpointUpdated).toBe(false);
    expect(result.message).toContain('Transaction Search');
  });

  it('treats a persistent 401 from the transaction search as a soft warning', async () => {
    const context = createMockContext();
    installFetch({ invoices: [], transactionsStatus: 401 });

    const result = await syncPaypalPayments(SCHEDULE_INPUT, context);

    expect(result.success).toBe(true);
    expect(result.transactionSearchUnavailable).toBe(true);
    // The client refreshed the token once before giving up.
    const tokenCalls = mockFetch.mock.calls.filter((call) => String(call[0]).includes('/v1/oauth2/token'));
    expect(tokenCalls).toHaveLength(2);
  });

  it('advances the checkpoint after a clean transaction pass', async () => {
    const context = createMockContext();
    installFetch({ invoices: [], transactions: [searchTxn()] });

    const result = await syncPaypalPayments(SCHEDULE_INPUT, context);

    expect(result.checkpointUpdated).toBe(true);
    expect(context.state.set).toHaveBeenCalledWith(
      'paypal:transactionsLastSyncAt',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    );
  });

  it('does not advance the checkpoint past a failed transaction', async () => {
    const context = createMockContext();
    (context.payments.create as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ paymentId: 'payment-2', duplicate: false, status: 'UNMATCHED' });
    installFetch({
      invoices: [],
      transactions: [
        searchTxn({ transaction_id: 'TXN-OLD', transaction_initiation_date: '2026-07-27T08:00:00Z' }),
        searchTxn({ transaction_id: 'TXN-NEW', transaction_initiation_date: '2026-07-27T10:00:00Z' }),
      ],
    });

    const result = await syncPaypalPayments(SCHEDULE_INPUT, context);

    expect(result.failed).toBe(1);
    expect(result.recorded).toBe(1);
    // TXN-OLD failed, so the checkpoint must not move past it.
    expect(result.checkpointUpdated).toBe(false);
    expect(context.state.set).not.toHaveBeenCalledWith('paypal:transactionsLastSyncAt', expect.anything());
  });

  it('uses the stored checkpoint as the search window start', async () => {
    const context = createMockContext();
    await context.state.set('paypal:transactionsLastSyncAt', '2026-07-20T00:00:00.000Z');
    installFetch({ invoices: [], transactions: [] });

    await syncPaypalPayments(SCHEDULE_INPUT, context);

    const searchUrl = mockFetch.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes('/v1/reporting/transactions'))!;
    expect(searchUrl).toContain(`start_date=${encodeURIComponent('2026-07-20T00:00:00Z')}`);
  });

  it('clamps the search window to 31 days', async () => {
    const context = createMockContext();
    const startMs = Date.now() - 100 * MS_PER_DAY;
    await context.state.set('paypal:transactionsLastSyncAt', new Date(startMs).toISOString());
    installFetch({ invoices: [], transactions: [] });

    await syncPaypalPayments(SCHEDULE_INPUT, context);

    const searchUrl = mockFetch.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes('/v1/reporting/transactions'))!;
    const endDate = new URL(searchUrl).searchParams.get('end_date');
    expect(endDate).toBe(toPaypalTimestamp(startMs + 31 * MS_PER_DAY));
  });

  it('fails gracefully when the PayPal API is unreachable', async () => {
    const context = createMockContext();
    mockFetch.mockRejectedValue(new Error('network down'));

    const result = await syncPaypalPayments(SCHEDULE_INPUT, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('network down');
  });
});
