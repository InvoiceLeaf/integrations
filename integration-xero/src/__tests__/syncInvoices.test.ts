import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntegrationContext, Document, ListResult } from '@invoiceleaf/integration-sdk';
import type { SyncInvoicesResult, XeroIntegrationConfig, XeroSyncState } from '../types.js';
import { syncInvoices } from '../handlers/syncInvoices.js';

// Stub global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): object {
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

function errorResponse(status: number, body = ''): object {
  return {
    ok: false,
    status,
    statusText: 'Error',
    headers: new Headers(),
    text: vi.fn().mockResolvedValue(body),
    arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(body).buffer),
  };
}

// ---------------------------------------------------------------------------
// Document factory
// ---------------------------------------------------------------------------
function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    invoiceId: 'INV-001',
    invoiceDate: '2026-01-15',
    created: Date.parse('2026-01-15T00:00:00Z'),
    netAmount: 100,
    totalAmount: 119,
    accountingType: 'PAYABLE',
    documentStatus: 'ISSUED',
    processed: true,
    supplier: {
      id: 'company-1',
      name: 'Supplier Co',
      lastUpdate: Date.now(),
      created: Date.now(),
    },
    receiver: {
      id: 'company-2',
      name: 'Receiver Co',
      lastUpdate: Date.now(),
      created: Date.now(),
    },
    lineItems: [
      {
        name: 'Service Line',
        quantity: 2,
        unitAmount: 50,
        netAmount: 100,
        taxAmount: 19,
        totalAmount: 119,
      },
    ],
    currency: { code: 'EUR' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------
function createMockContext(
  configOverrides: Partial<XeroIntegrationConfig> = {},
  options: {
    connected?: boolean;
    accountId?: string;
    syncState?: XeroSyncState | null;
    stateGetError?: boolean;
    mappingGet?: { externalId: string } | null;
  } = {}
): IntegrationContext<XeroIntegrationConfig> {
  const connected = options.connected ?? true;
  const stateGetFn = vi.fn<(key: string) => Promise<XeroSyncState | null>>();
  if (options.stateGetError) {
    stateGetFn.mockRejectedValue(new Error('state read error'));
  } else {
    stateGetFn.mockResolvedValue(options.syncState ?? null);
  }

  return {
    spaceId: 'space-1',
    userId: 'user-1',
    installationId: 'install-1',
    config: configOverrides,
    data: {
      listDocuments: vi.fn<() => Promise<ListResult<Document>>>().mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        limit: 50,
        hasMore: false,
      }),
      getDocument: vi.fn(),
      getDocumentFile: vi.fn(),
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
    credentials: {
      getAccessToken: vi.fn().mockResolvedValue('test-access-token'),
      getApiKey: vi.fn(),
      refreshToken: vi.fn(),
      getConnectionInfo: vi.fn().mockResolvedValue({
        connected,
        provider: 'xero',
        accountId: options.accountId ?? 'tenant-1',
      }),
    },
    mappings: {
      get: vi.fn().mockResolvedValue(options.mappingGet ?? null),
      findByExternal: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    state: {
      get: stateGetFn,
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
    },
    email: {
      sendSmtpEmail: vi.fn(),
      testSmtpImapConnection: vi.fn(),
      crawlImapPdfAttachments: vi.fn(),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

/** Set up mock fetch to handle listXeroConnections + any accounting API calls. */
function stubXeroConnections(tenantId = 'tenant-1', tenantName = 'Test Tenant'): void {
  mockFetch.mockResolvedValueOnce(
    jsonResponse([{ id: 'c1', tenantId, tenantName }])
  );
}

function stubXeroContactLookup(contactId: string | null): void {
  if (contactId) {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ Contacts: [{ ContactID: contactId, Name: 'Found Contact' }] })
    );
  } else {
    mockFetch.mockResolvedValueOnce(jsonResponse({ Contacts: [] }));
  }
}

function stubXeroContactCreate(contactId: string): void {
  mockFetch.mockResolvedValueOnce(
    jsonResponse({ Contacts: [{ ContactID: contactId, Name: 'New Contact' }] })
  );
}

function stubXeroInvoiceLookup(invoiceId: string | null): void {
  if (invoiceId) {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ Invoices: [{ InvoiceID: invoiceId, InvoiceNumber: 'INV-001' }] })
    );
  } else {
    mockFetch.mockResolvedValueOnce(jsonResponse({ Invoices: [] }));
  }
}

function stubXeroInvoiceUpsert(invoiceId: string, invoiceNumber?: string, status = 'DRAFT'): void {
  mockFetch.mockResolvedValueOnce(
    jsonResponse({
      Invoices: [{ InvoiceID: invoiceId, InvoiceNumber: invoiceNumber, Status: status }],
    })
  );
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('syncInvoices handler', () => {
  // -- Not connected ------------------------------------------------------
  it('returns failure when Xero is not connected', async () => {
    const ctx = createMockContext({}, { connected: false });

    const result = await syncInvoices({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not connected');
    expect(result.tenantId).toBe('');
    expect(result.checkpointUpdated).toBe(false);
  });

  // -- No documents to sync -----------------------------------------------
  it('returns success with zero counts when no documents exist', async () => {
    const ctx = createMockContext();
    stubXeroConnections();

    const result = await syncInvoices({}, ctx);

    expect(result.success).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.synced).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.tenantId).toBe('tenant-1');
    expect(result.tenantName).toBe('Test Tenant');
    expect(result.checkpointUpdated).toBe(true);
  });

  // -- Single document sync ------------------------------------------------
  it('syncs a single document successfully', async () => {
    const doc = makeDocument();
    const ctx = createMockContext();
    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    // findContactByName (contact found)
    stubXeroContactLookup('xero-contact-1');
    // findInvoiceByNumber (not found, new invoice)
    stubXeroInvoiceLookup(null);
    // upsertInvoice
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001', 'DRAFT');

    const result = await syncInvoices({}, ctx);

    expect(result.success).toBe(true);
    expect(result.processed).toBe(1);
    expect(result.synced).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.checkpointUpdated).toBe(true);

    // Verify mapping was persisted
    expect(ctx.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'xero',
        entity: 'invoice',
        localId: 'doc-1',
        externalId: 'xero-inv-1',
      })
    );

    // Verify integration meta was patched
    expect(ctx.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        system: 'xero',
        externalId: 'xero-inv-1',
        status: 'synced',
      })
    );
  });

  // -- Skips non-syncable documents ----------------------------------------
  it('skips deleted documents', async () => {
    const doc = makeDocument({ deleted: true });
    const ctx = createMockContext();
    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();

    const result = await syncInvoices({}, ctx);

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.synced).toBe(0);
  });

  it('skips documents with CANCELLED status', async () => {
    const doc = makeDocument({ documentStatus: 'CANCELLED' });
    const ctx = createMockContext();
    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();

    const result = await syncInvoices({}, ctx);

    expect(result.skipped).toBe(1);
    expect(result.synced).toBe(0);
  });

  it('skips DRAFT documents by default', async () => {
    const doc = makeDocument({ documentStatus: 'DRAFT' });
    const ctx = createMockContext();
    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();

    const result = await syncInvoices({}, ctx);

    expect(result.skipped).toBe(1);
  });

  it('includes DRAFT documents when config flag is set', async () => {
    const doc = makeDocument({ documentStatus: 'DRAFT' });
    const ctx = createMockContext({ includeDraftDocuments: true });
    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001');

    const result = await syncInvoices({}, ctx);

    expect(result.synced).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('skips documents that are duplicates', async () => {
    const doc = makeDocument({ duplicateOfId: 'original-doc-id' });
    const ctx = createMockContext();
    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();

    const result = await syncInvoices({}, ctx);

    expect(result.skipped).toBe(1);
  });

  it('skips unprocessed documents when requireProcessedDocuments is true', async () => {
    const doc = makeDocument({ processed: false });
    const ctx = createMockContext({ requireProcessedDocuments: true });
    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();

    const result = await syncInvoices({}, ctx);

    expect(result.skipped).toBe(1);
  });

  // -- Contact resolution --------------------------------------------------
  it('creates a new contact when no existing contact is found', async () => {
    const doc = makeDocument();
    const ctx = createMockContext();
    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    // findContactByName returns empty
    stubXeroContactLookup(null);
    // createContact returns new contact
    stubXeroContactCreate('xero-new-contact');
    // findInvoiceByNumber
    stubXeroInvoiceLookup(null);
    // upsertInvoice
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001');

    const result = await syncInvoices({}, ctx);

    expect(result.synced).toBe(1);
    // Contact mapping should be persisted
    expect(ctx.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'xero',
        entity: 'contact',
        localId: 'company-1',
        externalId: 'xero-new-contact',
      })
    );
  });

  it('reuses mapped contact when mapping exists', async () => {
    const doc = makeDocument();
    const ctx = createMockContext({}, { mappingGet: { externalId: 'mapped-contact-id' } });
    (ctx.mappings.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { entity: string }) => {
        if (input.entity === 'contact') {
          return { system: 'xero', entity: 'contact', localId: 'company-1', externalId: 'mapped-contact-id' };
        }
        return null;
      }
    );
    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    // No findContactByName call expected since mapping exists
    // findInvoiceByNumber
    stubXeroInvoiceLookup(null);
    // upsertInvoice
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001');

    const result = await syncInvoices({}, ctx);

    expect(result.synced).toBe(1);
  });

  // -- Invoice update (existing) -------------------------------------------
  it('updates existing invoice when mapping exists', async () => {
    const doc = makeDocument();
    const ctx = createMockContext();
    (ctx.mappings.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { entity: string }) => {
        if (input.entity === 'invoice') {
          return { system: 'xero', entity: 'invoice', localId: 'doc-1', externalId: 'existing-inv-id' };
        }
        return null;
      }
    );
    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    // findContactByName
    stubXeroContactLookup('xero-contact-1');
    // upsertInvoice (no findInvoiceByNumber since mapping exists)
    stubXeroInvoiceUpsert('existing-inv-id', 'INV-001', 'DRAFT');

    const result = await syncInvoices({}, ctx);

    expect(result.synced).toBe(1);
  });

  // -- Invoice found by number when no mapping exists ----------------------
  it('finds existing invoice by number when no mapping exists', async () => {
    const doc = makeDocument();
    const ctx = createMockContext();
    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    stubXeroContactLookup('xero-contact-1');
    // findInvoiceByNumber returns existing invoice
    stubXeroInvoiceLookup('found-by-number-id');
    // upsertInvoice
    stubXeroInvoiceUpsert('found-by-number-id', 'INV-001');

    const result = await syncInvoices({}, ctx);

    expect(result.synced).toBe(1);
  });

  // -- Checkpoint behavior -------------------------------------------------
  describe('checkpoint behavior', () => {
    it('reads checkpoint from state and uses it as fromDate', async () => {
      const checkpoint = '2026-03-20T10:00:00.000Z';
      const ctx = createMockContext({}, {
        syncState: { lastSuccessfulSyncAt: checkpoint },
      });

      stubXeroConnections();

      const result = await syncInvoices({}, ctx);

      expect(ctx.state.get).toHaveBeenCalledWith('xero:lastSuccessfulSyncAt');
      expect(result.fromDate).toBe(checkpoint);
    });

    it('uses fallback lookback when checkpoint is missing', async () => {
      const ctx = createMockContext({}, { syncState: null });

      stubXeroConnections();

      const result = await syncInvoices({}, ctx);

      // fromDate should be approximately 24 hours ago (default lookback)
      const fromDate = new Date(result.fromDate);
      const now = new Date();
      const diffHours = (now.getTime() - fromDate.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(23);
      expect(diffHours).toBeLessThan(25);
    });

    it('uses fallback lookback when checkpoint value is corrupted', async () => {
      const ctx = createMockContext({}, {
        syncState: { lastSuccessfulSyncAt: 'not-a-valid-date' },
      });

      stubXeroConnections();

      const result = await syncInvoices({}, ctx);

      // Should have warned about corrupted value
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Corrupted sync checkpoint'),
        expect.any(Object)
      );

      const fromDate = new Date(result.fromDate);
      const now = new Date();
      const diffHours = (now.getTime() - fromDate.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(23);
      expect(diffHours).toBeLessThan(25);
    });

    it('uses fallback when state.get throws', async () => {
      const ctx = createMockContext({}, { stateGetError: true });

      stubXeroConnections();

      const result = await syncInvoices({}, ctx);

      expect(ctx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not read Xero sync checkpoint'),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });

    it('respects custom lookback hours', async () => {
      const ctx = createMockContext({ initialSyncLookbackHours: 48 });

      stubXeroConnections();

      const result = await syncInvoices({}, ctx);

      const fromDate = new Date(result.fromDate);
      const now = new Date();
      const diffHours = (now.getTime() - fromDate.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(47);
      expect(diffHours).toBeLessThan(49);
    });

    it('updates checkpoint on success (no failures)', async () => {
      const ctx = createMockContext();
      stubXeroConnections();

      const result = await syncInvoices({}, ctx);

      expect(result.checkpointUpdated).toBe(true);
      expect(ctx.state.set).toHaveBeenCalledWith(
        'xero:lastSuccessfulSyncAt',
        expect.objectContaining({ lastSuccessfulSyncAt: expect.any(String) })
      );
    });

    it('does NOT update checkpoint when there are failures', async () => {
      const doc = makeDocument();
      const ctx = createMockContext();
      (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          items: [doc],
          total: 1,
          page: 1,
          limit: 50,
          hasMore: false,
        });

      stubXeroConnections();
      stubXeroContactLookup('xero-contact-1');
      stubXeroInvoiceLookup(null);
      // upsertInvoice fails
      mockFetch.mockResolvedValueOnce(errorResponse(400, 'Validation Error'));

      const result = await syncInvoices({}, ctx);

      expect(result.failed).toBe(1);
      expect(result.checkpointUpdated).toBe(false);
      expect(ctx.state.set).not.toHaveBeenCalled();
    });

    it('handles checkpoint write failure gracefully', async () => {
      const ctx = createMockContext();
      (ctx.state.set as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('write failed'));

      stubXeroConnections();

      const result = await syncInvoices({}, ctx);

      expect(result.checkpointUpdated).toBe(false);
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not persist Xero sync checkpoint'),
        expect.any(Object)
      );
    });
  });

  // -- Pagination ----------------------------------------------------------
  it('paginates through multiple pages', async () => {
    const doc1 = makeDocument({ id: 'doc-1' });
    const doc2 = makeDocument({ id: 'doc-2' });
    const ctx = createMockContext();

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc1],
        total: 2,
        page: 1,
        limit: 1,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [doc2],
        total: 2,
        page: 2,
        limit: 1,
        hasMore: false,
      });

    stubXeroConnections();

    // doc1 flow
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001');

    // doc2 flow
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-2', 'INV-001');

    const result = await syncInvoices({}, ctx);

    expect(result.processed).toBe(2);
    expect(result.synced).toBe(2);
    expect(ctx.data.listDocuments).toHaveBeenCalledTimes(2);
  });

  // -- Max documents per run -----------------------------------------------
  it('respects maxDocumentsPerRun limit', async () => {
    const doc1 = makeDocument({ id: 'doc-1' });
    const doc2 = makeDocument({ id: 'doc-2' });
    const ctx = createMockContext({ maxDocumentsPerRun: 1 });

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc1, doc2],
        total: 2,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001');

    const result = await syncInvoices({}, ctx);

    expect(result.processed).toBe(1);
    expect(result.synced).toBe(1);
  });

  // -- Failure handling ----------------------------------------------------
  it('records failures and continues processing remaining documents', async () => {
    const doc1 = makeDocument({ id: 'doc-fail' });
    const doc2 = makeDocument({ id: 'doc-ok' });
    const ctx = createMockContext();

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc1, doc2],
        total: 2,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();

    // doc1: contact found, but invoice upsert fails
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    mockFetch.mockResolvedValueOnce(errorResponse(400, 'Validation failed'));

    // doc2: succeeds
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-2', 'INV-001');

    const result = await syncInvoices({}, ctx);

    expect(result.processed).toBe(2);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.success).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].documentId).toBe('doc-fail');

    // Check that error meta was patched for the failed document
    expect(ctx.data.patchDocumentIntegrationMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-fail',
        system: 'xero',
        status: 'failed',
      })
    );
  });

  it('limits reported failures to MAX_REPORTED_FAILURES', async () => {
    // Create 30 documents that will all fail
    const docs = Array.from({ length: 30 }, (_, i) =>
      makeDocument({ id: `doc-${i}` })
    );
    const ctx = createMockContext({ maxDocumentsPerRun: 30 });

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: docs,
        total: 30,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();

    // All 30 documents fail at contact lookup
    for (let i = 0; i < 30; i++) {
      stubXeroContactLookup(null);
      // createContact fails
      mockFetch.mockResolvedValueOnce(errorResponse(500, 'Server error'));
    }

    const result = await syncInvoices({}, ctx);

    expect(result.failed).toBe(30);
    // Only 25 failures should be reported (MAX_REPORTED_FAILURES)
    expect(result.failures.length).toBeLessThanOrEqual(25);
  });

  // -- RECEIVABLE vs PAYABLE -----------------------------------------------
  it('maps RECEIVABLE documents to ACCREC invoice type', async () => {
    const doc = makeDocument({ accountingType: 'RECEIVABLE' });
    const ctx = createMockContext();

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001');

    await syncInvoices({}, ctx);

    // The upsertInvoice call should contain ACCREC type
    const upsertCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const body = JSON.parse((upsertCall[1] as RequestInit).body as string);
    expect(body.Invoices[0].Type).toBe('ACCREC');
  });

  it('maps PAYABLE documents to ACCPAY invoice type', async () => {
    const doc = makeDocument({ accountingType: 'PAYABLE' });
    const ctx = createMockContext();

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001');

    await syncInvoices({}, ctx);

    const upsertCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const body = JSON.parse((upsertCall[1] as RequestInit).body as string);
    expect(body.Invoices[0].Type).toBe('ACCPAY');
  });

  // -- Invoice number prefix -----------------------------------------------
  it('applies invoice number prefix from config', async () => {
    const doc = makeDocument({ invoiceId: '12345' });
    const ctx = createMockContext({ invoiceNumberPrefix: 'IL-' });

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-1', 'IL-12345');

    await syncInvoices({}, ctx);

    const upsertCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const body = JSON.parse((upsertCall[1] as RequestInit).body as string);
    expect(body.Invoices[0].InvoiceNumber).toBe('IL-12345');
  });

  // -- Document without line items (fallback to document amounts) ----------
  it('creates fallback line item from document amounts when no line items', async () => {
    const doc = makeDocument({
      lineItems: [],
      netAmount: 250,
    });
    const ctx = createMockContext();

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001');

    await syncInvoices({}, ctx);

    const upsertCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const body = JSON.parse((upsertCall[1] as RequestInit).body as string);
    expect(body.Invoices[0].LineItems).toHaveLength(1);
    expect(body.Invoices[0].LineItems[0].Quantity).toBe(1);
    expect(body.Invoices[0].LineItems[0].UnitAmount).toBe(250);
  });

  // -- Currency code -------------------------------------------------------
  it('includes currency code in invoice payload', async () => {
    const doc = makeDocument({ currency: { code: 'USD' } });
    const ctx = createMockContext();

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001');

    await syncInvoices({}, ctx);

    const upsertCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const body = JSON.parse((upsertCall[1] as RequestInit).body as string);
    expect(body.Invoices[0].CurrencyCode).toBe('USD');
  });

  // -- Target status -------------------------------------------------------
  it('uses configured target status', async () => {
    const doc = makeDocument();
    const ctx = createMockContext({ targetStatus: 'AUTHORISED' });

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001', 'AUTHORISED');

    await syncInvoices({}, ctx);

    const upsertCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const body = JSON.parse((upsertCall[1] as RequestInit).body as string);
    expect(body.Invoices[0].Status).toBe('AUTHORISED');
  });

  // -- Top-level error handling --------------------------------------------
  it('catches top-level errors and returns failure result', async () => {
    const ctx = createMockContext();
    (ctx.credentials.getConnectionInfo as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('credential service down')
    );

    const result = await syncInvoices({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('credential service down');
    expect(result.tenantId).toBe('');
    expect(result.checkpointUpdated).toBe(false);
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  // -- Account code config -------------------------------------------------
  it('passes expense account code for PAYABLE documents', async () => {
    const doc = makeDocument({ accountingType: 'PAYABLE' });
    const ctx = createMockContext({ defaultExpenseAccountCode: '400' });

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001');

    await syncInvoices({}, ctx);

    const upsertCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const body = JSON.parse((upsertCall[1] as RequestInit).body as string);
    expect(body.Invoices[0].LineItems[0].AccountCode).toBe('400');
  });

  it('passes revenue account code for RECEIVABLE documents', async () => {
    const doc = makeDocument({ accountingType: 'RECEIVABLE' });
    const ctx = createMockContext({ defaultRevenueAccountCode: '200' });

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001');

    await syncInvoices({}, ctx);

    const upsertCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const body = JSON.parse((upsertCall[1] as RequestInit).body as string);
    expect(body.Invoices[0].LineItems[0].AccountCode).toBe('200');
  });

  // -- Fallback contact name -----------------------------------------------
  it('uses fallbackContactName when document has no company', async () => {
    const doc = makeDocument({
      supplier: undefined,
      receiver: undefined,
    });
    const ctx = createMockContext({ fallbackContactName: 'Default Customer' });

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    // findContactByName should look up "Default Customer"
    stubXeroContactLookup('xero-fallback-contact');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001');

    const result = await syncInvoices({}, ctx);
    expect(result.synced).toBe(1);
  });

  // -- Due date included in payload ----------------------------------------
  it('includes dueDate in invoice payload when present', async () => {
    const doc = makeDocument({ dueDate: '2026-02-28' });
    const ctx = createMockContext();

    (ctx.data.listDocuments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [doc],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      });

    stubXeroConnections();
    stubXeroContactLookup('xero-contact-1');
    stubXeroInvoiceLookup(null);
    stubXeroInvoiceUpsert('xero-inv-1', 'INV-001');

    await syncInvoices({}, ctx);

    const upsertCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const body = JSON.parse((upsertCall[1] as RequestInit).body as string);
    expect(body.Invoices[0].DueDate).toBe('2026-02-28');
  });
});
