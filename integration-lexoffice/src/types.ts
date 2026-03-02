export interface LexofficeIntegrationConfig {
  apiBaseUrl?: string;
  apiKey?: string;
  initialSyncLookbackHours?: number;
  maxDocumentsPerRun?: number;
  pageSize?: number;
  includeDraftDocuments?: boolean;
  fallbackFileNamePrefix?: string;
}

export interface HandlerResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface TestConnectionResult extends HandlerResult {
  connected?: boolean;
  sampleContactId?: string;
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
  failures: SyncFailure[];
}

export interface LexofficeSyncState {
  lastSuccessfulSyncAt?: string;
}
