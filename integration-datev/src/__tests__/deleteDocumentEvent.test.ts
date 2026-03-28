import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteDocumentEvent } from '../handlers/deleteDocumentEvent.js';
import { DatevApiError } from '../datev/client.js';
import { createMockContext } from './helpers.js';

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

describe('deleteDocumentEvent', () => {
  it('returns error when documentId is missing', async () => {
    const ctx = createMockContext({ cancelOnDeleteEvent: true });
    const result = await deleteDocumentEvent({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing documentId');
  });

  it('skips when cancelOnDeleteEvent is disabled', async () => {
    const ctx = createMockContext({ cancelOnDeleteEvent: false });
    const result = await deleteDocumentEvent({ documentId: 'doc-1' }, ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('disabled');
  });

  it('skips when no mapping exists for the document', async () => {
    const ctx = createMockContext({ cancelOnDeleteEvent: true }, {
      mappings: {
        get: vi.fn().mockResolvedValue(null),
        findByExternal: vi.fn(),
        upsert: vi.fn(),
      },
    });

    const result = await deleteDocumentEvent({ documentId: 'doc-no-mapping' }, ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('No DATEV job mapping');
  });

  it('cancels DATEV job and updates mapping/metadata', async () => {
    const mapping = {
      system: 'datev',
      entity: 'dxso-job',
      localId: 'doc-1',
      externalId: 'job-abc',
      metadata: { clientId: '455148-1' },
    };

    const ctx = createMockContext({ cancelOnDeleteEvent: true }, {
      mappings: {
        get: vi.fn().mockResolvedValue(mapping),
        findByExternal: vi.fn(),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    });

    // cancelDxsoJob DELETE call
    mockFetch.mockResolvedValueOnce(jsonFetchResponse({}));

    const result = await deleteDocumentEvent({ documentId: 'doc-1' }, ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('doc-1');
    expect(result.message).toContain('job-abc');

    // Should update integration metadata with deleted status
    expect(ctx.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        system: 'datev',
        status: 'deleted',
      })
    );

    // Should upsert mapping with deletedAt
    expect(ctx.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'datev',
        entity: 'dxso-job',
        localId: 'doc-1',
        externalId: 'job-abc',
      })
    );
  });

  it('treats 404 cancellation error as already finalized', async () => {
    const mapping = {
      system: 'datev',
      entity: 'dxso-job',
      localId: 'doc-1',
      externalId: 'job-404',
      metadata: { clientId: '455148-1' },
    };

    const ctx = createMockContext({ cancelOnDeleteEvent: true }, {
      mappings: {
        get: vi.fn().mockResolvedValue(mapping),
        findByExternal: vi.fn(),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    });

    // cancelDxsoJob returns 404
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('Not Found'),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('Not Found').buffer),
    });

    const result = await deleteDocumentEvent({ documentId: 'doc-1' }, ctx);

    // Should still succeed (treated as already finalized)
    expect(result.success).toBe(true);
    expect(ctx.logger.info).toHaveBeenCalled();
  });

  it('treats 400 cancellation error as already finalized', async () => {
    const mapping = {
      system: 'datev',
      entity: 'dxso-job',
      localId: 'doc-1',
      externalId: 'job-400',
      metadata: { clientId: '455148-1' },
    };

    const ctx = createMockContext({ cancelOnDeleteEvent: true }, {
      mappings: {
        get: vi.fn().mockResolvedValue(mapping),
        findByExternal: vi.fn(),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    });

    // cancelDxsoJob returns 400
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('Bad Request'),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('Bad Request').buffer),
    });

    const result = await deleteDocumentEvent({ documentId: 'doc-1' }, ctx);

    expect(result.success).toBe(true);
  });

  it('propagates non-400/404 API errors', async () => {
    const mapping = {
      system: 'datev',
      entity: 'dxso-job',
      localId: 'doc-1',
      externalId: 'job-500',
      metadata: { clientId: '455148-1' },
    };

    const ctx = createMockContext({ cancelOnDeleteEvent: true }, {
      mappings: {
        get: vi.fn().mockResolvedValue(mapping),
        findByExternal: vi.fn(),
        upsert: vi.fn(),
      },
    });

    // cancelDxsoJob returns 500
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('Server Error'),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('Server Error').buffer),
    });

    const result = await deleteDocumentEvent({ documentId: 'doc-1' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('uses defaultClientId when mapping has no clientId', async () => {
    const mapping = {
      system: 'datev',
      entity: 'dxso-job',
      localId: 'doc-1',
      externalId: 'job-no-client',
      metadata: {},
    };

    const ctx = createMockContext({ cancelOnDeleteEvent: true, defaultClientId: 'default-client' }, {
      mappings: {
        get: vi.fn().mockResolvedValue(mapping),
        findByExternal: vi.fn(),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    });

    mockFetch.mockResolvedValueOnce(jsonFetchResponse({}));

    const result = await deleteDocumentEvent({ documentId: 'doc-1' }, ctx);

    expect(result.success).toBe(true);
  });
});
