/**
 * DATEV integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export {
  testConnection,
  discoverAuthEndpoints,
  listEndpointOptions,
  callDatevEndpoint,
  listClients,
  getClient,
  createDxsoJob,
  uploadDxsoJobFile,
  getDxsoJob,
  finalizeDxsoJob,
  cancelDxsoJob,
  listDxsoJobProtocolEntries,
  syncInvoices,
  syncInvoiceEvent,
  deleteDocumentEvent,
} from './handlers/index.js';

export type {
  DatevIntegrationConfig,
  DatevEnvironment,
  DatevAuthProvider,
  DatevImportType,
  HandlerResult,
  DatevEndpointTemplate,
  DatevClientSummary,
  DatevClientDetails,
  DatevDxsoJob,
  DatevDxsoJobStatus,
  DatevProtocolEntry,
  TestConnectionResult,
  DiscoverAuthEndpointsInput,
  DiscoverAuthEndpointsResult,
  ListEndpointOptionsInput,
  ListEndpointOptionsResult,
  CallDatevEndpointInput,
  CallDatevEndpointResult,
  ClientInput,
  JobInput,
  CreateDxsoJobInput,
  UploadDxsoJobFileInput,
  SyncFailure,
  SyncInvoicesResult,
  DatevSyncState,
} from './types.js';
