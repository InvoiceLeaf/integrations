/**
 * sevDesk integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export {
  testConnection,
  syncInvoices,
  syncInvoiceEvent,
  deleteInvoiceEvent,
  pullInvoicesFromSevdesk,
} from './handlers/index.js';

export type {
  SevdeskIntegrationConfig,
  HandlerResult,
  TestConnectionResult,
  SyncInvoicesResult,
  InboundSyncResult,
  SyncFailure,
  SevdeskSyncState,
  SevdeskInboundSyncState,
} from './types.js';
