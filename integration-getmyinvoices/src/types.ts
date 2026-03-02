export type GetMyInvoicesDocumentType =
  | 'INCOMING_INVOICE'
  | 'RECEIPT'
  | 'PAYMENT_RECEIPT'
  | 'EXPENSE_REIMBURSEMENT'
  | 'SALES_INVOICE'
  | 'CREDIT_NOTE'
  | 'STATEMENT'
  | 'DELIVERY_NOTE'
  | 'ORDER_CONFIRMATION'
  | 'PAYROLL'
  | 'COMPANY_REGISTRATION_DOCUMENT'
  | 'MISC'
  | 'TRAVEL_EXPENSES'
  | 'REMINDER';

export type GetMyInvoicesPaymentStatus = 'Unknown' | 'Paid' | 'Partially' | 'Not paid';

export type GetMyInvoicesPaymentMethod =
  | 'bank_transfer'
  | 'cash'
  | 'check'
  | 'direct_debit'
  | 'credit'
  | 'cc'
  | 'paypal'
  | 'online_payment'
  | 'amazon_pay'
  | 'apple_pay'
  | 'google_pay'
  | 'external_receivables_management'
  | 'cashbox'
  | 'offsetting'
  | 'other';

export interface GetMyInvoicesIntegrationConfig {
  apiKey?: string;
  baseUrl?: string;
  applicationHeader?: string;
  userAgent?: string;
  defaultDocumentType?: GetMyInvoicesDocumentType;
  payableDocumentType?: GetMyInvoicesDocumentType;
  receivableDocumentType?: GetMyInvoicesDocumentType;
  defaultPaymentMethod?: GetMyInvoicesPaymentMethod;
  defaultPaymentStatus?: GetMyInvoicesPaymentStatus;
  defaultCurrency?: string;
  defaultCountryUid?: number;
  autoCreateCompanies?: boolean;
  fallbackCompanyName?: string;
  runOcrOnUpload?: boolean;
  documentNumberPrefix?: string;
  initialSyncLookbackHours?: number;
  maxDocumentsPerRun?: number;
  pageSize?: number;
  includeDraftDocuments?: boolean;
  enableInboundSync?: boolean;
  inboundInitialSyncLookbackHours?: number;
  inboundMaxDocumentsPerRun?: number;
  inboundPageSize?: number;
  inboundIncludeArchived?: boolean;
  inboundIncludeDeleted?: boolean;
}

export interface HandlerResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface TestConnectionResult extends HandlerResult {
  connected?: boolean;
  accountId?: string;
  email?: string;
  organization?: string;
  apiKeyType?: string;
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

export interface InboundSyncResult extends HandlerResult {
  startedAt: string;
  completedAt: string;
  fromDate: string;
  checkpointUpdated: boolean;
  processed: number;
  imported: number;
  updated: number;
  deleted: number;
  skipped: number;
  failed: number;
  failures: SyncFailure[];
}

export interface GetMyInvoicesSyncState {
  lastSuccessfulSyncAt?: string;
}

export interface GetMyInvoicesInboundSyncState {
  lastInboundSyncAt?: string;
}
