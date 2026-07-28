import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncStripePayments } from '../handlers/syncStripePayments.js';
import { createMockContext, mockFetch, stripeList } from './helpers.js';
import type { ScheduleInput } from '@invoiceleaf/integration-sdk';

const SCHEDULE_INPUT: ScheduleInput = { scheduledAt: '2026-07-28T00:00:00Z' } as ScheduleInput;

function charge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ch_1',
    object: 'charge',
    amount: 12345,
    currency: 'eur',
    created: 1_753_000_000,
    paid: true,
    status: 'succeeded',
    invoice: null,
    ...overrides,
  };
}

describe('syncStripePayments', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('records a succeeded charge as an unmatched incoming payment', async () => {
    const context = createMockContext();
    mockFetch.mockResolvedValueOnce(stripeList([charge()]));

    const result = await syncStripePayments(SCHEDULE_INPUT, context);

    expect(result.success).toBe(true);
    expect(result.recorded).toBe(1);
    expect(result.unmatched).toBe(1);
    expect(result.allocated).toBe(0);
    expect(context.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '123.45',
        currency: 'EUR',
        direction: 'INCOMING',
        externalRef: 'stripe:charge:ch_1',
        allocations: undefined,
      })
    );
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'payment', externalId: 'ch_1', localId: 'payment-1' })
    );
  });

  it('allocates the payment when the charge belongs to an imported invoice', async () => {
    const context = createMockContext();
    (context.mappings.findByExternal as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { entity: string; externalId: string }) => {
        if (input.entity === 'invoice' && input.externalId === 'in_9') {
          return { system: 'stripe', entity: 'invoice', localId: 'doc-42', externalId: 'in_9' };
        }
        return null;
      }
    );
    mockFetch.mockResolvedValueOnce(stripeList([charge({ invoice: 'in_9' })]));

    const result = await syncStripePayments(SCHEDULE_INPUT, context);

    expect(result.allocated).toBe(1);
    expect(context.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        allocations: [{ documentId: 'doc-42', amount: '123.45' }],
      })
    );
  });

  it('skips charges that are not succeeded', async () => {
    const context = createMockContext();
    mockFetch.mockResolvedValueOnce(
      stripeList([charge({ status: 'pending', paid: false }), charge({ id: 'ch_2' })])
    );

    const result = await syncStripePayments(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(result.recorded).toBe(1);
  });

  it('skips charges already recorded via mapping', async () => {
    const context = createMockContext();
    (context.mappings.findByExternal as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { entity: string; externalId: string }) => {
        if (input.entity === 'payment' && input.externalId === 'ch_1') {
          return { system: 'stripe', entity: 'payment', localId: 'payment-9', externalId: 'ch_1' };
        }
        return null;
      }
    );
    mockFetch.mockResolvedValueOnce(stripeList([charge()]));

    const result = await syncStripePayments(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(context.payments.create).not.toHaveBeenCalled();
  });

  it('does not record unmatched charges when recordUnmatchedCharges is false', async () => {
    const context = createMockContext({ recordUnmatchedCharges: false });
    mockFetch.mockResolvedValueOnce(stripeList([charge()]));

    const result = await syncStripePayments(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(context.payments.create).not.toHaveBeenCalled();
  });

  it('advances the checkpoint after a clean run', async () => {
    const context = createMockContext();
    const recentCreated = Math.floor(Date.now() / 1000) - 60;
    mockFetch.mockResolvedValueOnce(stripeList([charge({ created: recentCreated })]));

    const result = await syncStripePayments(SCHEDULE_INPUT, context);

    expect(result.checkpointUpdated).toBe(true);
    expect(context.state.set).toHaveBeenCalledWith('stripe:chargesLastSyncAt', {
      lastCreatedAt: recentCreated,
    });
  });

  it('does not advance the checkpoint past a failed charge', async () => {
    const context = createMockContext();
    (context.payments.create as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ paymentId: 'payment-2', duplicate: false, status: 'UNMATCHED' });
    mockFetch.mockResolvedValueOnce(
      stripeList([charge({ id: 'ch_old', created: 100 }), charge({ id: 'ch_new', created: 200 })])
    );

    const result = await syncStripePayments(SCHEDULE_INPUT, context);

    expect(result.failed).toBe(1);
    expect(result.recorded).toBe(1);
    // ch_old (created 100) failed, so the checkpoint must not move to 200.
    expect(context.state.set).not.toHaveBeenCalled();
    expect(result.checkpointUpdated).toBe(false);
  });

  it('fails gracefully when the Stripe API is unreachable', async () => {
    const context = createMockContext();
    mockFetch.mockRejectedValue(new Error('network down'));

    const result = await syncStripePayments(SCHEDULE_INPUT, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('network down');
  });
});
