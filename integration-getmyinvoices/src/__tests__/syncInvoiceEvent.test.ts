import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncInvoiceEvent } from '../handlers/syncInvoiceEvent.js';
import { createMockContext, createMockDocument, mockFetch, jsonResponse } from './helpers.js';
import type { Document } from '@invoiceleaf/integration-sdk';

beforeEach(() => {
  mockFetch.mockReset();
});

describe('syncInvoiceEvent handler', () => {
  it('returns error when documentId is missing', async () => {
    const context = createMockContext();

    const result = await syncInvoiceEvent({} as never, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing documentId');
  });

  it('extracts documentId from input.documentId', async () => {
    const context = createMockContext();
    const doc = createMockDocument();

    vi.mocked(context.data.getDocument).mockResolvedValue(doc as Document);
    vi.mocked(context.mappings.get).mockResolvedValue(null);

    // Mock fetch for: findDocumentByNumber, listCompanies, listCountries, createCompany, uploadDocument
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ totalCount: 0, maxPages: 1, records: [] }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ countryUid: 1, name: 'Germany', countryCode: 'DE' }]))
      .mockResolvedValueOnce(jsonResponse({ companyUid: 99 }))
      .mockResolvedValueOnce(jsonResponse({ documentUid: 500 }));

    const result = await syncInvoiceEvent(
      { documentId: 'doc-1' } as never,
      context
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('Synced document doc-1');
  });

  it('extracts documentId from input.document.id', async () => {
    const context = createMockContext();
    const doc = createMockDocument();

    vi.mocked(context.data.getDocument).mockResolvedValue(doc as Document);
    vi.mocked(context.mappings.get).mockResolvedValue(null);

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ totalCount: 0, maxPages: 1, records: [] }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ countryUid: 1, name: 'Germany', countryCode: 'DE' }]))
      .mockResolvedValueOnce(jsonResponse({ companyUid: 99 }))
      .mockResolvedValueOnce(jsonResponse({ documentUid: 500 }));

    const result = await syncInvoiceEvent(
      { document: { id: 'doc-1' } } as never,
      context
    );

    expect(result.success).toBe(true);
  });

  it('skips when document is no longer available', async () => {
    const context = createMockContext();
    vi.mocked(context.data.getDocument).mockRejectedValue(new Error('Not found'));

    const result = await syncInvoiceEvent(
      { documentId: 'doc-gone' } as never,
      context
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('no longer available');
  });

  it('skips non-syncable documents', async () => {
    const context = createMockContext();
    const doc = createMockDocument({ documentStatus: 'CANCELLED' });
    vi.mocked(context.data.getDocument).mockResolvedValue(doc as Document);

    const result = await syncInvoiceEvent(
      { documentId: 'doc-1' } as never,
      context
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('not syncable');
  });

  it('returns error and patches failure metadata on sync error', async () => {
    const context = createMockContext();
    const doc = createMockDocument();
    vi.mocked(context.data.getDocument).mockResolvedValue(doc as Document);
    vi.mocked(context.mappings.get).mockResolvedValue(null);

    // findDocumentByNumber succeeds, but upload fails
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ totalCount: 0, maxPages: 1, records: [] }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockRejectedValueOnce(new Error('API connection timeout')); // createCompany fails

    const result = await syncInvoiceEvent(
      { documentId: 'doc-1' } as never,
      context
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('API connection timeout');
    expect(context.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        status: 'failed',
      })
    );
  });

  it('still returns success when patchDocumentIntegrationMeta fails after successful sync', async () => {
    const context = createMockContext();
    const doc = createMockDocument();
    vi.mocked(context.data.getDocument).mockResolvedValue(doc as Document);
    vi.mocked(context.mappings.get).mockResolvedValue({
      system: 'getmyinvoices',
      entity: 'document',
      localId: 'doc-1',
      externalId: '200',
    });

    // updateDocument succeeds
    mockFetch
      .mockResolvedValueOnce(jsonResponse([])) // listCompanies
      .mockResolvedValueOnce(jsonResponse([{ countryUid: 1, name: 'Germany', countryCode: 'DE' }])) // listCountries
      .mockResolvedValueOnce(jsonResponse({ companyUid: 99 })) // createCompany
      .mockResolvedValueOnce(jsonResponse({ documentUid: 200 })); // updateDocument

    // But patchDocumentIntegrationMeta fails
    vi.mocked(context.data.patchDocumentIntegrationMeta).mockRejectedValueOnce(
      new Error('meta patch failed')
    );

    const result = await syncInvoiceEvent(
      { documentId: 'doc-1' } as never,
      context
    );

    // Should still succeed since the sync itself worked
    expect(result.success).toBe(true);
    expect(context.logger.warn).toHaveBeenCalled();
  });

  it('returns error when API key is missing', async () => {
    const context = createMockContext();
    vi.mocked(context.credentials.getApiKey).mockResolvedValue('');

    const result = await syncInvoiceEvent(
      { documentId: 'doc-1' } as never,
      context
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('API key is missing');
  });
});
