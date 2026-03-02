export interface ZohoIntegrationConfig {
  organizationId?: string;
  apiBaseUrl?: string;
  initialSyncLookbackHours?: number;
  maxDocumentsPerRun?: number;
  pageSize?: number;
  invoiceNumberPrefix?: string;
  defaultItemId?: string;
  fallbackCustomerName?: string;
  includeDraftDocuments?: boolean;
  syncPayables?: boolean;
}

export interface HandlerResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface TestConnectionResult extends HandlerResult {
  connected?: boolean;
  organizationId?: string;
  organizationName?: string | null;
  availableOrganizations?: Array<{ organizationId: string; organizationName: string }>;
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
  organizationId: string;
  failures: SyncFailure[];
}

export interface ZohoSyncState {
  lastSuccessfulSyncAt?: string;
}
