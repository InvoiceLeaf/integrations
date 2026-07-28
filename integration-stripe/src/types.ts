export interface StripeIntegrationConfig {
  apiBaseUrl?: string;
  initialSyncLookbackHours?: number;
  maxInvoicesPerRun?: number;
  maxChargesPerRun?: number;
  importDraftInvoices?: boolean;
  importVoidInvoices?: boolean;
  recordUnmatchedCharges?: boolean;
  attachProviderPdf?: boolean;
  maxPushPerRun?: number;
  daysUntilDue?: number;
  autoFinalizeInvoices?: boolean;
  fallbackCustomerName?: string;
  includeDraftDocuments?: boolean;
}

export interface HandlerResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface TestConnectionResult extends HandlerResult {
  invoicesReadable: boolean;
  chargesReadable: boolean;
}

export interface SyncFailure {
  externalId: string;
  reason: string;
}

export interface InvoiceImportResult extends HandlerResult {
  startedAt: string;
  completedAt: string;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  failures: SyncFailure[];
  checkpointUpdated: boolean;
}

export interface PaymentSyncResult extends HandlerResult {
  startedAt: string;
  completedAt: string;
  processed: number;
  recorded: number;
  allocated: number;
  unmatched: number;
  skipped: number;
  failed: number;
  failures: SyncFailure[];
  checkpointUpdated: boolean;
}

export interface PushFailure {
  documentId: string;
  reason: string;
}

export interface PushInvoicesResult extends HandlerResult {
  startedAt: string;
  completedAt: string;
  processed: number;
  pushed: number;
  skipped: number;
  failed: number;
  failures: PushFailure[];
  checkpointUpdated: boolean;
}

export interface StripePushSyncState {
  /** ISO timestamp of the last fully successful push run. */
  lastSuccessfulSyncAt: string;
}

export interface StripeInvoiceSyncState {
  /** Unix seconds of the newest invoice `created` that was fully processed. */
  lastCreatedAt: number;
}

export interface StripeChargeSyncState {
  /** Unix seconds of the newest charge `created` that was fully processed. */
  lastCreatedAt: number;
}
