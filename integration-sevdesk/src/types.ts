export interface SevdeskIntegrationConfig {
  baseUrl?: string;
  contactCategoryId?: number;
  contactPersonId?: number;
  addressCountryId?: number;
  unityId?: number;
  targetStatus?: 100 | 200;
  invoiceType?: 'RE' | 'WKR' | 'SR' | 'MA' | 'TR' | 'AR' | 'ER';
  taxType?: 'default' | 'eu' | 'noteu' | 'custom' | 'ss';
  taxRuleId?: '1' | '2' | '3' | '4' | '5' | '11' | '17' | '18' | '19' | '20' | '21';
  taxText?: string;
  defaultTaxRate?: number;
  defaultCurrency?: string;
  initialSyncLookbackHours?: number;
  maxDocumentsPerRun?: number;
  pageSize?: number;
  invoiceNumberPrefix?: string;
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
  bookkeepingSystemVersion?: '1.0' | '2.0' | null;
  sampleContactId?: string;
  discoveredContactPersonId?: string;
  discoveredAddressCountryId?: string;
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

export interface SevdeskSyncState {
  lastSuccessfulSyncAt?: string;
}
