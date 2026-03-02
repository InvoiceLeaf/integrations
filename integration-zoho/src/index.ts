/**
 * Zoho Books integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export { testConnection, syncInvoices } from './handlers/index.js';

export type {
  ZohoIntegrationConfig,
  HandlerResult,
  TestConnectionResult,
  SyncInvoicesResult,
  SyncFailure,
  ZohoSyncState,
} from './types.js';
