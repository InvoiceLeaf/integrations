/**
 * Braintree integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export {
  syncBraintreePayments,
  testConnection,
} from './handlers/index.js';

export type {
  BraintreeIntegrationConfig,
  HandlerResult,
  TestConnectionResult,
  PaymentSyncResult,
  SyncFailure,
  BraintreeTransactionSyncState,
} from './types.js';
