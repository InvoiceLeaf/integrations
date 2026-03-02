/**
 * sevDesk integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export { testConnection, syncInvoices } from './handlers/index.js';

export type {
  SevdeskIntegrationConfig,
  HandlerResult,
  TestConnectionResult,
  SyncInvoicesResult,
  SyncFailure,
  SevdeskSyncState,
} from './types.js';
