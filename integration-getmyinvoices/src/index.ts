/**
 * GetMyInvoices integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export {
  testConnection,
  syncInvoices,
  syncInvoiceEvent,
  deleteInvoiceEvent,
  pullDocumentsFromGetmyinvoices,
} from './handlers/index.js';

export type {
  GetMyInvoicesIntegrationConfig,
  GetMyInvoicesDocumentType,
  HandlerResult,
  TestConnectionResult,
  SyncInvoicesResult,
  InboundSyncResult,
  SyncFailure,
  GetMyInvoicesSyncState,
  GetMyInvoicesInboundSyncState,
} from './types.js';
