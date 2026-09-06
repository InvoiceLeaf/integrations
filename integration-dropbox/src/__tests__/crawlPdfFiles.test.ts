import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import type { DropboxIntegrationConfig, DropboxPdfFile } from '../types.js';
import { buildFileStateKey } from '../utils/dedupe.js';

const client = vi.hoisted(() => ({
  listPdfFiles: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock('../dropbox/client.js', () => ({
  DropboxApiError: class DropboxApiError extends Error {},
  // The handler does `new DropboxClient(token)`, so the mock must be constructible.
  DropboxClient: class {
    constructor() {
      return client;
    }
  },
}));

import { crawlPdfFiles } from '../handlers/crawlPdfFiles.js';

const pdf: DropboxPdfFile = {
  id: 'id:abc123',
  name: 'invoice.pdf',
  pathDisplay: '/Invoices/invoice.pdf',
  pathLower: '/invoices/invoice.pdf',
  rev: 'rev-1',
  contentHash: 'hash-1',
};

function createContext(config: Partial<DropboxIntegrationConfig> = {}) {
  const state = new Map<string, string>();
  const ctx = {
    spaceId: 'space-1',
    userId: 'user-1',
    installationId: 'install-1',
    config,
    credentials: { getAccessToken: vi.fn().mockResolvedValue('dropbox-token') },
    state: {
      get: vi.fn(async (key: string) => state.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        state.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        state.delete(key);
      }),
    },
    mappings: {
      findByExternal: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    data: {
      importDocument: vi.fn().mockResolvedValue({ documentId: 'doc-1', duplicate: false }),
      patchDocumentIntegrationMeta: vi.fn().mockResolvedValue(undefined),
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { ctx: ctx as unknown as IntegrationContext<DropboxIntegrationConfig>, raw: ctx, state };
}

describe('crawlPdfFiles', () => {
  beforeEach(() => {
    client.listPdfFiles.mockReset();
    client.downloadFile.mockReset();
    client.listPdfFiles.mockResolvedValue([pdf]);
    client.downloadFile.mockResolvedValue({ metadata: {}, contentBase64: 'JVBERi0xLjQK' });
  });

  it('imports a new PDF with the fields the SDK accepts', async () => {
    const { ctx, raw } = createContext();

    const result = await crawlPdfFiles({}, ctx);

    expect(result).toMatchObject({ success: true, scannedFiles: 1, imported: 1, duplicates: 0, failed: 0 });
    expect(raw.data.importDocument).toHaveBeenCalledTimes(1);
    const input = raw.data.importDocument.mock.calls[0][0];
    expect(input).toMatchObject({
      fileName: 'invoice.pdf',
      contentType: 'application/pdf',
      contentBase64: 'JVBERi0xLjQK',
      source: 'dropbox',
      externalRef: 'dropbox:file:id:abc123:rev-1',
    });
    expect(input).not.toHaveProperty('metadata');
    expect(raw.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'dropbox', entity: 'file', localId: 'doc-1', externalId: 'id:abc123' })
    );
    expect(raw.state.set).toHaveBeenLastCalledWith(buildFileStateKey('dropbox', pdf), 'doc-1', expect.anything());
  });

  it('treats a file already recorded in state as a duplicate without downloading it', async () => {
    const { ctx, raw, state } = createContext();
    state.set(buildFileStateKey('dropbox', pdf), 'doc-existing');

    const result = await crawlPdfFiles({}, ctx);

    expect(result).toMatchObject({ success: true, imported: 0, duplicates: 1 });
    expect(client.downloadFile).not.toHaveBeenCalled();
    expect(raw.data.importDocument).not.toHaveBeenCalled();
  });

  it('counts a duplicate reported by the import without creating a mapping', async () => {
    const { ctx, raw } = createContext();
    raw.data.importDocument.mockResolvedValue({ documentId: 'doc-existing', duplicate: true });

    const result = await crawlPdfFiles({}, ctx);

    expect(result).toMatchObject({ success: true, imported: 0, duplicates: 1 });
    expect(raw.mappings.upsert).not.toHaveBeenCalled();
  });

  it('reports a failed run when Dropbox cannot be listed', async () => {
    const { ctx } = createContext();
    client.listPdfFiles.mockRejectedValue(new Error('network down'));

    const result = await crawlPdfFiles({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('network down');
  });
});
