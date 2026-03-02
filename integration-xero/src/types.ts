export interface XeroIntegrationConfig {
  xeroTenantId?: string;
  targetStatus?: 'DRAFT' | 'AUTHORISED';
  initialSyncLookbackHours?: number;
  maxDocumentsPerRun?: number;
  pageSize?: number;
  invoiceNumberPrefix?: string;
  defaultRevenueAccountCode?: string;
  defaultExpenseAccountCode?: string;
  fallbackContactName?: string;
  includeDraftDocuments?: boolean;
}

export interface HandlerResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface TestConnectionResult extends HandlerResult {
  connected?: boolean;
  tenantId?: string;
  tenantName?: string;
  organisationName?: string | null;
  availableTenants?: Array<{ tenantId: string; tenantName: string }>;
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
  tenantId: string;
  tenantName: string;
  failures: SyncFailure[];
}

export interface XeroSyncState {
  lastSuccessfulSyncAt?: string;
}

