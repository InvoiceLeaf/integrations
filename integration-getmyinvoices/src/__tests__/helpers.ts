import { vi } from 'vitest';
import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import type { GetMyInvoicesIntegrationConfig } from '../types.js';

/**
 * Creates a fully-mocked IntegrationContext for testing GetMyInvoices handlers.
 * All client methods are vi.fn() stubs that resolve to sensible defaults.
 */
export function createMockContext(
  configOverrides: Partial<GetMyInvoicesIntegrationConfig> = {}
): IntegrationContext<GetMyInvoicesIntegrationConfig> {
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
      patchDocumentIntegrationMeta: vi.fn().mockResolvedValue(undefined),
    },

    credentials: {
      getAccessToken: vi.fn().mockResolvedValue('oauth-token'),
      getApiKey: vi.fn().mockResolvedValue('test-api-key-123'),
      refreshToken: vi.fn().mockResolvedValue('refreshed-token'),
      getConnectionInfo: vi.fn().mockResolvedValue({ connected: true, provider: 'getmyinvoices' }),
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

/**
 * Creates a minimal InvoiceLeaf Document for testing.
 */
export function createMockDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    invoiceId: 'INV-001',
    invoiceDate: '2025-01-15',
    dueDate: '2025-02-15',
    netAmount: 100,
    taxAmount: 19,
    totalAmount: 119,
    currency: { code: 'EUR', symbol: '\u20ac' },
    accountingType: 'PAYABLE' as const,
    documentStatus: 'ISSUED' as const,
    processed: true,
    supplier: {
      id: 'company-1',
      name: 'Supplier GmbH',
      lastUpdate: 0,
      created: 0,
      country: 'Germany',
      street: 'Main St 1',
      zip: '10115',
      city: 'Berlin',
      email: 'info@supplier.de',
      taxId: 'DE123456789',
      vatId: 'DE987654321',
    },
    receiver: {
      id: 'company-2',
      name: 'Receiver AG',
      lastUpdate: 0,
      created: 0,
    },
    tags: [{ id: 'tag-1', spaceId: 'space-1', name: 'urgent', createdAt: '', updatedAt: '' }],
    lineItems: [
      {
        id: 'li-1',
        name: 'Consulting',
        quantity: 2,
        unitAmount: 50,
        netAmount: 100,
        taxAmount: 19,
        totalAmount: 119,
      },
    ],
    taxItems: [
      {
        id: 'tax-1',
        name: 'VAT 19%',
        taxPercentage: 19,
        netAmount: 100,
        taxAmount: 19,
      },
    ],
    ...overrides,
  };
}

/**
 * Stub global fetch with a mock function.
 */
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
