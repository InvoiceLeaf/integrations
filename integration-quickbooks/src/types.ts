export interface QuickBooksIntegrationConfig {
  realmId?: string;
  apiBaseUrl?: string;
  initialSyncLookbackHours?: number;
  maxDocumentsPerRun?: number;
  pageSize?: number;
  invoiceNumberPrefix?: string;
  defaultSalesItemId?: string;
  defaultExpenseAccountId?: string;
  fallbackCustomerName?: string;
  fallbackVendorName?: string;
  includeDraftDocuments?: boolean;
}

export interface HandlerResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface TestConnectionResult extends HandlerResult {
  connected?: boolean;
  realmId?: string;
  companyName?: string | null;
  legalName?: string | null;
}

export interface SyncFailure {
  documentId: string;
  error: string;
}

export interface SyncInvoicesResult extends HandlerResult {
  startedAt: string;
  completedAt: string;
  fromDate: string;
  checkpointUpdated: boolean;
  processed: number;
  synced: number;
  skipped: number;
  failed: number;
  realmId: string;
  failures: SyncFailure[];
}

export interface QuickBooksSyncState {
  lastSuccessfulSyncAt?: string;
}
