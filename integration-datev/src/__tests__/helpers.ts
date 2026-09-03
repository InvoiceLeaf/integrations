import { vi } from 'vitest';
import type {
  IntegrationContext,
  CredentialsClient,
  DataClient,
  MappingsClient,
  StateClient,
  Logger,
  EmailClient,
  PaymentsClient,
  Document,
  DocumentFileContent,
  ListResult,
} from '@invoiceleaf/integration-sdk';
import type { DatevIntegrationConfig } from '../types.js';

export function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

export function createMockCredentials(overrides: Partial<CredentialsClient> = {}): CredentialsClient {
  return {
    getAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
    getApiKey: vi.fn().mockResolvedValue('mock-api-key'),
    refreshToken: vi.fn().mockResolvedValue('mock-refreshed-token'),
    getConnectionInfo: vi.fn().mockResolvedValue({
      connected: true,
      provider: 'datev-openid-sandbox',
      accountId: 'mock-account-id',
    }),
    ...overrides,
  };
}

export function createMockData(overrides: Partial<DataClient> = {}): DataClient {
  return {
    listDocuments: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 50, hasMore: false }),
    getDocument: vi.fn().mockResolvedValue(createMockDocument()),
    getDocumentFile: vi.fn().mockResolvedValue(createMockDocumentFile()),
    listCompanies: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 50, hasMore: false }),
    getCompany: vi.fn(),
    listCategories: vi.fn().mockResolvedValue([]),
    getCategory: vi.fn(),
    getTag: vi.fn(),
    listTags: vi.fn().mockResolvedValue([]),
    createExport: vi.fn(),
    getExport: vi.fn(),
    importDocument: vi.fn(),
    createStructuredDocument: vi.fn().mockResolvedValue({ documentId: 'structured-doc-1', duplicate: false }),
    createCompany: vi.fn().mockResolvedValue({ companyId: 'company-1', name: 'Test Company' }),
    patchDocumentIntegrationMeta: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

export function createMockMappings(overrides: Partial<MappingsClient> = {}): MappingsClient {
  return {
    get: vi.fn().mockResolvedValue(null),
    findByExternal: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

export function createMockState(overrides: Partial<StateClient> = {}): StateClient {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

export function createMockPayments(overrides: Partial<PaymentsClient> = {}): PaymentsClient {
  return {
    list: vi.fn().mockResolvedValue({ items: [], page: 1, limit: 20, hasMore: false }),
    create: vi.fn().mockResolvedValue({ paymentId: 'payment-1', duplicate: false, status: 'MATCHED' }),
    ...overrides,
  };
}

export function createMockEmail(): EmailClient {
  return {
    sendSmtpEmail: vi.fn(),
    testSmtpImapConnection: vi.fn(),
    crawlImapPdfAttachments: vi.fn(),
  };
}

export function createMockContext(
  configOverrides: Partial<DatevIntegrationConfig> = {},
  contextOverrides: Partial<IntegrationContext<DatevIntegrationConfig>> = {}
): IntegrationContext<DatevIntegrationConfig> {
  return {
    spaceId: 'space-1',
    userId: 'user-1',
    installationId: 'install-1',
    config: {
      environment: 'sandbox',
      xDatevClientId: 'test-x-client-id',
      defaultClientId: '455148-1',
      defaultImportType: 'accountsReceivableLedgerImport',
      defaultAccountingMonth: '2026-01',
      ...configOverrides,
    },
    data: createMockData(),
    credentials: createMockCredentials(),
    mappings: createMockMappings(),
    payments: createMockPayments(),
    state: createMockState(),
    email: createMockEmail(),
    logger: createMockLogger(),
    ...contextOverrides,
  };
}

export function createMockDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    invoiceId: 'INV-001',
    invoiceDate: '2026-01-15',
    totalAmount: 1190,
    netAmount: 1000,
    documentStatus: 'ISSUED',
    accountingType: 'RECEIVABLE',
    processed: true,
    fileName: 'invoice-001.pdf',
    ...overrides,
  };
}

export function createMockDocumentFile(overrides: Partial<DocumentFileContent> = {}): DocumentFileContent {
  return {
    documentId: 'doc-1',
    fileName: 'invoice-001.pdf',
    contentType: 'application/pdf',
    contentBase64: Buffer.from('fake-pdf-content').toString('base64'),
    sizeBytes: 100,
    ...overrides,
  };
}

export function createMockDocumentList(
  items: Document[],
  hasMore = false
): ListResult<Document> {
  return {
    items,
    total: items.length,
    page: 1,
    limit: 50,
    hasMore,
  };
}
