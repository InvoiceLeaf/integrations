import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pushInvoicesToPaypal } from '../handlers/pushInvoicesToPaypal.js';
import { createMockContext, findFetchCall, jsonResponse, mockFetch, tokenResponse } from './helpers.js';
import type { ScheduleInput } from '@invoiceleaf/integration-sdk';

const SCHEDULE_INPUT: ScheduleInput = { scheduledAt: '2026-07-28T00:00:00Z' } as ScheduleInput;

function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'doc-1',
    accountingType: 'RECEIVABLE',
    documentStatus: 'ISSUED',
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

function installFetch(options: { createResponse?: object } = {}): void {
  mockFetch.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/v1/oauth2/token')) {
      return tokenResponse();
    }
    if (/\/v2\/invoicing\/invoices\/[^/?#]+\/send$/.test(url)) {
      return jsonResponse({}, 202);
    }
    if (url.endsWith('/v2/invoicing/invoices')) {
      return options.createResponse ?? jsonResponse({ id: 'INV2-NEW-1', status: 'DRAFT' }, 201);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe('pushInvoicesToPaypal', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('pushes an unpaid receivable invoice as a PayPal draft with line items', async () => {
    const context = createMockContext();
    mockDocumentList(context, [document()]);
    installFetch();

    const result = await pushInvoicesToPaypal(SCHEDULE_INPUT, context);

    expect(result.success).toBe(true);
    expect(result.pushed).toBe(1);

    const createCall = findFetchCall('/v2/invoicing/invoices')!;
    const body = JSON.parse(String(createCall[1].body));
    expect(body.detail.invoice_number).toBe('IL-2026-001');
    expect(body.detail.invoice_date).toBe('2026-07-20');
    expect(body.detail.currency_code).toBe('EUR');
    expect(body.detail.payment_term).toEqual({ term_type: 'DUE_ON_DATE_SPECIFIED', due_date: '2026-08-19' });
    expect(body.primary_recipients).toEqual([
      { billing_info: { business_name: 'Kunde AG', email_address: 'kunde@example.test' } },
    ]);
    expect(body.items).toEqual([
      { name: 'Development', quantity: '10', unit_amount: { currency_code: 'EUR', value: '20.00' } },
      { name: 'Hosting', quantity: '1', unit_amount: { currency_code: 'EUR', value: '50.00' } },
    ]);

    // Not sent by default: sending emails the customer.
    expect(findFetchCall('/send')).toBeUndefined();

    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'invoice',
        localId: 'doc-1',
        externalId: 'INV2-NEW-1',
        metadata: expect.objectContaining({ direction: 'outbound', sent: false }),
      })
    );
    expect(context.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', externalId: 'INV2-NEW-1', status: 'synced' })
    );
  });

  it('sends the invoice when autoSendInvoices is enabled', async () => {
    const context = createMockContext({ autoSendInvoices: true });
    mockDocumentList(context, [document()]);
    installFetch();

    const result = await pushInvoicesToPaypal(SCHEDULE_INPUT, context);

    expect(result.pushed).toBe(1);
    const sendCall = findFetchCall('/v2/invoicing/invoices/INV2-NEW-1/send')!;
    expect(sendCall).toBeDefined();
    expect(JSON.parse(String(sendCall[1].body))).toEqual({ send_to_recipient: true });
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ sent: true }) })
    );
  });

  it('skips payable, paid, partial, cancelled, and draft documents', async () => {
    const context = createMockContext();
    mockDocumentList(context, [
      document({ id: 'doc-payable', accountingType: 'PAYABLE' }),
      document({ id: 'doc-paid', paymentStatus: 'PAID' }),
      document({ id: 'doc-partial', paymentStatus: 'PARTIAL' }),
      document({ id: 'doc-cancelled', documentStatus: 'CANCELLED' }),
      document({ id: 'doc-draft', documentStatus: 'DRAFT' }),
    ]);
    installFetch();

    const result = await pushInvoicesToPaypal(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(5);
    expect(result.pushed).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('never pushes back a document that was imported from PayPal', async () => {
    const context = createMockContext();
    (context.mappings.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { entity: string; localId: string }) => {
        if (input.entity === 'invoice' && input.localId === 'doc-imported') {
          return { system: 'paypal', entity: 'invoice', localId: 'doc-imported', externalId: 'INV2-ORIGIN' };
        }
        return null;
      }
    );
    mockDocumentList(context, [document({ id: 'doc-imported' })]);
    installFetch();

    const result = await pushInvoicesToPaypal(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips documents whose uploadSource is paypal even without a mapping', async () => {
    const context = createMockContext();
    mockDocumentList(context, [document({ id: 'doc-src', uploadSource: 'paypal' })]);
    installFetch();

    const result = await pushInvoicesToPaypal(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles a create response that only carries an href', async () => {
    const context = createMockContext();
    mockDocumentList(context, [document()]);
    installFetch({
      createResponse: jsonResponse(
        { href: 'https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-HREF-9' },
        201
      ),
    });

    const result = await pushInvoicesToPaypal(SCHEDULE_INPUT, context);

    expect(result.pushed).toBe(1);
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'invoice', localId: 'doc-1', externalId: 'INV2-HREF-9' })
    );
  });

  it('falls back to a single line built from the document total', async () => {
    const context = createMockContext();
    mockDocumentList(context, [document({ lineItems: [] })]);
    installFetch();

    const result = await pushInvoicesToPaypal(SCHEDULE_INPUT, context);

    expect(result.pushed).toBe(1);
    const body = JSON.parse(String(findFetchCall('/v2/invoicing/invoices')![1].body));
    expect(body.items).toEqual([
      {
        name: 'IL-2026-001: Web development',
        quantity: '1',
        unit_amount: { currency_code: 'EUR', value: '250.00' },
      },
    ]);
  });

  it('records a failure and keeps the checkpoint when PayPal rejects the invoice', async () => {
    const context = createMockContext();
    mockDocumentList(context, [document()]);
    installFetch({ createResponse: jsonResponse({ name: 'UNPROCESSABLE_ENTITY' }, 422) });

    const result = await pushInvoicesToPaypal(SCHEDULE_INPUT, context);

    expect(result.failed).toBe(1);
    expect(result.checkpointUpdated).toBe(false);
    expect(context.state.set).not.toHaveBeenCalledWith('paypal:pushLastSyncAt', expect.anything());
    expect(context.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', status: 'failed' })
    );
  });

  it('advances the checkpoint after a clean run', async () => {
    const context = createMockContext();
    mockDocumentList(context, []);
    installFetch();

    const result = await pushInvoicesToPaypal(SCHEDULE_INPUT, context);

    expect(result.success).toBe(true);
    expect(result.checkpointUpdated).toBe(true);
    expect(context.state.set).toHaveBeenCalledWith(
      'paypal:pushLastSyncAt',
      expect.objectContaining({ lastSuccessfulSyncAt: expect.any(String) })
    );
  });
});
