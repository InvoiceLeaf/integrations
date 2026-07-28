import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pushInvoicesToStripe } from '../handlers/pushInvoicesToStripe.js';
import { createMockContext, jsonResponse, mockFetch, stripeList } from './helpers.js';
import type { ScheduleInput } from '@invoiceleaf/integration-sdk';

const SCHEDULE_INPUT: ScheduleInput = { scheduledAt: '2026-07-28T00:00:00Z' } as ScheduleInput;

function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'doc-1',
    accountingType: 'RECEIVABLE',
    documentStatus: 'OPEN',
    paymentStatus: 'UNPAID',
    invoiceId: 'IL-2026-001',
    description: 'Web development',
    invoiceDate: '2026-07-20',
    dueDate: '2026-08-19',
    currency: { code: 'EUR' },
    totalAmount: 250,
    receiver: { id: 'company-9', name: 'Kunde AG', email: 'kunde@example.test' },
    lineItems: [
      { name: 'Development', quantity: 10, unitAmount: 20, totalAmount: 200 },
      { name: 'Hosting', quantity: 1, unitAmount: 50, totalAmount: 50 },
    ],
    ...overrides,
  };
}

function mockDocumentList(context: ReturnType<typeof createMockContext>, docs: Record<string, unknown>[]): void {
  (context.data.listDocuments as ReturnType<typeof vi.fn>).mockResolvedValue({
    items: docs,
    total: docs.length,
    page: 1,
    limit: 50,
    hasMore: false,
  });
}

describe('pushInvoicesToStripe', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('pushes an unpaid receivable invoice to Stripe with line items and finalizes it', async () => {
    const context = createMockContext();
    mockDocumentList(context, [document()]);
    mockFetch
      // resolveCustomerId: search by email finds nothing, create customer
      .mockResolvedValueOnce(stripeList([]))
      .mockResolvedValueOnce(jsonResponse({ id: 'cus_new' }))
      // create invoice
      .mockResolvedValueOnce(jsonResponse({ id: 'in_new', status: 'draft' }))
      // two invoice items
      .mockResolvedValueOnce(jsonResponse({ id: 'ii_1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'ii_2' }))
      // finalize
      .mockResolvedValueOnce(
        jsonResponse({ id: 'in_new', status: 'open', number: 'A-0001', hosted_invoice_url: 'https://inv.stripe/x' })
      );

    const result = await pushInvoicesToStripe(SCHEDULE_INPUT, context);

    expect(result.success).toBe(true);
    expect(result.pushed).toBe(1);

    const calls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(calls[0]).toContain('/v1/customers?email=');
    expect(calls[1]).toContain('/v1/customers');
    expect(calls[2]).toContain('/v1/invoices');
    expect(calls[3]).toContain('/v1/invoiceitems');
    expect(calls[4]).toContain('/v1/invoiceitems');
    expect(calls[5]).toContain('/v1/invoices/in_new/finalize');

    const invoiceBody = String(mockFetch.mock.calls[2]![1].body);
    expect(invoiceBody).toContain('customer=cus_new');
    expect(invoiceBody).toContain('collection_method=send_invoice');
    expect(invoiceBody).toContain(encodeURIComponent('metadata[invoiceleaf_document_id]') + '=doc-1');

    const firstItemBody = String(mockFetch.mock.calls[3]![1].body);
    expect(firstItemBody).toContain('amount=20000');

    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'invoice',
        localId: 'doc-1',
        externalId: 'in_new',
        metadata: expect.objectContaining({ direction: 'outbound' }),
      })
    );
    expect(context.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', externalId: 'in_new', status: 'synced' })
    );
  });

  it('reuses an existing customer mapping', async () => {
    const context = createMockContext();
    (context.mappings.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { entity: string; localId: string }) => {
        if (input.entity === 'company' && input.localId === 'company-9') {
          return { system: 'stripe', entity: 'company', localId: 'company-9', externalId: 'cus_existing' };
        }
        return null;
      }
    );
    mockDocumentList(context, [document()]);
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'in_new', status: 'draft' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'ii_1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'ii_2' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'in_new', status: 'open' }));

    const result = await pushInvoicesToStripe(SCHEDULE_INPUT, context);

    expect(result.pushed).toBe(1);
    const invoiceBody = String(mockFetch.mock.calls[0]![1].body);
    expect(invoiceBody).toContain('customer=cus_existing');
  });

  it('skips payable, paid, cancelled, and draft documents', async () => {
    const context = createMockContext();
    mockDocumentList(context, [
      document({ id: 'doc-payable', accountingType: 'PAYABLE' }),
      document({ id: 'doc-paid', paymentStatus: 'PAID' }),
      document({ id: 'doc-partial', paymentStatus: 'PARTIAL' }),
      document({ id: 'doc-cancelled', documentStatus: 'CANCELLED' }),
      document({ id: 'doc-draft', documentStatus: 'DRAFT' }),
    ]);

    const result = await pushInvoicesToStripe(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(5);
    expect(result.pushed).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('never pushes back a document that was imported from Stripe', async () => {
    const context = createMockContext();
    (context.mappings.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { entity: string; localId: string }) => {
        if (input.entity === 'invoice' && input.localId === 'doc-imported') {
          return { system: 'stripe', entity: 'invoice', localId: 'doc-imported', externalId: 'in_origin' };
        }
        return null;
      }
    );
    mockDocumentList(context, [document({ id: 'doc-imported' })]);

    const result = await pushInvoicesToStripe(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips documents whose uploadSource is stripe even without a mapping', async () => {
    const context = createMockContext();
    mockDocumentList(context, [document({ id: 'doc-src', uploadSource: 'stripe' })]);

    const result = await pushInvoicesToStripe(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not finalize when autoFinalizeInvoices is false', async () => {
    const context = createMockContext({ autoFinalizeInvoices: false });
    mockDocumentList(context, [document()]);
    mockFetch
      .mockResolvedValueOnce(stripeList([]))
      .mockResolvedValueOnce(jsonResponse({ id: 'cus_new' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'in_new', status: 'draft' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'ii_1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'ii_2' }));

    const result = await pushInvoicesToStripe(SCHEDULE_INPUT, context);

    expect(result.pushed).toBe(1);
    const calls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(calls.some((url) => url.includes('/finalize'))).toBe(false);
  });

  it('records a failure and keeps the checkpoint when Stripe rejects the invoice', async () => {
    const context = createMockContext();
    mockDocumentList(context, [document()]);
    mockFetch
      .mockResolvedValueOnce(stripeList([]))
      .mockResolvedValueOnce(jsonResponse({ id: 'cus_new' }))
      .mockResolvedValue(jsonResponse({ error: { message: 'invalid currency' } }, 400));

    const result = await pushInvoicesToStripe(SCHEDULE_INPUT, context);

    expect(result.failed).toBe(1);
    expect(result.checkpointUpdated).toBe(false);
    expect(context.state.set).not.toHaveBeenCalled();
    expect(context.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', status: 'failed' })
    );
  });

  it('advances the checkpoint after a clean run', async () => {
    const context = createMockContext();
    mockDocumentList(context, []);

    const result = await pushInvoicesToStripe(SCHEDULE_INPUT, context);

    expect(result.success).toBe(true);
    expect(result.checkpointUpdated).toBe(true);
    expect(context.state.set).toHaveBeenCalledWith(
      'stripe:pushLastSyncAt',
      expect.objectContaining({ lastSuccessfulSyncAt: expect.any(String) })
    );
  });
});
