import { describe, it, expect } from 'vitest';
import type {
  GetMyInvoicesDocumentType,
  GetMyInvoicesPaymentStatus,
  GetMyInvoicesPaymentMethod,
  GetMyInvoicesIntegrationConfig,
  HandlerResult,
  TestConnectionResult,
  SyncFailure,
  SyncInvoicesResult,
  InboundSyncResult,
  GetMyInvoicesSyncState,
  GetMyInvoicesInboundSyncState,
} from '../types.js';

/**
 * Compile-time type tests. These verify that the type definitions are
 * structurally valid and that key type relationships hold. The runtime
 * assertions use `satisfies` patterns compiled away by TypeScript —
 * the expect() calls confirm the runtime values are as expected.
 */

describe('types', () => {
  // -------------------------------------------------------------------------
  // GetMyInvoicesDocumentType
  // -------------------------------------------------------------------------
  it('GetMyInvoicesDocumentType accepts valid values', () => {
    const validTypes: GetMyInvoicesDocumentType[] = [
      'INCOMING_INVOICE',
      'RECEIPT',
      'PAYMENT_RECEIPT',
      'EXPENSE_REIMBURSEMENT',
      'SALES_INVOICE',
      'CREDIT_NOTE',
      'STATEMENT',
      'DELIVERY_NOTE',
      'ORDER_CONFIRMATION',
      'PAYROLL',
      'COMPANY_REGISTRATION_DOCUMENT',
      'MISC',
      'TRAVEL_EXPENSES',
      'REMINDER',
    ];
    expect(validTypes).toHaveLength(14);
  });

  // -------------------------------------------------------------------------
  // GetMyInvoicesPaymentStatus
  // -------------------------------------------------------------------------
  it('GetMyInvoicesPaymentStatus accepts valid values', () => {
    const validStatuses: GetMyInvoicesPaymentStatus[] = [
      'Unknown',
      'Paid',
      'Partially',
      'Not paid',
    ];
    expect(validStatuses).toHaveLength(4);
  });

  // -------------------------------------------------------------------------
  // GetMyInvoicesPaymentMethod
  // -------------------------------------------------------------------------
  it('GetMyInvoicesPaymentMethod accepts valid values', () => {
    const validMethods: GetMyInvoicesPaymentMethod[] = [
      'bank_transfer',
      'cash',
      'check',
      'direct_debit',
      'credit',
      'cc',
      'paypal',
      'online_payment',
      'amazon_pay',
      'apple_pay',
      'google_pay',
      'external_receivables_management',
      'cashbox',
      'offsetting',
      'other',
    ];
    expect(validMethods).toHaveLength(15);
  });

  // -------------------------------------------------------------------------
  // GetMyInvoicesIntegrationConfig
  // -------------------------------------------------------------------------
  it('GetMyInvoicesIntegrationConfig has all expected optional fields', () => {
    const config: GetMyInvoicesIntegrationConfig = {};
    expect(config).toEqual({});

    const fullConfig: GetMyInvoicesIntegrationConfig = {
      baseUrl: 'https://api.example.com',
      applicationHeader: 'MyApp',
      userAgent: 'MyAgent/1.0',
      defaultDocumentType: 'INCOMING_INVOICE',
      payableDocumentType: 'RECEIPT',
      receivableDocumentType: 'SALES_INVOICE',
      defaultPaymentMethod: 'bank_transfer',
      defaultPaymentStatus: 'Unknown',
      defaultCurrency: 'EUR',
      defaultCountryUid: 1,
      autoCreateCompanies: true,
      fallbackCompanyName: 'Test Company',
      runOcrOnUpload: false,
      documentNumberPrefix: 'IL-',
      initialSyncLookbackHours: 48,
      maxDocumentsPerRun: 200,
      pageSize: 100,
      includeDraftDocuments: false,
      requireProcessedDocuments: true,
      enableInboundSync: true,
      inboundInitialSyncLookbackHours: 24,
      inboundMaxDocumentsPerRun: 100,
      inboundPageSize: 50,
      inboundIncludeArchived: true,
      inboundIncludeDeleted: true,
    };
    expect(fullConfig.defaultDocumentType).toBe('INCOMING_INVOICE');
    expect(fullConfig.pageSize).toBe(100);
  });

  // -------------------------------------------------------------------------
  // HandlerResult
  // -------------------------------------------------------------------------
  it('HandlerResult requires success field', () => {
    const result: HandlerResult = { success: true };
    expect(result.success).toBe(true);

    const errorResult: HandlerResult = {
      success: false,
      error: 'Something went wrong',
      message: 'Detailed info',
    };
    expect(errorResult.success).toBe(false);
    expect(errorResult.error).toBe('Something went wrong');
  });

  // -------------------------------------------------------------------------
  // TestConnectionResult
  // -------------------------------------------------------------------------
  it('TestConnectionResult extends HandlerResult', () => {
    const result: TestConnectionResult = {
      success: true,
      connected: true,
      accountId: '42',
      email: 'test@example.com',
      organization: 'Acme',
      apiKeyType: 'full',
      message: 'Connected',
    };
    expect(result.connected).toBe(true);
    expect(result.accountId).toBe('42');
  });

  // -------------------------------------------------------------------------
  // SyncInvoicesResult
  // -------------------------------------------------------------------------
  it('SyncInvoicesResult has correct shape', () => {
    const result: SyncInvoicesResult = {
      success: true,
      startedAt: '2025-01-01T00:00:00Z',
      completedAt: '2025-01-01T00:01:00Z',
      fromDate: '2024-12-31T00:00:00Z',
      checkpointUpdated: true,
      processed: 10,
      synced: 8,
      skipped: 1,
      failed: 1,
      failures: [{ documentId: 'doc-1', error: 'upload failed' }],
    };
    expect(result.processed).toBe(10);
    expect(result.failures).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // InboundSyncResult
  // -------------------------------------------------------------------------
  it('InboundSyncResult has correct shape', () => {
    const result: InboundSyncResult = {
      success: true,
      startedAt: '2025-01-01T00:00:00Z',
      completedAt: '2025-01-01T00:01:00Z',
      fromDate: '2024-12-31T00:00:00Z',
      checkpointUpdated: true,
      processed: 5,
      imported: 3,
      updated: 1,
      deleted: 1,
      skipped: 0,
      failed: 0,
      failures: [],
    };
    expect(result.imported).toBe(3);
    expect(result.deleted).toBe(1);
  });

  // -------------------------------------------------------------------------
  // SyncFailure
  // -------------------------------------------------------------------------
  it('SyncFailure has documentId and error', () => {
    const failure: SyncFailure = {
      documentId: 'doc-42',
      error: 'Upload timeout',
    };
    expect(failure.documentId).toBe('doc-42');
    expect(failure.error).toBe('Upload timeout');
  });

  // -------------------------------------------------------------------------
  // State types
  // -------------------------------------------------------------------------
  it('GetMyInvoicesSyncState has lastSuccessfulSyncAt', () => {
    const state: GetMyInvoicesSyncState = {
      lastSuccessfulSyncAt: '2025-01-01T00:00:00Z',
    };
    expect(state.lastSuccessfulSyncAt).toBeDefined();

    const empty: GetMyInvoicesSyncState = {};
    expect(empty.lastSuccessfulSyncAt).toBeUndefined();
  });

  it('GetMyInvoicesInboundSyncState has lastInboundSyncAt', () => {
    const state: GetMyInvoicesInboundSyncState = {
      lastInboundSyncAt: '2025-01-01T00:00:00Z',
    };
    expect(state.lastInboundSyncAt).toBeDefined();

    const empty: GetMyInvoicesInboundSyncState = {};
    expect(empty.lastInboundSyncAt).toBeUndefined();
  });
});
