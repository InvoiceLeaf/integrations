/**
 * Rejected Document Tests
 *
 * The backend emits document.processed and lists documents for every
 * finished processing attempt, including uploads it rejected as "not an
 * invoice". Those used to reach Slack as "Invoice processed" messages and
 * daily summaries on days without a single invoice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Document, IntegrationContext } from '@invoiceleaf/integration-sdk';
import { handleDailySummary } from '../handlers/dailySummary.js';
import { handleDocumentProcessed } from '../handlers/documentProcessed.js';
import { isProcessedInvoice } from '../types.js';
import type { SlackIntegrationConfig } from '../types.js';

const WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/abc123';

const NOT_AN_INVOICE = 1;
const INVALID_FILE_FORMAT = 3;

function doc(overrides: Record<string, unknown>): Document {
  return {
    id: `doc-${Math.random().toString(36).slice(2)}`,
    processed: true,
    errorType: 0,
    currency: { code: 'EUR' },
    totalAmount: '119.00',
    supplier: { id: 'c1', name: 'ACME' },
    ...overrides,
  } as unknown as Document;
}

function context(documents: Document[]): IntegrationContext<SlackIntegrationConfig> {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    spaceId: 'space-1',
    config: {
      webhookUrl: WEBHOOK_URL,
      notifyOnDocumentProcessed: true,
      enableDailySummary: true,
    },
    logger,
    data: {
      getDocument: vi.fn(async (id: string) => documents.find((d) => d.id === id)),
      listDocuments: vi.fn(async () => ({
        items: documents,
        total: documents.length,
        page: 1,
        limit: 1000,
        hasMore: false,
      })),
      listCompanies: vi.fn(async () => ({ items: [], total: 0, page: 1, limit: 20, hasMore: false })),
    },
  } as unknown as IntegrationContext<SlackIntegrationConfig>;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isProcessedInvoice', () => {
  it('accepts processed documents without an error', () => {
    expect(isProcessedInvoice(doc({}))).toBe(true);
    expect(isProcessedInvoice(doc({ errorType: undefined }))).toBe(true);
  });

  it('rejects documents the backend rejected or has not processed yet', () => {
    expect(isProcessedInvoice(doc({ errorType: NOT_AN_INVOICE }))).toBe(false);
    expect(isProcessedInvoice(doc({ errorType: INVALID_FILE_FORMAT }))).toBe(false);
    expect(isProcessedInvoice(doc({ processed: false }))).toBe(false);
  });
});

describe('handleDocumentProcessed', () => {
  it('does not post when the document is not an invoice', async () => {
    const rejected = doc({ errorType: NOT_AN_INVOICE, totalAmount: null, supplier: undefined });

    const result = await handleDocumentProcessed(
      { documentId: rejected.id } as never,
      context([rejected])
    );

    expect(result).toMatchObject({ success: true, skipped: true, reason: 'not_an_invoice' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts for a processed invoice', async () => {
    const invoice = doc({});

    const result = await handleDocumentProcessed({ documentId: invoice.id } as never, context([invoice]));

    expect(result.success).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('handleDailySummary', () => {
  it('skips the summary when every document was rejected', async () => {
    const result = await handleDailySummary(
      {} as never,
      context([
        doc({ errorType: NOT_AN_INVOICE }),
        doc({ errorType: NOT_AN_INVOICE }),
        doc({ errorType: INVALID_FILE_FORMAT }),
      ])
    );

    expect(result).toMatchObject({ success: true, skipped: true, reason: 'no_activity' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts only invoices in the summary', async () => {
    const result = await handleDailySummary(
      {} as never,
      context([doc({ totalAmount: '100.00' }), doc({ errorType: NOT_AN_INVOICE, totalAmount: '999.00' })])
    );

    expect(result.success).toBe(true);
    expect(result.stats?.processedCount).toBe(1);
    expect(result.stats?.totalAmount).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
