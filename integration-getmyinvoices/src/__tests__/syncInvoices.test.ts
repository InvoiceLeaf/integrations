import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncInvoices, isSyncableDocument, resolveRuntimeDefaults } from '../handlers/syncInvoices.js';
import { createMockContext, createMockDocument, mockFetch, jsonResponse } from './helpers.js';
import type { Document } from '@invoiceleaf/integration-sdk';

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// isSyncableDocument
// ---------------------------------------------------------------------------
describe('isSyncableDocument', () => {
  it('returns true for a valid ISSUED document', () => {
    const doc = createMockDocument() as Document;
    expect(isSyncableDocument(doc, false)).toBe(true);
  });

  it('returns false for deleted document', () => {
    const doc = createMockDocument({ deleted: true }) as Document;
    expect(isSyncableDocument(doc, false)).toBe(false);
  });

  it('returns false when id is empty', () => {
    const doc = createMockDocument({ id: '' }) as Document;
    expect(isSyncableDocument(doc, false)).toBe(false);
  });

  it('returns false for duplicate documents', () => {
    const doc = createMockDocument({ duplicateOfId: 'other-doc-id' }) as Document;
    expect(isSyncableDocument(doc, false)).toBe(false);
  });

  it('returns false for CANCELLED documents', () => {
    const doc = createMockDocument({ documentStatus: 'CANCELLED' }) as Document;
    expect(isSyncableDocument(doc, false)).toBe(false);
  });

  it('returns false for DRAFT documents when includeDraftDocuments is false', () => {
    const doc = createMockDocument({ documentStatus: 'DRAFT' }) as Document;
    expect(isSyncableDocument(doc, false)).toBe(false);
  });

  it('returns true for DRAFT documents when includeDraftDocuments is true', () => {
    const doc = createMockDocument({ documentStatus: 'DRAFT' }) as Document;
    expect(isSyncableDocument(doc, true)).toBe(true);
  });

  it('returns false for unprocessed documents when requireProcessedDocuments is true', () => {
    const doc = createMockDocument({ processed: false }) as Document;
    expect(isSyncableDocument(doc, false, true)).toBe(false);
  });

  it('returns true for unprocessed documents when requireProcessedDocuments is false', () => {
    const doc = createMockDocument({ processed: false }) as Document;
    expect(isSyncableDocument(doc, false, false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveRuntimeDefaults
// ---------------------------------------------------------------------------
describe('resolveRuntimeDefaults', () => {
  it('returns defaults when config is empty', () => {
    const context = createMockContext();
    const defaults = resolveRuntimeDefaults(context);

    expect(defaults.defaultDocumentType).toBe('INCOMING_INVOICE');
    expect(defaults.payableDocumentType).toBe('INCOMING_INVOICE');
    expect(defaults.receivableDocumentType).toBe('SALES_INVOICE');
    expect(defaults.defaultPaymentMethod).toBe('bank_transfer');
    expect(defaults.defaultPaymentStatus).toBe('Unknown');
    expect(defaults.defaultCurrency).toBe('EUR');
    expect(defaults.autoCreateCompanies).toBe(true);
    expect(defaults.fallbackCompanyName).toBe('InvoiceLeaf Company');
    expect(defaults.runOcrOnUpload).toBe(false);
  });

  it('uses config overrides when provided', () => {
    const context = createMockContext({
      defaultDocumentType: 'RECEIPT',
      payableDocumentType: 'CREDIT_NOTE',
      receivableDocumentType: 'STATEMENT',
      defaultPaymentMethod: 'cash',
      defaultPaymentStatus: 'Paid',
      defaultCurrency: 'USD',
      autoCreateCompanies: false,
      fallbackCompanyName: 'Custom Fallback',
      runOcrOnUpload: true,
      defaultCountryUid: 42,
    });

    const defaults = resolveRuntimeDefaults(context);

    expect(defaults.defaultDocumentType).toBe('RECEIPT');
    expect(defaults.payableDocumentType).toBe('CREDIT_NOTE');
    expect(defaults.receivableDocumentType).toBe('STATEMENT');
    expect(defaults.defaultPaymentMethod).toBe('cash');
    expect(defaults.defaultPaymentStatus).toBe('Paid');
    expect(defaults.defaultCurrency).toBe('USD');
    expect(defaults.autoCreateCompanies).toBe(false);
    expect(defaults.fallbackCompanyName).toBe('Custom Fallback');
    expect(defaults.runOcrOnUpload).toBe(true);
    expect(defaults.defaultCountryUid).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// syncInvoices handler
// ---------------------------------------------------------------------------
describe('syncInvoices handler', () => {
  it('returns success with zero documents when page is empty', async () => {
    const context = createMockContext();
    // No documents returned from InvoiceLeaf
    vi.mocked(context.data.listDocuments).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 50,
      hasMore: false,
    });

    // Mock fetch calls for GetMyInvoices API operations won't be needed
    // since there are no documents to sync

    const result = await syncInvoices({} as never, context);

    expect(result.success).toBe(true);
    expect(result.synced).toBe(0);
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.checkpointUpdated).toBe(true);
    expect(result.message).toContain('Synced 0 document(s)');
  });

  it('skips non-syncable documents', async () => {
    const context = createMockContext();
    const deletedDoc = createMockDocument({ deleted: true });
    const cancelledDoc = createMockDocument({ id: 'doc-2', documentStatus: 'CANCELLED' });

    vi.mocked(context.data.listDocuments).mockResolvedValue({
      items: [deletedDoc as Document, cancelledDoc as Document],
      total: 2,
      page: 1,
      limit: 50,
      hasMore: false,
    });

    const result = await syncInvoices({} as never, context);

    expect(result.success).toBe(true);
    expect(result.processed).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.synced).toBe(0);
  });

  it('syncs a new document by uploading to GetMyInvoices', async () => {
    const context = createMockContext();
    const doc = createMockDocument();

    vi.mocked(context.data.listDocuments).mockResolvedValue({
      items: [doc as Document],
      total: 1,
      page: 1,
      limit: 50,
      hasMore: false,
    });

    // mappings.get returns null -> no existing mapping -> new document
    vi.mocked(context.mappings.get).mockResolvedValue(null);

    // Mock GetMyInvoices API calls:
    // 1. findDocumentByNumber (listDocuments with filter)
    // 2. listCompanies (for company cache)
    // 3. listCountries (for country resolution)
    // 4. uploadDocument
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ totalCount: 0, maxPages: 1, records: [] })) // findDocumentByNumber
      .mockResolvedValueOnce(jsonResponse([])) // listCompanies
      .mockResolvedValueOnce(jsonResponse([{ countryUid: 1, name: 'Germany', countryCode: 'DE' }])) // listCountries
      .mockResolvedValueOnce(jsonResponse({ companyUid: 99 })) // createCompany
      .mockResolvedValueOnce(jsonResponse({ documentUid: 500 })); // uploadDocument

    const result = await syncInvoices({} as never, context);

    expect(result.success).toBe(true);
    expect(result.synced).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);

    // Verify mapping was upserted
    expect(context.mappings.upsert).toHaveBeenCalled();
    // Verify integration meta was patched
    expect(context.data.patchDocumentIntegrationMeta).toHaveBeenCalled();
  });

  it('updates an existing document when mapping exists', async () => {
    const context = createMockContext();
    const doc = createMockDocument();

    vi.mocked(context.data.listDocuments).mockResolvedValue({
      items: [doc as Document],
      total: 1,
      page: 1,
      limit: 50,
      hasMore: false,
    });

    // Existing mapping found
    vi.mocked(context.mappings.get).mockResolvedValue({
      system: 'getmyinvoices',
      entity: 'document',
      localId: 'doc-1',
      externalId: '200',
    });

    // Mock GetMyInvoices API calls:
    // 1. listCompanies
    // 2. listCountries
    // 3. createCompany
    // 4. updateDocument
    mockFetch
      .mockResolvedValueOnce(jsonResponse([])) // listCompanies
      .mockResolvedValueOnce(jsonResponse([{ countryUid: 1, name: 'Germany', countryCode: 'DE' }])) // listCountries
      .mockResolvedValueOnce(jsonResponse({ companyUid: 99 })) // createCompany
      .mockResolvedValueOnce(jsonResponse({ documentUid: 200 })); // updateDocument (PUT)

    const result = await syncInvoices({} as never, context);

    expect(result.success).toBe(true);
    expect(result.synced).toBe(1);

    // Should NOT call getDocumentFile since it's an update
    expect(context.data.getDocumentFile).not.toHaveBeenCalled();
  });

  it('uses saved checkpoint from state when available', async () => {
    const context = createMockContext();
    const checkpoint = '2025-01-10T00:00:00.000Z';
    vi.mocked(context.state.get).mockResolvedValue({ lastSuccessfulSyncAt: checkpoint });
    vi.mocked(context.data.listDocuments).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 50,
      hasMore: false,
    });

    const result = await syncInvoices({} as never, context);

    expect(result.fromDate).toBe(checkpoint);
  });

  it('uses fallback lookback when state read fails', async () => {
    const context = createMockContext();
    vi.mocked(context.state.get).mockRejectedValue(new Error('state unavailable'));
    vi.mocked(context.data.listDocuments).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 50,
      hasMore: false,
    });

    const result = await syncInvoices({} as never, context);

    // Should succeed despite state error
    expect(result.success).toBe(true);
    expect(context.logger.warn).toHaveBeenCalled();
    // fromDate should be within last 24 hours
    const fromDate = new Date(result.fromDate);
    const now = Date.now();
    expect(now - fromDate.getTime()).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it('does not advance checkpoint when failures occur', async () => {
    const context = createMockContext();
    const doc = createMockDocument();

    vi.mocked(context.data.listDocuments).mockResolvedValue({
      items: [doc as Document],
      total: 1,
      page: 1,
      limit: 50,
      hasMore: false,
    });

    // Mapping check passes, but uploadDocument fails
    vi.mocked(context.mappings.get).mockResolvedValue(null);
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ totalCount: 0, maxPages: 1, records: [] })) // findDocumentByNumber
      .mockResolvedValueOnce(jsonResponse([])) // listCompanies
      .mockResolvedValueOnce(jsonResponse([{ countryUid: 1, name: 'Germany', countryCode: 'DE' }])) // listCountries
      .mockResolvedValueOnce(jsonResponse({ companyUid: 99 })) // createCompany
      .mockRejectedValueOnce(new Error('upload failed')); // uploadDocument

    const result = await syncInvoices({} as never, context);

    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.checkpointUpdated).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].documentId).toBe('doc-1');
  });

  it('returns error when resolveApiKey fails', async () => {
    const context = createMockContext();
    vi.mocked(context.credentials.getApiKey).mockResolvedValue('');
    vi.mocked(context.data.listDocuments).mockResolvedValue({
      items: [createMockDocument() as Document],
      total: 1,
      page: 1,
      limit: 50,
      hasMore: false,
    });

    const result = await syncInvoices({} as never, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('API key is missing');
  });

  it('respects maxDocumentsPerRun config', async () => {
    const context = createMockContext({ maxDocumentsPerRun: 2 });
    const docs = [
      createMockDocument({ id: 'doc-1', deleted: true }),
      createMockDocument({ id: 'doc-2', deleted: true }),
      createMockDocument({ id: 'doc-3', deleted: true }),
    ];

    vi.mocked(context.data.listDocuments).mockResolvedValue({
      items: docs as Document[],
      total: 3,
      page: 1,
      limit: 50,
      hasMore: true,
    });

    const result = await syncInvoices({} as never, context);

    // Only 2 should be processed due to maxDocumentsPerRun
    expect(result.processed).toBe(2);
  });
});
