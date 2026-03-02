/**
 * QuickBooks integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export { testConnection, syncInvoices } from './handlers/index.js';

export type {
  QuickBooksIntegrationConfig,
  HandlerResult,
  TestConnectionResult,
  SyncInvoicesResult,
  SyncFailure,
  QuickBooksSyncState,
} from './types.js';
