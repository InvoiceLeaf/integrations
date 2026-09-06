import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pullDocumentsFromGetmyinvoices } from '../handlers/pullDocumentsFromGetmyinvoices.js';
import { createMockContext, mockFetch, jsonResponse } from './helpers.js';

beforeEach(() => {
  mockFetch.mockReset();
});

describe('pullDocumentsFromGetmyinvoices handler', () => {
  // -------------------------------------------------------------------------
  // Config-driven skip
  // -------------------------------------------------------------------------
  it('returns success immediately when enableInboundSync is false', async () => {
    const context = createMockContext({ enableInboundSync: false });

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.success).toBe(true);
    expect(result.message).toContain('disabled');
    expect(result.checkpointUpdated).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Empty sync
  // -------------------------------------------------------------------------
  it('returns success with zero counts when no documents found', async () => {
    const context = createMockContext();

    // listDocuments returns empty
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, maxPages: 1, records: [] })
    );
    // listDeletedDocuments returns empty
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, records: [] })
    );

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.success).toBe(true);
    expect(result.imported).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.processed).toBe(0);
    expect(result.checkpointUpdated).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Import a new document
  // -------------------------------------------------------------------------
  it('imports a new document when no mapping exists', async () => {
    const context = createMockContext();

    // mappings.findByExternal returns null -> new document
    vi.mocked(context.mappings.findByExternal).mockResolvedValue(null);

    // listDocuments returns one document
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 1,
        maxPages: 1,
        records: [{ documentUid: 100, documentNumber: 'GMI-001', filename: 'invoice.pdf' }],
      })
    );

    // downloadDocumentFile returns binary
    const binaryContent = Buffer.from('pdf-content');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="invoice.pdf"',
      }),
      arrayBuffer: async () => binaryContent.buffer.slice(
        binaryContent.byteOffset,
        binaryContent.byteOffset + binaryContent.byteLength
      ),
    });

    // listDeletedDocuments returns empty
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, records: [] })
    );

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.processed).toBe(1);

    // Verify importDocument was called
    expect(context.data.importDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'invoice.pdf',
        contentType: 'application/pdf',
        source: 'getmyinvoices',
      })
    );

    // Verify mapping was created
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'getmyinvoices',
        entity: 'document',
        externalId: '100',
      })
    );
  });

  // -------------------------------------------------------------------------
  // Update an existing document
  // -------------------------------------------------------------------------
  it('updates existing document when mapping exists', async () => {
    const context = createMockContext();

    vi.mocked(context.mappings.findByExternal).mockResolvedValue({
      system: 'getmyinvoices',
      entity: 'document',
      localId: 'local-doc-1',
      externalId: '100',
      metadata: { direction: 'inbound' },
    });

    // listDocuments returns one document
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 1,
        maxPages: 1,
        records: [{ documentUid: 100, documentNumber: 'GMI-001' }],
      })
    );

    // listDeletedDocuments returns empty
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, records: [] })
    );

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);
    expect(result.imported).toBe(0);

    // Should NOT call importDocument for existing doc
    expect(context.data.importDocument).not.toHaveBeenCalled();

    // Should update integration meta
    expect(context.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'local-doc-1',
        status: 'synced',
      })
    );
  });

  // -------------------------------------------------------------------------
  // Skipped documents
  // -------------------------------------------------------------------------
  it('skips documents with no documentUid', async () => {
    const context = createMockContext();

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 1,
        maxPages: 1,
        records: [{ documentNumber: 'GMI-001' }], // no documentUid
      })
    );

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, records: [] })
    );

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Deleted document reconciliation
  // -------------------------------------------------------------------------
  it('reconciles deleted documents', async () => {
    const context = createMockContext();

    // No new documents
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, maxPages: 1, records: [] })
    );

    // Deleted documents with existing mapping
    vi.mocked(context.mappings.findByExternal).mockResolvedValue({
      system: 'getmyinvoices',
      entity: 'document',
      localId: 'local-doc-1',
      externalId: '200',
      metadata: { direction: 'inbound' },
    });

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 1,
        records: [{ documentUid: 200, deletedAt: '2025-01-15' }],
      })
    );

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.deleted).toBe(1);
    expect(context.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'local-doc-1',
        status: 'deleted',
      })
    );
  });

  it('skips deleted documents with no local mapping', async () => {
    const context = createMockContext();

    // No new documents
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, maxPages: 1, records: [] })
    );

    vi.mocked(context.mappings.findByExternal).mockResolvedValue(null);

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 1,
        records: [{ documentUid: 300, deletedAt: '2025-01-15' }],
      })
    );

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.deleted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Skips deleted documents when inboundIncludeDeleted is false
  // -------------------------------------------------------------------------
  it('skips deleted documents phase when inboundIncludeDeleted is false', async () => {
    const context = createMockContext({ inboundIncludeDeleted: false });

    // No new documents
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, maxPages: 1, records: [] })
    );

    // listDeletedDocuments should NOT be called

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(0);
    // Only one fetch call (listDocuments), no listDeletedDocuments
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Checkpoint handling
  // -------------------------------------------------------------------------
  it('uses saved checkpoint when available', async () => {
    const context = createMockContext();
    vi.mocked(context.state.get).mockResolvedValue({
      lastInboundSyncAt: '2025-01-10T00:00:00.000Z',
    });

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, maxPages: 1, records: [] })
    );
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, records: [] })
    );

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.fromDate).toBe('2025-01-10T00:00:00.000Z');
  });

  it('uses fallback when state read fails', async () => {
    const context = createMockContext();
    vi.mocked(context.state.get).mockRejectedValue(new Error('state unavailable'));

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, maxPages: 1, records: [] })
    );
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, records: [] })
    );

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.success).toBe(true);
    expect(context.logger.warn).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Checkpoint not advanced on 100% failure
  // -------------------------------------------------------------------------
  it('does not advance checkpoint when all documents failed', async () => {
    const context = createMockContext();

    // A document that will fail to import
    vi.mocked(context.mappings.findByExternal).mockResolvedValue(null);

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 1,
        maxPages: 1,
        records: [{ documentUid: 100, documentNumber: 'GMI-001' }],
      })
    );

    // downloadDocumentFile fails on every attempt (GET requests retry up to 3 times)
    mockFetch
      .mockRejectedValueOnce(new Error('download failed'))
      .mockRejectedValueOnce(new Error('download failed'))
      .mockRejectedValueOnce(new Error('download failed'));

    // No deleted documents
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, records: [] })
    );

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.success).toBe(true); // handler itself succeeds, individual failures tracked
    expect(result.failed).toBe(1);
    expect(result.checkpointUpdated).toBe(false);
    expect(context.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('All documents failed'),
      expect.anything()
    );
  });

  // -------------------------------------------------------------------------
  // API key missing
  // -------------------------------------------------------------------------
  it('returns error when API key is missing', async () => {
    const context = createMockContext();
    vi.mocked(context.credentials.getApiKey).mockResolvedValue('');

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('API key is missing');
  });

  // -------------------------------------------------------------------------
  // Failure tracking
  // -------------------------------------------------------------------------
  it('reports failures with documentId and error message', async () => {
    const context = createMockContext();

    vi.mocked(context.mappings.findByExternal).mockResolvedValue(null);

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 1,
        maxPages: 1,
        records: [{ documentUid: 100, documentNumber: 'GMI-001' }],
      })
    );

    // downloadDocumentFile fails on every attempt (GET requests retry up to 3 times)
    mockFetch
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'));

    // No deleted documents
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, records: [] })
    );

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].documentId).toBe('100');
    expect(result.failures[0].error).toContain('timeout');
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------
  it('paginates through multiple pages of documents', async () => {
    const context = createMockContext();

    vi.mocked(context.mappings.findByExternal).mockResolvedValue({
      system: 'getmyinvoices',
      entity: 'document',
      localId: 'local-1',
      externalId: '100',
    });

    // Page 1
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 2,
        maxPages: 2,
        records: [{ documentUid: 100, documentNumber: 'GMI-001' }],
      })
    );

    // Page 2
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 2,
        maxPages: 2,
        records: [{ documentUid: 101, documentNumber: 'GMI-002' }],
      })
    );

    // listDeletedDocuments
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, records: [] })
    );

    const result = await pullDocumentsFromGetmyinvoices({} as never, context);

    expect(result.success).toBe(true);
    expect(result.processed).toBe(2);
  });
});
