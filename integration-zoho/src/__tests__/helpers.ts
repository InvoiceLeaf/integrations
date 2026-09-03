import { vi } from 'vitest';
import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import type { ZohoIntegrationConfig } from '../types.js';

export function createMockContext(
  configOverrides: Partial<ZohoIntegrationConfig> = {}
): IntegrationContext<ZohoIntegrationConfig> {
  return {
    spaceId: 'space-1',
    userId: 'user-1',
    installationId: 'install-1',
    config: configOverrides,

    data: {
      listDocuments: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 50, hasMore: false }),
      getDocument: vi.fn().mockResolvedValue({ id: 'doc-1' }),
      getDocumentFile: vi.fn().mockResolvedValue({
        documentId: 'doc-1',
        fileName: 'invoice.pdf',
        contentType: 'application/pdf',
        contentBase64: 'dGVzdA==',
      }),
      listCompanies: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 50, hasMore: false }),
      getCompany: vi.fn().mockResolvedValue({ id: 'company-1', name: 'Test Company', lastUpdate: 0, created: 0 }),
      listCategories: vi.fn().mockResolvedValue([]),
      getCategory: vi.fn().mockResolvedValue({ id: 'cat-1', spaceId: 'space-1', name: 'Test', createdAt: '', updatedAt: '' }),
      getTag: vi.fn().mockResolvedValue({ id: 'tag-1', spaceId: 'space-1', name: 'Tag', createdAt: '', updatedAt: '' }),
      listTags: vi.fn().mockResolvedValue([]),
      createExport: vi.fn().mockResolvedValue({ id: 'export-1', spaceId: 'space-1', format: 'csv', status: 'COMPLETED', createdAt: '' }),
      getExport: vi.fn().mockResolvedValue({ id: 'export-1', spaceId: 'space-1', format: 'csv', status: 'COMPLETED', createdAt: '' }),
      importDocument: vi.fn().mockResolvedValue({ documentId: 'imported-doc-1', duplicate: false }),
      createStructuredDocument: vi.fn().mockResolvedValue({ documentId: 'structured-doc-1', duplicate: false }),
      createCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', name: 'Test Company' }),
      patchDocumentIntegrationMeta: vi.fn().mockResolvedValue(undefined),
    },

    payments: {
      list: vi.fn().mockResolvedValue({ items: [], page: 1, limit: 20, hasMore: false }),
      create: vi.fn().mockResolvedValue({ paymentId: 'payment-1', duplicate: false, status: 'MATCHED' }),
    },

    credentials: {
      getAccessToken: vi.fn().mockResolvedValue('oauth-token'),
      getApiKey: vi.fn().mockResolvedValue('test-api-key'),
      refreshToken: vi.fn().mockResolvedValue('refreshed-token'),
      getConnectionInfo: vi.fn().mockResolvedValue({ connected: true, provider: 'zoho-books' }),
    },

    mappings: {
      get: vi.fn().mockResolvedValue(null),
      findByExternal: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    },

    state: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },

    email: {
      sendSmtpEmail: vi.fn().mockResolvedValue({ messageId: 'msg-1' }),
      testSmtpImapConnection: vi.fn().mockResolvedValue({ smtp: true, imap: true }),
      crawlImapPdfAttachments: vi.fn().mockResolvedValue({ messages: 0, attachments: 0, items: [] }),
    },

    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

export const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

export function fakeResponse(body: string, status = 200, headers: Record<string, string> = {}): object {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(headers),
    text: vi.fn().mockResolvedValue(body),
    arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(body).buffer),
  };
}

export function jsonResponse(body: unknown, status = 200): object {
  return fakeResponse(JSON.stringify(body), status, { 'Content-Type': 'application/json' });
}

export function errorResponse(status: number, body = ''): object {
  return fakeResponse(body, status);
}
