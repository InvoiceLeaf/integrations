import { requestWithRetry, toBoundedInt, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type { RequestWithRetryOptions } from '@invoiceleaf/integration-sdk';
import type {
  DatevAuthProvider,
  DatevClientDetails,
  DatevClientSummary,
  DatevDxsoJob,
  DatevDxsoJobStatus,
  DatevEndpointTemplate,
  DatevEnvironment,
  DatevImportType,
  DatevIntegrationConfig,
  DatevProtocolEntry,
} from '../types.js';

export const DATEV_API_BASE_URLS: Record<DatevEnvironment, string> = {
  production: 'https://accounting-dxso-jobs.api.datev.de/platform/v2',
  sandbox: 'https://accounting-dxso-jobs.api.datev.de/platform-sandbox/v2',
};

export const DATEV_AUTH_DISCOVERY_URLS: Record<DatevEnvironment, string> = {
  production: 'https://login.datev.de/openid/.well-known/openid-configuration',
  sandbox: 'https://login.datev.de/openidsandbox/.well-known/openid-configuration',
};

export const DATEV_OAUTH_PROVIDER_CONFIG: Record<
  DatevAuthProvider,
  { authorizeUrl: string; tokenUrl: string }
> = {
  'datev-openid': {
    authorizeUrl: 'https://login.datev.de/openid/authorize',
    tokenUrl: 'https://api.datev.de/token',
  },
  'datev-openid-sandbox': {
    authorizeUrl: 'https://login.datev.de/openidsandbox/authorize',
    tokenUrl: 'https://sandbox-api.datev.de/token',
  },
  'datev-idp-next': {
    authorizeUrl: 'https://signin.datev.de/datevam/oauth2/realms/root/realms/user/authorize',
    tokenUrl: 'https://signin.datev.de/datevam/oauth2/realms/root/realms/user/access_token',
  },
};

export const DATEV_DXSO_ENDPOINT_TEMPLATES: DatevEndpointTemplate[] = [
  {
    id: 'list-clients',
    method: 'GET',
    pathTemplate: '/clients',
    requiredPathParams: [],
    requiredScopes: ['accounting:clients:read'],
  },
  {
    id: 'get-client',
    method: 'GET',
    pathTemplate: '/clients/{client-id}',
    requiredPathParams: ['client-id'],
    requiredScopes: ['accounting:clients:read'],
  },
  {
    id: 'create-dxso-job',
    method: 'POST',
    pathTemplate: '/clients/{client-id}/dxso-jobs',
    requiredPathParams: ['client-id'],
    requiredScopes: ['accounting:dxso-jobs'],
    contentType: 'application/json',
  },
  {
    id: 'upload-dxso-job-file',
    method: 'POST',
    pathTemplate: '/clients/{client-id}/dxso-jobs/{job-id}/files',
    requiredPathParams: ['client-id', 'job-id'],
    requiredScopes: ['accounting:dxso-jobs'],
    contentType: 'multipart/form-data',
  },
  {
    id: 'get-dxso-job',
    method: 'GET',
    pathTemplate: '/clients/{client-id}/dxso-jobs/{job-id}',
    requiredPathParams: ['client-id', 'job-id'],
    requiredScopes: ['accounting:dxso-jobs'],
  },
  {
    id: 'finalize-dxso-job',
    method: 'PUT',
    pathTemplate: '/clients/{client-id}/dxso-jobs/{job-id}',
    requiredPathParams: ['client-id', 'job-id'],
    requiredScopes: ['accounting:dxso-jobs'],
    contentType: 'application/merge-patch+json',
  },
  {
    id: 'cancel-dxso-job',
    method: 'DELETE',
    pathTemplate: '/clients/{client-id}/dxso-jobs/{job-id}',
    requiredPathParams: ['client-id', 'job-id'],
    requiredScopes: ['accounting:dxso-jobs'],
  },
  {
    id: 'list-dxso-protocol-entries',
    method: 'GET',
    pathTemplate: '/clients/{client-id}/dxso-jobs/{job-id}/protocol-entries',
    requiredPathParams: ['client-id', 'job-id'],
    requiredScopes: ['accounting:dxso-jobs'],
  },
];

export interface DatevClientOptions {
  accessToken: string;
  xDatevClientId: string;
  baseUrl: string;
  maxRequestAttempts?: number;
  requestTimeoutMs?: number;
  userAgent?: string;
}

export interface DatevRequestInput {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  contentType?: string;
}

export class DatevApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'DatevApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class DatevClient {
  private readonly accessToken: string;
  private readonly xDatevClientId: string;
  private readonly baseUrl: string;
  private readonly maxRequestAttempts: number;
  private readonly requestTimeoutMs: number;
  private readonly userAgent: string;

  constructor(options: DatevClientOptions) {
    this.accessToken = options.accessToken;
    this.xDatevClientId = options.xDatevClientId;
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.maxRequestAttempts = toBoundedInt(
      options.maxRequestAttempts,
      3,
      1,
      5
    );
    this.requestTimeoutMs = toBoundedInt(
      options.requestTimeoutMs,
      30_000,
      1_000,
      120_000
    );
    this.userAgent = trimToUndefined(options.userAgent) ?? 'InvoiceLeaf integration-datev/1.0';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async listClients(): Promise<DatevClientSummary[]> {
    return this.request<DatevClientSummary[]>({
      method: 'GET',
      path: '/clients',
    });
  }

  async getClient(clientId: string): Promise<DatevClientDetails> {
    return this.request<DatevClientDetails>({
      method: 'GET',
      path: `/clients/${encodeURIComponent(clientId)}`,
    });
  }

  async createDxsoJob(
    clientId: string,
    body: { import_type?: DatevImportType; accounting_month?: string }
  ): Promise<DatevDxsoJob> {
    return this.request<DatevDxsoJob>({
      method: 'POST',
      path: `/clients/${encodeURIComponent(clientId)}/dxso-jobs`,
      body,
      contentType: 'application/json',
    });
  }

  async uploadDxsoJobFile(input: {
    clientId: string;
    jobId: string;
    fileName: string;
    fileContent: Buffer;
    contentType?: string;
  }): Promise<Record<string, unknown>> {
    const form = new FormData();
    const blob = new Blob([input.fileContent], {
      type: trimToUndefined(input.contentType) ?? 'application/octet-stream',
    });
    form.append('files', blob, input.fileName);

    return this.request<Record<string, unknown>>({
      method: 'POST',
      path: `/clients/${encodeURIComponent(input.clientId)}/dxso-jobs/${encodeURIComponent(input.jobId)}/files`,
      body: form,
    });
  }

  async getDxsoJob(clientId: string, jobId: string): Promise<DatevDxsoJobStatus> {
    return this.request<DatevDxsoJobStatus>({
      method: 'GET',
      path: `/clients/${encodeURIComponent(clientId)}/dxso-jobs/${encodeURIComponent(jobId)}`,
    });
  }

  async finalizeDxsoJob(clientId: string, jobId: string, ready = true): Promise<DatevDxsoJobStatus> {
    return this.request<DatevDxsoJobStatus>({
      method: 'PUT',
      path: `/clients/${encodeURIComponent(clientId)}/dxso-jobs/${encodeURIComponent(jobId)}`,
      body: {
        ready,
      },
      contentType: 'application/merge-patch+json',
    });
  }

  async cancelDxsoJob(clientId: string, jobId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>({
      method: 'DELETE',
      path: `/clients/${encodeURIComponent(clientId)}/dxso-jobs/${encodeURIComponent(jobId)}`,
    });
  }

  async listDxsoJobProtocolEntries(clientId: string, jobId: string): Promise<DatevProtocolEntry[]> {
    return this.request<DatevProtocolEntry[]>({
      method: 'GET',
      path: `/clients/${encodeURIComponent(clientId)}/dxso-jobs/${encodeURIComponent(jobId)}/protocol-entries`,
    });
  }

  async request<T>(input: DatevRequestInput): Promise<T> {
    const url = new URL(normalizePath(input.path), `${this.baseUrl}/`);
    if (input.query) {
      for (const [key, value] of Object.entries(input.query)) {
        const normalizedKey = trimToUndefined(key);
        const normalizedValue = trimToUndefined(value);
        if (normalizedKey && normalizedValue) {
          url.searchParams.set(normalizedKey, normalizedValue);
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: 'application/json',
      'X-DATEV-Client-Id': this.xDatevClientId,
      'User-Agent': this.userAgent,
    };

    let body: RequestInit['body'] | undefined;
    if (input.body !== undefined) {
      if (input.body instanceof FormData) {
        body = input.body;
      } else {
        headers['Content-Type'] = trimToUndefined(input.contentType) ?? 'application/json';
        body = JSON.stringify(input.body);
      }
    }

    const init: RequestInit = {
      method: input.method,
      headers,
      body,
    };

    const retryOptions: RequestWithRetryOptions = {
      method: input.method,
      maxAttempts: this.maxRequestAttempts,
      timeoutMs: this.requestTimeoutMs,
      createError: (message, status, responseBody) =>
        new DatevApiError(message, status, responseBody),
    };

    return requestWithRetry<T>(url.toString(), init, retryOptions);
  }
}

export function resolveEnvironment(config: DatevIntegrationConfig): DatevEnvironment {
  if (config.environment === 'production' || config.environment === 'sandbox') {
    return config.environment;
  }

  if (config.authProvider === 'datev-openid-sandbox') {
    return 'sandbox';
  }

  return 'production';
}

export function resolveAuthProvider(config: DatevIntegrationConfig): DatevAuthProvider {
  if (
    config.authProvider === 'datev-openid' ||
    config.authProvider === 'datev-openid-sandbox' ||
    config.authProvider === 'datev-idp-next'
  ) {
    return config.authProvider;
  }

  return resolveEnvironment(config) === 'sandbox' ? 'datev-openid-sandbox' : 'datev-openid';
}

export function resolveApiBaseUrl(config: DatevIntegrationConfig): string {
  return trimToUndefined(config.apiBaseUrl) ?? DATEV_API_BASE_URLS[resolveEnvironment(config)];
}

export function resolveDatevClientId(input: {
  configClientId?: string;
  connectionAccountId?: string;
}): string {
  const resolved = trimToUndefined(input.configClientId) ?? trimToUndefined(input.connectionAccountId);
  if (!resolved) {
    throw new Error(
      'Missing X-DATEV-Client-Id. Configure xDatevClientId in integration settings (or reconnect if provider account metadata carries the client id).'
    );
  }
  return resolved;
}

export function formatEndpointPath(
  pathTemplate: string,
  params: {
    clientId?: string;
    jobId?: string;
  }
): string {
  const clientId = trimToUndefined(params.clientId) ?? '{client-id}';
  const jobId = trimToUndefined(params.jobId) ?? '{job-id}';
  return pathTemplate.replaceAll('{client-id}', clientId).replaceAll('{job-id}', jobId);
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
