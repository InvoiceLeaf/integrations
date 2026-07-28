import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pullInvoicesFromStripe } from '../handlers/pullInvoicesFromStripe.js';
import { createMockContext, fakeResponse, mockFetch, stripeList } from './helpers.js';
import type { ScheduleInput } from '@invoiceleaf/integration-sdk';

const SCHEDULE_INPUT: ScheduleInput = { scheduledAt: '2026-07-28T00:00:00Z' } as ScheduleInput;

function invoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'in_1',
    object: 'invoice',
    number: 'INV-0001',
    status: 'open',
    created: 1_753_000_000,
    currency: 'eur',
    customer: 'cus_1',
    customer_name: 'Acme GmbH',
    customer_email: 'billing@acme.test',
    subtotal: 10000,
    tax: 2000,
    total: 12000,
    amount_due: 12000,
    amount_paid: 0,
    due_date: 1_753_500_000,
    lines: {
      data: [
        { id: 'il_1', description: 'Consulting', quantity: 2, amount: 10000, price: { unit_amount: 5000 } },
      ],
      has_more: false,
    },
    invoice_pdf: 'https://pay.stripe.com/invoice/in_1/pdf',
    ...overrides,
  };
}

describe('pullInvoicesFromStripe', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('imports a finalized invoice as a fully structured document', async () => {
    const context = createMockContext();
    mockFetch
      .mockResolvedValueOnce(stripeList([invoice()]))
      .mockResolvedValueOnce(fakeResponse('JVBERi1mYWtlLXBkZg=='));

    const result = await pullInvoicesFromStripe(SCHEDULE_INPUT, context);

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(context.data.createStructuredDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'stripe',
        externalRef: 'stripe:invoice:in_1',
        invoiceId: 'INV-0001',
        currency: 'EUR',
        accountingType: 'RECEIVABLE',
        netAmount: '100.00',
        taxAmount: '20.00',
        totalAmount: '120.00',
        amountDue: '120.00',
        receiverId: 'company-new-1',
        lineItems: [
          expect.objectContaining({
            name: 'Consulting',
            quantity: 2,
            unitAmount: '50.00',
            totalAmount: '100.00',
          }),
        ],
        fileName: 'INV-0001.pdf',
        contentType: 'application/pdf',
        contentBase64: 'JVBERi1mYWtlLXBkZg==',
      })
    );
    // The document must NOT go through the processing pipeline.
    expect(context.data.importDocument).not.toHaveBeenCalled();
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'invoice', externalId: 'in_1', localId: 'imported-doc-1' })
    );
    expect(context.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'imported-doc-1', system: 'stripe', status: 'synced' })
    );
  });

  it('resolves the customer to a company, creating one when no match exists', async () => {
    const context = createMockContext();
    mockFetch
      .mockResolvedValueOnce(stripeList([invoice()]))
      .mockResolvedValueOnce(fakeResponse('JVBERi1mYWtlLXBkZg=='));

    await pullInvoicesFromStripe(SCHEDULE_INPUT, context);

    expect(context.data.createCompany).toHaveBeenCalledWith({
      name: 'Acme GmbH',
      email: 'billing@acme.test',
    });
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'company', externalId: 'cus_1', localId: 'company-new-1' })
    );
  });

  it('reuses an existing company mapping for the customer', async () => {
    const context = createMockContext();
    (context.mappings.findByExternal as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { entity: string; externalId: string }) => {
        if (input.entity === 'company' && input.externalId === 'cus_1') {
          return { system: 'stripe', entity: 'company', localId: 'company-77', externalId: 'cus_1' };
        }
        return null;
      }
    );
    mockFetch
      .mockResolvedValueOnce(stripeList([invoice()]))
      .mockResolvedValueOnce(fakeResponse('JVBERi1mYWtlLXBkZg=='));

    await pullInvoicesFromStripe(SCHEDULE_INPUT, context);

    expect(context.data.createCompany).not.toHaveBeenCalled();
    expect(context.data.createStructuredDocument).toHaveBeenCalledWith(
      expect.objectContaining({ receiverId: 'company-77' })
    );
  });

  it('records an allocated payment for an invoice that is already paid in Stripe', async () => {
    const context = createMockContext();
    mockFetch
      .mockResolvedValueOnce(
        stripeList([
          invoice({
            status: 'paid',
            amount_paid: 12000,
            amount_due: 0,
            charge: 'ch_paid_1',
            status_transitions: { paid_at: 1_753_100_000 },
          }),
        ])
      )
      .mockResolvedValueOnce(fakeResponse('JVBERi1mYWtlLXBkZg=='));

    const result = await pullInvoicesFromStripe(SCHEDULE_INPUT, context);

    expect(result.imported).toBe(1);
    expect(context.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '120.00',
        currency: 'EUR',
        direction: 'INCOMING',
        externalRef: 'stripe:charge:ch_paid_1',
        allocations: [{ documentId: 'imported-doc-1', amount: '120.00' }],
      })
    );
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'payment', externalId: 'ch_paid_1' })
    );
  });

  it('does not record a payment for unpaid invoices', async () => {
    const context = createMockContext();
    mockFetch
      .mockResolvedValueOnce(stripeList([invoice()]))
      .mockResolvedValueOnce(fakeResponse('JVBERi1mYWtlLXBkZg=='));

    await pullInvoicesFromStripe(SCHEDULE_INPUT, context);

    expect(context.payments.create).not.toHaveBeenCalled();
  });

  it('imports without a file when the PDF download fails', async () => {
    const context = createMockContext();
    mockFetch
      .mockResolvedValueOnce(stripeList([invoice()]))
      .mockResolvedValue(fakeResponse('not found', 404));

    const result = await pullInvoicesFromStripe(SCHEDULE_INPUT, context);

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(context.data.createStructuredDocument).toHaveBeenCalledWith(
      expect.objectContaining({ contentBase64: undefined, fileName: undefined })
    );
  });

  it('skips draft invoices by default', async () => {
    const context = createMockContext();
    mockFetch.mockResolvedValueOnce(stripeList([invoice({ status: 'draft' })]));

    const result = await pullInvoicesFromStripe(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(context.data.createStructuredDocument).not.toHaveBeenCalled();
  });

  it('skips invoices that were already imported', async () => {
    const context = createMockContext();
    (context.mappings.findByExternal as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { entity: string; externalId: string }) => {
        if (input.entity === 'invoice' && input.externalId === 'in_1') {
          return { system: 'stripe', entity: 'invoice', localId: 'doc-1', externalId: 'in_1' };
        }
        return null;
      }
    );
    mockFetch.mockResolvedValueOnce(stripeList([invoice()]));

    const result = await pullInvoicesFromStripe(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(context.data.createStructuredDocument).not.toHaveBeenCalled();
  });

  it('advances the checkpoint after a clean run', async () => {
    const context = createMockContext();
    const recentCreated = Math.floor(Date.now() / 1000) - 60;
    mockFetch
      .mockResolvedValueOnce(stripeList([invoice({ created: recentCreated })]))
      .mockResolvedValueOnce(fakeResponse('JVBERi1mYWtlLXBkZg=='));

    const result = await pullInvoicesFromStripe(SCHEDULE_INPUT, context);

    expect(result.checkpointUpdated).toBe(true);
    expect(context.state.set).toHaveBeenCalledWith('stripe:invoicesLastSyncAt', {
      lastCreatedAt: recentCreated,
    });
  });

  it('uses a stored checkpoint for the created filter', async () => {
    const context = createMockContext();
    (context.state.get as ReturnType<typeof vi.fn>).mockResolvedValue({ lastCreatedAt: 1_700_000_000 });
    mockFetch.mockResolvedValueOnce(stripeList([]));

    await pullInvoicesFromStripe(SCHEDULE_INPUT, context);

    const url = String(mockFetch.mock.calls[0]![0]);
    expect(url).toContain(encodeURIComponent('created[gt]') + '=1700000000');
  });
});
