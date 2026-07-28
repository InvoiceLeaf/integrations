/**
 * PayPal integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export {
  pullInvoicesFromPaypal,
  pushInvoicesToPaypal,
  syncPaypalPayments,
  testConnection,
} from './handlers/index.js';

export type {
  PaypalIntegrationConfig,
  HandlerResult,
  TestConnectionResult,
  InvoiceImportResult,
  PaymentSyncResult,
  PushInvoicesResult,
  PushFailure,
  SyncFailure,
  PaypalPushSyncState,
} from './types.js';
