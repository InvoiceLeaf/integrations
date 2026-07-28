export interface BraintreeIntegrationConfig {
  merchantId?: string;
  publicKey?: string;
  environment?: 'production' | 'sandbox';
  initialSyncLookbackHours?: number;
  maxTransactionsPerRun?: number;
  includeSubmittedForSettlement?: boolean;
  matchByOrderId?: boolean;
  recordUnmatchedTransactions?: boolean;
}

export interface HandlerResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface TestConnectionResult extends HandlerResult {
  pingOk: boolean;
  searchOk: boolean;
}

export interface SyncFailure {
  externalId: string;
  reason: string;
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

export interface BraintreeTransactionSyncState {
  /** ISO timestamp of the newest transaction `createdAt` that was fully processed. */
  lastCreatedAt: string;
}
