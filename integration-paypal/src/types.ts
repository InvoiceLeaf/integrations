export interface PaypalIntegrationConfig {
  /** Client ID of the PayPal REST app (not secret; the Client Secret is stored as a credential). */
  clientId?: string;
  /** PayPal environment: "live" (default) or "sandbox". */
  environment?: string;
  initialSyncLookbackHours?: number;
  maxInvoicesPerRun?: number;
  maxTransactionsPerRun?: number;
  importDraftInvoices?: boolean;
  recordUnmatchedTransactions?: boolean;
  maxPushPerRun?: number;
  autoSendInvoices?: boolean;
  includeDraftDocuments?: boolean;
}

export interface HandlerResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface TestConnectionResult extends HandlerResult {
  tokenOk: boolean;
  invoicesReadable: boolean;
  transactionSearchAvailable: boolean;
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
  /**
   * True when PayPal Transaction Search is not enabled on the REST app.
   * This is a soft condition: the run still succeeds, only unmatched
   * transaction recording is skipped.
   */
  transactionSearchUnavailable: boolean;
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

export interface PaypalPushSyncState {
  /** ISO timestamp of the last fully successful push run. */
  lastSuccessfulSyncAt: string;
}
