import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncInvoiceEvent } from '../handlers/syncInvoiceEvent.js';
import {
  createMockContext,
  createMockDocument,
  createMockDocumentFile,
} from './helpers.js';

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

describe('syncInvoiceEvent', () => {
  it('skips when event sync is disabled', async () => {
    const ctx = createMockContext({ enableEventSync: false });
    const result = await syncInvoiceEvent({ documentId: 'doc-1' }, ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('disabled');
  });

  it('returns error when documentId is missing', async () => {
    const ctx = createMockContext();
    const result = await syncInvoiceEvent({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing documentId');
  });

  it('extracts documentId from document.id when documentId not directly present', async () => {
    const ctx = createMockContext({}, {
      data: {
        ...createMockContext().data,
        getDocument: vi.fn().mockResolvedValue(createMockDocument({ id: 'doc-nested' })),
        getDocumentFile: vi.fn().mockResolvedValue(createMockDocumentFile()),
        listDocuments: vi.fn(),
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

    // 3 fetch calls for syncSingleDocument
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-nested' }));
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({}));
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-nested', status: 200 }));

    const result = await syncInvoiceEvent(
      { document: { id: 'doc-nested' } } as { documentId?: string; document?: { id: string } },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('doc-nested');
  });

  it('skips when document is no longer available', async () => {
    const ctx = createMockContext({}, {
      data: {
        ...createMockContext().data,
        getDocument: vi.fn().mockRejectedValue(new Error('Not found')),
        getDocumentFile: vi.fn(),
        listDocuments: vi.fn(),
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

    const result = await syncInvoiceEvent({ documentId: 'doc-gone' }, ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('no longer available');
  });

  it('skips non-syncable documents', async () => {
    const ctx = createMockContext({}, {
      data: {
        ...createMockContext().data,
        getDocument: vi.fn().mockResolvedValue(
          createMockDocument({ id: 'doc-draft', documentStatus: 'DRAFT' })
        ),
        getDocumentFile: vi.fn(),
        listDocuments: vi.fn(),
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

    const result = await syncInvoiceEvent({ documentId: 'doc-draft' }, ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('not syncable');
  });

  it('syncs document successfully and patches metadata', async () => {
    const doc = createMockDocument({ id: 'doc-sync' });

    const ctx = createMockContext({}, {
      data: {
        ...createMockContext().data,
        getDocument: vi.fn().mockResolvedValue(doc),
        getDocumentFile: vi.fn().mockResolvedValue(createMockDocumentFile({ documentId: 'doc-sync' })),
        listDocuments: vi.fn(),
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

    // 3 fetch calls for syncSingleDocument
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-sync' }));
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({}));
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-sync', status: 200 }));

    const result = await syncInvoiceEvent({ documentId: 'doc-sync' }, ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Synced document doc-sync');
    expect(result.message).toContain('job-sync');

    // Should patch metadata at least once (syncSingleDocument does it, and syncInvoiceEvent does too)
    expect(ctx.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-sync',
        system: 'datev',
        status: 'synced',
      })
    );
  });

  it('patches failure metadata when sync fails', async () => {
    const doc = createMockDocument({ id: 'doc-fail' });

    const ctx = createMockContext({}, {
      data: {
        ...createMockContext().data,
        getDocument: vi.fn().mockResolvedValue(doc),
        getDocumentFile: vi.fn().mockResolvedValue(createMockDocumentFile({ documentId: 'doc-fail' })),
        listDocuments: vi.fn(),
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

    const result = await syncInvoiceEvent({ documentId: 'doc-fail' }, ctx);

    expect(result.success).toBe(false);

    // Should patch failure metadata
    expect(ctx.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-fail',
        system: 'datev',
        status: 'failed',
      })
    );
  });

  it('handles metadata patch failure gracefully', async () => {
    const doc = createMockDocument({ id: 'doc-meta-fail' });

    const ctx = createMockContext({}, {
      data: {
        ...createMockContext().data,
        getDocument: vi.fn().mockResolvedValue(doc),
        getDocumentFile: vi.fn().mockResolvedValue(createMockDocumentFile()),
        listDocuments: vi.fn(),
        listCompanies: vi.fn(),
        getCompany: vi.fn(),
        listCategories: vi.fn(),
        getCategory: vi.fn(),
        getTag: vi.fn(),
        listTags: vi.fn(),
        createExport: vi.fn(),
        getExport: vi.fn(),
        importDocument: vi.fn(),
        patchDocumentIntegrationMeta: vi.fn()
          .mockResolvedValueOnce(undefined) // syncSingleDocument's call
          .mockRejectedValueOnce(new Error('meta patch failed')), // syncInvoiceEvent's call
      },
    });

    // 3 fetch calls for syncSingleDocument
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-ok' }));
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({}));
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({ id: 'job-ok', status: 200 }));

    const result = await syncInvoiceEvent({ documentId: 'doc-meta-fail' }, ctx);

    // Should still succeed despite meta patch failure
    expect(result.success).toBe(true);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });
});
