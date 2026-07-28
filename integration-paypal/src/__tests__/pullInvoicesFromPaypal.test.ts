import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pullInvoicesFromPaypal } from '../handlers/pullInvoicesFromPaypal.js';
import { createMockContext, invoiceList, jsonResponse, mockFetch, tokenResponse } from './helpers.js';
import type { ScheduleInput } from '@invoiceleaf/integration-sdk';

const SCHEDULE_INPUT: ScheduleInput = { scheduledAt: '2026-07-28T00:00:00Z' } as ScheduleInput;

function paypalInvoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'INV2-1',
    status: 'SENT',
    detail: {
      invoice_number: 'INV-0001',
      invoice_date: '2026-07-01',
      currency_code: 'EUR',
      note: 'Thanks for your business',
      payment_term: { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: '2026-07-31' },
    },
    amount: {
      value: '119.00',
      currency_code: 'EUR',
      breakdown: {
        item_total: { value: '100.00', currency_code: 'EUR' },
        tax_total: { value: '19.00', currency_code: 'EUR' },
      },
    },
    due_amount: { value: '119.00', currency_code: 'EUR' },
    primary_recipients: [
      { billing_info: { business_name: 'Acme GmbH', email_address: 'billing@acme.test' } },
    ],
    items: [
      {
        name: 'Consulting',
        quantity: '2',
        unit_amount: { currency_code: 'EUR', value: '50.00' },
        tax: { name: 'VAT', percent: '19' },
      },
    ],
    ...overrides,
  };
}

function installFetch(
  options: { invoices?: unknown[]; details?: Record<string, unknown> } = {}
): void {
  mockFetch.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/v1/oauth2/token')) {
      return tokenResponse();
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

describe('pullInvoicesFromPaypal', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('imports a sent invoice as a fully structured document', async () => {
    const context = createMockContext();
    installFetch({ invoices: [paypalInvoice()] });

    const result = await pullInvoicesFromPaypal(SCHEDULE_INPUT, context);

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(context.data.createStructuredDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'paypal',
        externalRef: 'paypal:invoice:INV2-1',
        invoiceId: 'INV-0001',
        invoiceDate: '2026-07-01',
        dueDate: '2026-07-31',
        currency: 'EUR',
        accountingType: 'RECEIVABLE',
        receiverId: 'company-new-1',
        netAmount: '100.00',
        taxAmount: '19.00',
        totalAmount: '119.00',
        amountDue: '119.00',
        lineItems: [
          expect.objectContaining({
            name: 'Consulting',
            quantity: '2',
            unitAmount: '50.00',
            taxPercentage: '19',
            netAmount: '100.00',
            taxAmount: '19.00',
            totalAmount: '119.00',
          }),
        ],
      })
    );
    // The document must NOT go through the processing pipeline.
    expect(context.data.importDocument).not.toHaveBeenCalled();
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'invoice', externalId: 'INV2-1', localId: 'imported-doc-1' })
    );
    expect(context.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'imported-doc-1', system: 'paypal', status: 'synced' })
    );
  });

  it('resolves the recipient to a company, creating one when no match exists', async () => {
    const context = createMockContext();
    installFetch({ invoices: [paypalInvoice()] });

    await pullInvoicesFromPaypal(SCHEDULE_INPUT, context);

    expect(context.data.createCompany).toHaveBeenCalledWith({
      name: 'Acme GmbH',
      email: 'billing@acme.test',
    });
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'company', externalId: 'billing@acme.test', localId: 'company-new-1' })
    );
  });

  it('reuses an existing company mapping for the recipient', async () => {
    const context = createMockContext();
    (context.mappings.findByExternal as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { entity: string; externalId: string }) => {
        if (input.entity === 'company' && input.externalId === 'billing@acme.test') {
          return { system: 'paypal', entity: 'company', localId: 'company-77', externalId: 'billing@acme.test' };
        }
        return null;
      }
    );
    installFetch({ invoices: [paypalInvoice()] });

    await pullInvoicesFromPaypal(SCHEDULE_INPUT, context);

    expect(context.data.createCompany).not.toHaveBeenCalled();
    expect(context.data.createStructuredDocument).toHaveBeenCalledWith(
      expect.objectContaining({ receiverId: 'company-77' })
    );
  });

  it('records allocated payments for an invoice that is already paid in PayPal', async () => {
    const context = createMockContext();
    const paid = paypalInvoice({ status: 'PAID' });
    installFetch({
      invoices: [paid],
      details: {
        'INV2-1': {
          ...paid,
          payments: {
            paid_amount: { value: '119.00', currency_code: 'EUR' },
            transactions: [
              {
                type: 'PAYPAL',
                payment_id: 'PAY-1',
                payment_date: '2026-07-02',
                method: 'PAYPAL',
                amount: { value: '119.00', currency_code: 'EUR' },
              },
            ],
          },
        },
      },
    });

    const result = await pullInvoicesFromPaypal(SCHEDULE_INPUT, context);

    expect(result.imported).toBe(1);
    expect(context.payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentDate: '2026-07-02',
        amount: '119.00',
        currency: 'EUR',
        direction: 'INCOMING',
        externalRef: 'paypal:invpay:PAY-1',
        allocations: [{ documentId: 'imported-doc-1', amount: '119.00' }],
      })
    );
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'payment', externalId: 'paypal:invpay:PAY-1' })
    );
  });

  it('does not record payments for unpaid invoices', async () => {
    const context = createMockContext();
    installFetch({ invoices: [paypalInvoice()] });

    await pullInvoicesFromPaypal(SCHEDULE_INPUT, context);

    expect(context.payments.create).not.toHaveBeenCalled();
  });

  it('skips draft invoices by default and imports them when configured', async () => {
    const draft = paypalInvoice({ status: 'DRAFT' });

    const context = createMockContext();
    installFetch({ invoices: [draft] });
    const result = await pullInvoicesFromPaypal(SCHEDULE_INPUT, context);
    expect(result.skipped).toBe(1);
    expect(context.data.createStructuredDocument).not.toHaveBeenCalled();

    const permissiveContext = createMockContext({ importDraftInvoices: true });
    installFetch({ invoices: [draft] });
    const permissiveResult = await pullInvoicesFromPaypal(SCHEDULE_INPUT, permissiveContext);
    expect(permissiveResult.imported).toBe(1);
  });

  it('skips cancelled invoices', async () => {
    const context = createMockContext();
    installFetch({ invoices: [paypalInvoice({ status: 'CANCELLED' })] });

    const result = await pullInvoicesFromPaypal(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(context.data.createStructuredDocument).not.toHaveBeenCalled();
  });

  it('skips invoices that were already imported', async () => {
    const context = createMockContext();
    (context.mappings.findByExternal as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { entity: string; externalId: string }) => {
        if (input.entity === 'invoice' && input.externalId === 'INV2-1') {
          return { system: 'paypal', entity: 'invoice', localId: 'doc-1', externalId: 'INV2-1' };
        }
        return null;
      }
    );
    installFetch({ invoices: [paypalInvoice()] });

    const result = await pullInvoicesFromPaypal(SCHEDULE_INPUT, context);

    expect(result.skipped).toBe(1);
    expect(context.data.createStructuredDocument).not.toHaveBeenCalled();
  });

  it('caps the number of processed invoices per run', async () => {
    const context = createMockContext({ maxInvoicesPerRun: 1 });
    installFetch({ invoices: [paypalInvoice(), paypalInvoice({ id: 'INV2-2' })] });

    const result = await pullInvoicesFromPaypal(SCHEDULE_INPUT, context);

    expect(result.processed).toBe(1);
    expect(context.data.createStructuredDocument).toHaveBeenCalledTimes(1);
  });

  it('fails when the PayPal Client ID is not configured', async () => {
    const context = createMockContext({ clientId: '' });
    installFetch({ invoices: [paypalInvoice()] });

    const result = await pullInvoicesFromPaypal(SCHEDULE_INPUT, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Client ID');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('records a failure when the structured create fails', async () => {
    const context = createMockContext();
    (context.data.createStructuredDocument as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    installFetch({ invoices: [paypalInvoice()] });

    const result = await pullInvoicesFromPaypal(SCHEDULE_INPUT, context);

    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toEqual({ externalId: 'INV2-1', reason: 'boom' });
  });
});
