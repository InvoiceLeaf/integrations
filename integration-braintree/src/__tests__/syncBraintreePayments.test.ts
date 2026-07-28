import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncBraintreePayments } from '../handlers/syncBraintreePayments.js';
import { createMockContext, graphqlResponse, mockFetch, transactionsPage } from './helpers.js';
import type { ScheduleInput } from '@invoiceleaf/integration-sdk';

const SCHEDULE_INPUT: ScheduleInput = { scheduledAt: '2026-07-28T00:00:00Z' } as ScheduleInput;

function transaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'dHJhbnNhY3Rpb25fMQ',
    legacyId: 'tx1abc',
    orderId: null,
    status: 'SETTLED',
    amount: { value: '123.45', currencyCode: 'EUR' },
    createdAt: '2026-07-27T10:00:00Z',
    customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    paymentMethodSnapshot: { __typename: 'CreditCardDetails' },
    ...overrides,
  };
}

describe('syncBraintreePayments', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('records a settled transaction as an unmatched incoming payment', async () => {
    const context = createMockContext();
    mockFetch.mockResolvedValueOnce(transactionsPage([transaction()]));

    const result = await syncBraintreePayments(SCHEDULE_INPUT, context);

    expect(result.success).toBe(true);
    expect(result.recorded).toBe(1);
    expect(result.unmatched).toBe(1);
    expect(result.allocated).toBe(0);
    expect(context.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentDate: '2026-07-27',
        amount: '123.45',
        currency: 'EUR',
        direction: 'INCOMING',
        reference: 'Braintree transaction tx1abc',
        externalRef: 'braintree:transaction:dHJhbnNhY3Rpb25fMQ',
        allocations: undefined,
      })
    );
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'payment',
        externalId: 'dHJhbnNhY3Rpb25fMQ',
        localId: 'payment-1',
        metadata: expect.objectContaining({ legacyId: 'tx1abc', status: 'SETTLED' }),
      })
    );
  });

  it('allocates the payment when the orderId matches exactly one document', async () => {
    const context = createMockContext();
    (context.data.listDocuments as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [
        { id: 'doc-42', invoiceId: 'INV-100' },
        { id: 'doc-43', invoiceId: 'INV-1000' },
      ],
      total: 2,
      page: 1,
      limit: 10,
      hasMore: false,
    });
    mockFetch.mockResolvedValueOnce(transactionsPage([transaction({ orderId: 'INV-100' })]));

    const result = await syncBraintreePayments(SCHEDULE_INPUT, context);

    expect(result.allocated).toBe(1);
    expect(result.unmatched).toBe(0);
    expect(context.data.listDocuments).toHaveBeenCalledWith({ search: 'INV-100', limit: 10 });
    expect(context.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        allocations: [{ documentId: 'doc-42', amount: '123.45' }],
      })
    );
  });

  it('treats an ambiguous orderId (multiple exact matches) as unmatched', async () => {
    const context = createMockContext();
    (context.data.listDocuments as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [
        { id: 'doc-42', invoiceId: 'INV-100' },
        { id: 'doc-77', invoiceId: 'INV-100' },
      ],
      total: 2,
      page: 1,
      limit: 10,
      hasMore: false,
    });
    mockFetch.mockResolvedValueOnce(transactionsPage([transaction({ orderId: 'INV-100' })]));

    const result = await syncBraintreePayments(SCHEDULE_INPUT, context);

    expect(result.allocated).toBe(0);
    expect(result.unmatched).toBe(1);
    expect(context.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({ allocations: undefined })
    );
  });

  it('treats an orderId without an exact invoiceId match as unmatched', async () => {
    const context = createMockContext();
    (context.data.listDocuments as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [{ id: 'doc-43', invoiceId: 'INV-1000' }],
      total: 1,
      page: 1,
      limit: 10,
      hasMore: false,
    });
    mockFetch.mockResolvedValueOnce(transactionsPage([transaction({ orderId: 'INV-100' })]));

    const result = await syncBraintreePayments(SCHEDULE_INPUT, context);

    expect(result.allocated).toBe(0);
    expect(result.unmatched).toBe(1);
  });

  it('skips non-recordable statuses and records SUBMITTED_FOR_SETTLEMENT by default', async () => {
    const context = createMockContext();
    mockFetch.mockResolvedValueOnce(
      transactionsPage([
        transaction({ id: 't1', status: 'AUTHORIZED' }),
        transaction({ id: 't2', status: 'SUBMITTED_FOR_SETTLEMENT' }),
        transaction({ id: 't3', status: 'VOIDED' }),
      ])
    );

    const result = await syncBraintreePayments(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(2);
    expect(result.recorded).toBe(1);
    expect(context.payments.create).toHaveBeenCalledTimes(1);
    expect(context.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({ externalRef: 'braintree:transaction:t2' })
    );
  });

  it('skips SUBMITTED_FOR_SETTLEMENT when includeSubmittedForSettlement is false', async () => {
    const context = createMockContext({ includeSubmittedForSettlement: false });
    mockFetch.mockResolvedValueOnce(
      transactionsPage([transaction({ status: 'SUBMITTED_FOR_SETTLEMENT' })])
    );

    const result = await syncBraintreePayments(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(context.payments.create).not.toHaveBeenCalled();
  });

  it('skips transactions already recorded via mapping', async () => {
    const context = createMockContext();
    (context.mappings.findByExternal as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { entity: string; externalId: string }) => {
        if (input.entity === 'payment' && input.externalId === 'dHJhbnNhY3Rpb25fMQ') {
          return { system: 'braintree', entity: 'payment', localId: 'payment-9', externalId: 'dHJhbnNhY3Rpb25fMQ' };
        }
        return null;
      }
    );
    mockFetch.mockResolvedValueOnce(transactionsPage([transaction()]));

    const result = await syncBraintreePayments(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(context.payments.create).not.toHaveBeenCalled();
  });

  it('does not record unmatched transactions when recordUnmatchedTransactions is false', async () => {
    const context = createMockContext({ recordUnmatchedTransactions: false });
    mockFetch.mockResolvedValueOnce(transactionsPage([transaction()]));

    const result = await syncBraintreePayments(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(context.payments.create).not.toHaveBeenCalled();
  });

  it('advances the checkpoint after a clean run', async () => {
    const context = createMockContext();
    const recentCreatedAt = new Date(Date.now() - 60_000).toISOString();
    mockFetch.mockResolvedValueOnce(transactionsPage([transaction({ createdAt: recentCreatedAt })]));

    const result = await syncBraintreePayments(SCHEDULE_INPUT, context);

    expect(result.checkpointUpdated).toBe(true);
    expect(context.state.set).toHaveBeenCalledWith('braintree:transactionsLastSyncAt', {
      lastCreatedAt: recentCreatedAt,
    });
  });

  it('does not advance the checkpoint past a failed transaction', async () => {
    const context = createMockContext();
    (context.payments.create as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ paymentId: 'payment-2', duplicate: false, status: 'UNMATCHED' });
    const olderCreatedAt = new Date(Date.now() - 120_000).toISOString();
    const newerCreatedAt = new Date(Date.now() - 60_000).toISOString();
    mockFetch.mockResolvedValueOnce(
      transactionsPage([
        transaction({ id: 't_old', createdAt: olderCreatedAt }),
        transaction({ id: 't_new', createdAt: newerCreatedAt }),
      ])
    );

    const result = await syncBraintreePayments(SCHEDULE_INPUT, context);

    expect(result.failed).toBe(1);
    expect(result.recorded).toBe(1);
    // t_old failed, so the checkpoint must not move to t_new's createdAt.
    expect(context.state.set).not.toHaveBeenCalled();
    expect(result.checkpointUpdated).toBe(false);
  });

  it('surfaces a GraphQL errors array as a run failure', async () => {
    const context = createMockContext();
    mockFetch.mockResolvedValueOnce(graphqlResponse(null, [{ message: 'Authentication failed' }]));

    const result = await syncBraintreePayments(SCHEDULE_INPUT, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication failed');
    expect(context.payments.create).not.toHaveBeenCalled();
  });

  it('fails gracefully when the Braintree API is unreachable', async () => {
    const context = createMockContext();
    mockFetch.mockRejectedValue(new Error('network down'));

    const result = await syncBraintreePayments(SCHEDULE_INPUT, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('network down');
  });
});
