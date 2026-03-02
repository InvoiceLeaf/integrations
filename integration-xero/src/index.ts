/**
 * Xero integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export { testConnection, syncInvoices } from './handlers/index.js';

export type {
  XeroIntegrationConfig,
  HandlerResult,
  TestConnectionResult,
  SyncInvoicesResult,
  SyncFailure,
  XeroSyncState,
} from './types.js';

