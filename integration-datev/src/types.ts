export type DatevEnvironment = 'production' | 'sandbox';

export type DatevAuthProvider = 'datev-openid' | 'datev-openid-sandbox' | 'datev-idp-next';

export type DatevImportType =
  | 'accountsPayableLedgerImport'
  | 'accountsReceivableLedgerImport'
  | 'cashLedgerImport';

export interface DatevIntegrationConfig {
  environment?: DatevEnvironment;
  authProvider?: DatevAuthProvider;
  apiBaseUrl?: string;
  xDatevClientId?: string;
  defaultClientId?: string;
  defaultImportType?: DatevImportType;
  defaultAccountingMonth?: string;
  requestTimeoutMs?: number;
  maxRequestAttempts?: number;
}

export interface HandlerResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface DatevEndpointTemplate {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  pathTemplate: string;
  requiredPathParams: string[];
  requiredScopes: string[];
  contentType?: string;
}

export interface DatevClientSummary {
  id?: string;
  name?: string;
  consultant_number?: number;
  client_number?: number;
}

export interface DatevClientDetails extends DatevClientSummary {
  is_document_management_available?: boolean;
}

export interface DatevDxsoJob {
  id?: string;
  account_length?: number;
  cash_ledger_names?: string[];
  ledger_folder_names?: string[];
}

export interface DatevDxsoJobStatus {
  id?: string;
  status?: number;
}

export interface DatevProtocolEntry {
  time?: string;
  text?: string;
  context?: string;
  type?: string;
  filename?: string;
}

export interface TestConnectionResult extends HandlerResult {
  connected?: boolean;
  authProvider?: DatevAuthProvider;
  environment?: DatevEnvironment;
  apiBaseUrl?: string;
  xDatevClientId?: string;
  clientCount?: number;
  sampleClients?: DatevClientSummary[];
}

export interface DiscoverAuthEndpointsInput {
  environment?: DatevEnvironment;
  discoveryUrl?: string;
}

export interface DiscoverAuthEndpointsResult extends HandlerResult {
  discoveryUrl?: string;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  revocationEndpoint?: string;
  userInfoEndpoint?: string;
  jwksUri?: string;
  scopesSupported?: string[];
  codeChallengeMethodsSupported?: string[];
}

export interface ListEndpointOptionsInput {
  clientId?: string;
  jobId?: string;
}

export interface ListEndpointOptionsResult extends HandlerResult {
  endpointTemplates: Array<
    DatevEndpointTemplate & {
      examplePath: string;
      productionUrl: string;
      sandboxUrl: string;
    }
  >;
  supportedAuthProviders: Array<{
    provider: DatevAuthProvider;
    authorizeUrl: string;
    tokenUrl: string;
  }>;
  authDiscovery: {
    production: string;
    sandbox: string;
  };
}

export interface CallDatevEndpointInput {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  pathParams?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  contentType?: string;
}

export interface CallDatevEndpointResult extends HandlerResult {
  request: {
    method: string;
    path: string;
    url: string;
  };
  response?: unknown;
}

export interface ClientInput {
  clientId?: string;
}

export interface JobInput extends ClientInput {
  jobId: string;
}

export interface CreateDxsoJobInput extends ClientInput {
  importType?: DatevImportType;
  accountingMonth?: string;
}

export interface UploadDxsoJobFileInput extends JobInput {
  fileName: string;
  fileContentBase64: string;
  contentType?: string;
}
