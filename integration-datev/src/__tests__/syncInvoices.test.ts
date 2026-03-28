import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  syncInvoices,
  isSyncableDocument,
  syncSingleDocument,
  SYNC_STATE_KEY,
  SYSTEM,
  ENTITY_DXSO_JOB,
} from '../handlers/syncInvoices.js';
import {
  createMockContext,
  createMockDocument,
  createMockDocumentFile,
  createMockDocumentList,
} from './helpers.js';
import type { Document } from '@invoiceleaf/integration-sdk';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonFetchResponse(body: unknown, status = 200): object {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    text: vi.fn().mockResolvedValue(text),
    arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(text).buffer),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// isSyncableDocument
// ---------------------------------------------------------------------------

describe('isSyncableDocument', () => {
  it('returns true for a valid processed document', () => {
    const doc = createMockDocument();
    expect(isSyncableDocument(doc, false, true)).toBe(true);
  });

  it('returns false for document without id', () => {
    const doc = createMockDocument({ id: '' });
    expect(isSyncableDocument(doc, false)).toBe(false);
  });

  it('returns false for deleted document', () => {
    const doc = createMockDocument({ deleted: true });
    expect(isSyncableDocument(doc, false)).toBe(false);
  });

  it('returns false for duplicate document', () => {
    const doc = createMockDocument({ duplicateOfId: 'original-doc' });
    expect(isSyncableDocument(doc, false)).toBe(false);
  });

  it('returns false for CANCELLED document', () => {
    const doc = createMockDocument({ documentStatus: 'CANCELLED' });
    expect(isSyncableDocument(doc, false)).toBe(false);
  });

  it('returns false for DRAFT when includeDraftDocuments is false', () => {
    const doc = createMockDocument({ documentStatus: 'DRAFT' });
    expect(isSyncableDocument(doc, false)).toBe(false);
  });

  it('returns true for DRAFT when includeDraftDocuments is true', () => {
    const doc = createMockDocument({ documentStatus: 'DRAFT' });
    expect(isSyncableDocument(doc, true)).toBe(true);
  });

  it('returns false for unprocessed document when requireProcessedDocuments is true', () => {
    const doc = createMockDocument({ processed: false });
    expect(isSyncableDocument(doc, false, true)).toBe(false);
  });

  it('returns true for unprocessed document when requireProcessedDocuments is false', () => {
    const doc = createMockDocument({ processed: false });
    expect(isSyncableDocument(doc, false, false)).toBe(true);
  });

  it('returns false for zero-amount document', () => {
    const doc = createMockDocument({ totalAmount: 0, netAmount: 0, amountDue: 0 });
    expect(isSyncableDocument(doc, false)).toBe(false);
  });

  it('returns true when totalAmount is zero but netAmount is non-zero', () => {
    const doc = createMockDocument({ totalAmount: 0, netAmount: 100 });
    // totalAmount is checked first and is 0, so false
    expect(isSyncableDocument(doc, false)).toBe(false);
  });

  it('returns true when only amountDue is non-zero', () => {
    const doc = createMockDocument({ totalAmount: undefined, netAmount: undefined, amountDue: 50 });
    expect(isSyncableDocument(doc, false)).toBe(true);
  });

  it('returns true when amounts are undefined', () => {
    const doc = createMockDocument({ totalAmount: undefined, netAmount: undefined, amountDue: undefined });
    // amount is undefined (not 0), so it passes
    expect(isSyncableDocument(doc, false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// syncSingleDocument
// ---------------------------------------------------------------------------

describe('syncSingleDocument', () => {
  it('creates a DATEV job, uploads the file, and finalizes', async () => {
    // createDxsoJob response
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-abc' }));
    // uploadDxsoJobFile response
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ uploaded: true }));
    // finalizeDxsoJob response
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-abc', status: 200 }));

    const ctx = createMockContext();
    const doc = createMockDocument();
    const result = await syncSingleDocument(ctx, doc);

    expect(result.jobId).toBe('job-abc');
    expect(result.clientId).toBe('455148-1');
    expect(result.importType).toBe('accountsReceivableLedgerImport');
    expect(result.jobStatus).toBe(200);

    // Verify mapping upserted
    expect(ctx.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        system: SYSTEM,
        entity: ENTITY_DXSO_JOB,
        localId: 'doc-1',
        externalId: 'job-abc',
      })
    );

    // Verify integration meta patched
    expect(ctx.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        system: SYSTEM,
        externalId: 'job-abc',
        status: 'synced',
      })
    );
  });

  it('throws when document has no file content', async () => {
    const ctx = createMockContext({}, {
      data: {
        ...createMockContext().data,
        getDocumentFile: vi.fn().mockResolvedValue({
          documentId: 'doc-1',
          contentBase64: '',
        }),
        listDocuments: vi.fn(),
        getDocument: vi.fn(),
        listCompanies: vi.fn(),
        getCompany: vi.fn(),
        listCategories: vi.fn(),
        getCategory: vi.fn(),
        getTag: vi.fn(),
        listTags: vi.fn(),
        createExport: vi.fn(),
        getExport: vi.fn(),
        importDocument: vi.fn(),
        patchDocumentIntegrationMeta: vi.fn(),
      },
    });

    const doc = createMockDocument();
    await expect(syncSingleDocument(ctx, doc)).rejects.toThrow('does not have file content');
  });

  it('throws when DATEV does not return a job id', async () => {
    // createDxsoJob returns no id
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ account_length: 4 }));

    const ctx = createMockContext();
    const doc = createMockDocument();

    await expect(syncSingleDocument(ctx, doc)).rejects.toThrow('did not return a dxso-job id');
  });

  it('resolves PAYABLE accountingType to accountsPayableLedgerImport', async () => {
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-pay' }));
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({}));
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-pay', status: 200 }));

    const ctx = createMockContext({ defaultImportType: undefined, defaultAccountingMonth: undefined });
    const doc = createMockDocument({ accountingType: 'PAYABLE', invoiceDate: '2026-03-15' });
    const result = await syncSingleDocument(ctx, doc);

    expect(result.importType).toBe('accountsPayableLedgerImport');
    expect(result.accountingMonth).toBe('2026-03');
  });

  it('uses document invoiceDate for accounting month when no default', async () => {
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-date' }));
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({}));
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-date', status: 200 }));

    const ctx = createMockContext({ defaultAccountingMonth: undefined });
    const doc = createMockDocument({ invoiceDate: '2025-07-22' });
    const result = await syncSingleDocument(ctx, doc);

    expect(result.accountingMonth).toBe('2025-07');
  });
});

// ---------------------------------------------------------------------------
// syncInvoices (scheduled handler)
// ---------------------------------------------------------------------------

describe('syncInvoices', () => {
  it('returns success with zero documents', async () => {
    const ctx = createMockContext();
    const result = await syncInvoices({}, ctx);

    expect(result.success).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.synced).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.checkpointUpdated).toBe(true);
    expect(result.message).toContain('Synced 0 document(s)');
  });

  it('syncs documents successfully', async () => {
    const doc1 = createMockDocument({ id: 'doc-1' });
    const doc2 = createMockDocument({ id: 'doc-2', accountingType: 'PAYABLE' });

    const ctx = createMockContext({}, {
      data: {
        ...createMockContext().data,
        listDocuments: vi.fn().mockResolvedValue(createMockDocumentList([doc1, doc2])),
        getDocument: vi.fn(),
        getDocumentFile: vi.fn().mockResolvedValue(createMockDocumentFile()),
        listCompanies: vi.fn(),
        getCompany: vi.fn(),
        listCategories: vi.fn(),
        getCategory: vi.fn(),
        getTag: vi.fn(),
        listTags: vi.fn(),
        createExport: vi.fn(),
        getExport: vi.fn(),
        importDocument: vi.fn(),
        patchDocumentIntegrationMeta: vi.fn().mockResolvedValue(undefined),
      },
    });

    // Each doc: createDxsoJob + uploadDxsoJobFile + finalizeDxsoJob = 3 fetch calls each
    for (let i = 0; i < 2; i++) {
      mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: `job-${i}` }));
      mockFetch.mockResolvedValueOnce(jsonFetchResponse({}));
      mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: `job-${i}`, status: 200 }));
    }

    const result = await syncInvoices({}, ctx);

    expect(result.success).toBe(true);
    expect(result.processed).toBe(2);
    expect(result.synced).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.checkpointUpdated).toBe(true);
  });

  it('skips non-syncable documents', async () => {
    const syncableDoc = createMockDocument({ id: 'doc-ok' });
    const draftDoc = createMockDocument({ id: 'doc-draft', documentStatus: 'DRAFT' });

    const ctx = createMockContext({}, {
      data: {
        ...createMockContext().data,
        listDocuments: vi.fn().mockResolvedValue(createMockDocumentList([syncableDoc, draftDoc])),
        getDocument: vi.fn(),
        getDocumentFile: vi.fn().mockResolvedValue(createMockDocumentFile()),
        listCompanies: vi.fn(),
        getCompany: vi.fn(),
        listCategories: vi.fn(),
        getCategory: vi.fn(),
        getTag: vi.fn(),
        listTags: vi.fn(),
        createExport: vi.fn(),
        getExport: vi.fn(),
        importDocument: vi.fn(),
        patchDocumentIntegrationMeta: vi.fn().mockResolvedValue(undefined),
      },
    });

    // Only 1 doc is syncable: 3 fetch calls
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-ok' }));
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({}));
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-ok', status: 200 }));

    const result = await syncInvoices({}, ctx);

    expect(result.processed).toBe(2);
    expect(result.synced).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('records failures and does not update checkpoint', async () => {
    const doc = createMockDocument({ id: 'doc-fail' });

    const ctx = createMockContext({}, {
      data: {
        ...createMockContext().data,
        listDocuments: vi.fn().mockResolvedValue(createMockDocumentList([doc])),
        getDocument: vi.fn(),
        getDocumentFile: vi.fn().mockResolvedValue(createMockDocumentFile()),
        listCompanies: vi.fn(),
        getCompany: vi.fn(),
        listCategories: vi.fn(),
        getCategory: vi.fn(),
        getTag: vi.fn(),
        listTags: vi.fn(),
        createExport: vi.fn(),
        getExport: vi.fn(),
        importDocument: vi.fn(),
        patchDocumentIntegrationMeta: vi.fn().mockResolvedValue(undefined),
      },
    });

    // createDxsoJob fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('Server Error'),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('Server Error').buffer),
    });

    const result = await syncInvoices({}, ctx);

    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].documentId).toBe('doc-fail');
    expect(result.checkpointUpdated).toBe(false);
  });

  it('reads checkpoint from state', async () => {
    const pastDate = '2026-03-01T00:00:00.000Z';
    const ctx = createMockContext({}, {
      state: {
        get: vi.fn().mockResolvedValue({ lastSuccessfulSyncAt: pastDate }),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
      },
    });

    const result = await syncInvoices({}, ctx);

    expect(result.fromDate).toBe(pastDate);
  });

  it('uses fallback lookback when checkpoint is corrupted', async () => {
    const ctx = createMockContext({ initialSyncLookbackHours: 48 }, {
      state: {
        get: vi.fn().mockResolvedValue({ lastSuccessfulSyncAt: 'not-a-date' }),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
      },
    });

    const result = await syncInvoices({}, ctx);

    // Should have used fallback, not the corrupted value
    expect(result.fromDate).not.toBe('not-a-date');
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('paginates through documents', async () => {
    const page1Docs = [createMockDocument({ id: 'doc-p1' })];
    const page2Docs = [createMockDocument({ id: 'doc-p2' })];

    const listDocumentsFn = vi.fn()
      .mockResolvedValueOnce({ items: page1Docs, total: 2, page: 1, limit: 1, hasMore: true })
      .mockResolvedValueOnce({ items: page2Docs, total: 2, page: 2, limit: 1, hasMore: false });

    const ctx = createMockContext({ pageSize: 1 }, {
      data: {
        ...createMockContext().data,
        listDocuments: listDocumentsFn,
        getDocument: vi.fn(),
        getDocumentFile: vi.fn().mockResolvedValue(createMockDocumentFile()),
        listCompanies: vi.fn(),
        getCompany: vi.fn(),
        listCategories: vi.fn(),
        getCategory: vi.fn(),
        getTag: vi.fn(),
        listTags: vi.fn(),
        createExport: vi.fn(),
        getExport: vi.fn(),
        importDocument: vi.fn(),
        patchDocumentIntegrationMeta: vi.fn().mockResolvedValue(undefined),
      },
    });

    // 2 docs * 3 calls each = 6 fetch calls
    for (let i = 0; i < 2; i++) {
      mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: `job-${i}` }));
      mockFetch.mockResolvedValueOnce(jsonFetchResponse({}));
      mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: `job-${i}`, status: 200 }));
    }

    const result = await syncInvoices({}, ctx);

    expect(result.processed).toBe(2);
    expect(result.synced).toBe(2);
    expect(listDocumentsFn).toHaveBeenCalledTimes(2);
  });

  it('respects maxDocumentsPerRun', async () => {
    const docs = Array.from({ length: 5 }, (_, i) => createMockDocument({ id: `doc-${i}` }));

    const ctx = createMockContext({ maxDocumentsPerRun: 2 }, {
      data: {
        ...createMockContext().data,
        listDocuments: vi.fn().mockResolvedValue(createMockDocumentList(docs, true)),
        getDocument: vi.fn(),
        getDocumentFile: vi.fn().mockResolvedValue(createMockDocumentFile()),
        listCompanies: vi.fn(),
        getCompany: vi.fn(),
        listCategories: vi.fn(),
        getCategory: vi.fn(),
        getTag: vi.fn(),
        listTags: vi.fn(),
        createExport: vi.fn(),
        getExport: vi.fn(),
        importDocument: vi.fn(),
        patchDocumentIntegrationMeta: vi.fn().mockResolvedValue(undefined),
      },
    });

    // 2 docs synced: 6 fetch calls
    for (let i = 0; i < 2; i++) {
      mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: `job-${i}` }));
      mockFetch.mockResolvedValueOnce(jsonFetchResponse({}));
      mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: `job-${i}`, status: 200 }));
    }

    const result = await syncInvoices({}, ctx);

    expect(result.processed).toBe(2);
  });
});
