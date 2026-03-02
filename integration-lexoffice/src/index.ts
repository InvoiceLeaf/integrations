/**
 * lexoffice integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export { testConnection, syncInvoices } from './handlers/index.js';

export type {
  LexofficeIntegrationConfig,
  HandlerResult,
  TestConnectionResult,
  SyncInvoicesResult,
  SyncFailure,
  LexofficeSyncState,
} from './types.js';
