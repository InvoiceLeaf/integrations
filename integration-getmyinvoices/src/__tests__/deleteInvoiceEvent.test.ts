import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deleteInvoiceEvent } from '../handlers/deleteInvoiceEvent.js';
import { createMockContext, mockFetch, jsonResponse } from './helpers.js';

beforeEach(() => {
  mockFetch.mockReset();
});

describe('deleteInvoiceEvent handler', () => {
  it('returns error when documentId is missing', async () => {
    const context = createMockContext();

    const result = await deleteInvoiceEvent({} as never, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing documentId');
  });

  it('returns success with message when no mapping exists', async () => {
    const context = createMockContext();
    vi.mocked(context.mappings.get).mockResolvedValue(null);

    const result = await deleteInvoiceEvent(
      { documentId: 'doc-1' } as never,
      context
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('No GetMyInvoices mapping');
  });

  it('deletes the document on GetMyInvoices when mapping exists', async () => {
    const context = createMockContext();
    vi.mocked(context.mappings.get).mockResolvedValue({
      system: 'getmyinvoices',
      entity: 'document',
      localId: 'doc-1',
      externalId: '42',
    });

    // deleteDocument API call
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    const result = await deleteInvoiceEvent(
      { documentId: 'doc-1' } as never,
      context
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('Deleted GetMyInvoices document 42');

    // Verify DELETE was called
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('DELETE');
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/documents/42');

    // Verify integration meta was patched
    expect(context.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        status: 'deleted',
        externalId: '42',
      })
    );

    // Verify mapping was upserted with deletedAt
    expect(context.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'getmyinvoices',
        entity: 'document',
        localId: 'doc-1',
        externalId: '42',
      })
    );
  });

  it('returns error when API delete fails', async () => {
    const context = createMockContext();
    vi.mocked(context.mappings.get).mockResolvedValue({
      system: 'getmyinvoices',
      entity: 'document',
      localId: 'doc-1',
      externalId: '42',
    });

    mockFetch.mockRejectedValueOnce(new Error('delete failed'));

    const result = await deleteInvoiceEvent(
      { documentId: 'doc-1' } as never,
      context
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('delete failed');
    expect(context.logger.error).toHaveBeenCalled();
  });

  it('still returns success when patchDocumentIntegrationMeta fails after deletion', async () => {
    const context = createMockContext();
    vi.mocked(context.mappings.get).mockResolvedValue({
      system: 'getmyinvoices',
      entity: 'document',
      localId: 'doc-1',
      externalId: '42',
    });

    // deleteDocument succeeds
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    // But patchDocumentIntegrationMeta fails
    vi.mocked(context.data.patchDocumentIntegrationMeta).mockRejectedValueOnce(
      new Error('meta patch failed')
    );

    const result = await deleteInvoiceEvent(
      { documentId: 'doc-1' } as never,
      context
    );

    expect(result.success).toBe(true);
    expect(context.logger.warn).toHaveBeenCalled();
  });

  it('returns success when mapping externalId is not a valid integer', async () => {
    const context = createMockContext();
    vi.mocked(context.mappings.get).mockResolvedValue({
      system: 'getmyinvoices',
      entity: 'document',
      localId: 'doc-1',
      externalId: 'not-a-number',
    });

    const result = await deleteInvoiceEvent(
      { documentId: 'doc-1' } as never,
      context
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('No GetMyInvoices mapping');
  });

  it('preserves existing mapping metadata when upserting after delete', async () => {
    const context = createMockContext();
    vi.mocked(context.mappings.get).mockResolvedValue({
      system: 'getmyinvoices',
      entity: 'document',
      localId: 'doc-1',
      externalId: '42',
      metadata: { direction: 'outbound', documentNumber: 'INV-001' },
    });

    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await deleteInvoiceEvent(
      { documentId: 'doc-1' } as never,
      context
    );

    const upsertCall = vi.mocked(context.mappings.upsert).mock.calls[0][0];
    expect(upsertCall.metadata).toMatchObject({
      direction: 'outbound',
      documentNumber: 'INV-001',
    });
    expect(upsertCall.metadata).toHaveProperty('deletedAt');
  });
});
