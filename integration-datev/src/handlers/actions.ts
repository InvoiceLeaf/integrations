import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import {
  DATEV_API_BASE_URLS,
  DATEV_AUTH_DISCOVERY_URLS,
  DATEV_DXSO_ENDPOINT_TEMPLATES,
  DATEV_OAUTH_PROVIDER_CONFIG,
  DatevApiError,
  DatevClient,
  formatEndpointPath,
  resolveApiBaseUrl,
  resolveAuthProvider,
  resolveDatevClientId,
  resolveEnvironment,
} from '../datev/client.js';
import type {
  CallDatevEndpointInput,
  CallDatevEndpointResult,
  ClientInput,
  CreateDxsoJobInput,
  DatevEnvironment,
  DatevIntegrationConfig,
  DiscoverAuthEndpointsInput,
  DiscoverAuthEndpointsResult,
  HandlerResult,
  JobInput,
  ListEndpointOptionsInput,
  ListEndpointOptionsResult,
  TestConnectionResult,
  UploadDxsoJobFileInput,
} from '../types.js';

interface DatevRuntime {
  client: DatevClient;
  authProvider: string;
  environment: DatevEnvironment;
  apiBaseUrl: string;
  xDatevClientId: string;
}

export const testConnection: IntegrationHandler<unknown, TestConnectionResult, DatevIntegrationConfig> = async (
  _input,
  context
): Promise<TestConnectionResult> => {
  try {
    const runtime = await buildRuntime(context);
    const clients = await runtime.client.listClients();

    return {
      success: true,
      connected: true,
      message: `DATEV connection is valid (${clients.length} accessible client(s)).`,
      authProvider: runtime.authProvider as TestConnectionResult['authProvider'],
      environment: runtime.environment,
      apiBaseUrl: runtime.apiBaseUrl,
      xDatevClientId: runtime.xDatevClientId,
      clientCount: clients.length,
      sampleClients: clients.slice(0, 10),
    };
  } catch (error) {
    context.logger.error('DATEV test connection failed', { error: toErrorMessage(error) });
    return {
      success: false,
      connected: false,
      error: toErrorMessage(error),
    };
  }
};

export const discoverAuthEndpoints: IntegrationHandler<
  DiscoverAuthEndpointsInput,
  DiscoverAuthEndpointsResult,
  DatevIntegrationConfig
> = async (input, context): Promise<DiscoverAuthEndpointsResult> => {
  try {
    const requestedEnvironment =
      input?.environment === 'sandbox' || input?.environment === 'production'
        ? input.environment
        : resolveEnvironment(context.config);

    const discoveryUrl =
      trimToUndefined(input?.discoveryUrl) ?? DATEV_AUTH_DISCOVERY_URLS[requestedEnvironment];

    const response = await fetch(discoveryUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`OIDC discovery request failed with status ${response.status}.`);
    }

    return {
      success: true,
      message: 'Fetched DATEV OIDC discovery metadata.',
      discoveryUrl,
      issuer: asString(payload.issuer),
      authorizationEndpoint: asString(payload.authorization_endpoint),
      tokenEndpoint: asString(payload.token_endpoint),
      revocationEndpoint: asString(payload.revocation_endpoint),
      userInfoEndpoint: asString(payload.userinfo_endpoint),
      jwksUri: asString(payload.jwks_uri),
      scopesSupported: asStringArray(payload.scopes_supported),
      codeChallengeMethodsSupported: asStringArray(payload.code_challenge_methods_supported),
    };
  } catch (error) {
    context.logger.error('DATEV auth discovery failed', { error: toErrorMessage(error) });
    return {
      success: false,
      error: toErrorMessage(error),
    };
  }
};

export const listEndpointOptions: IntegrationHandler<
  ListEndpointOptionsInput,
  ListEndpointOptionsResult,
  DatevIntegrationConfig
> = async (input): Promise<ListEndpointOptionsResult> => {
  const clientId = trimToUndefined(input?.clientId) ?? '455148-1';
  const jobId = trimToUndefined(input?.jobId) ?? '74C73D12-A0E8-65DB-68FE-D7481FF44D72';

  return {
    success: true,
    message: 'Returned DATEV dxso endpoint templates and auth options.',
    endpointTemplates: DATEV_DXSO_ENDPOINT_TEMPLATES.map((template) => {
      const examplePath = formatEndpointPath(template.pathTemplate, {
        clientId,
        jobId,
      });

      return {
        ...template,
        examplePath,
        productionUrl: `${DATEV_API_BASE_URLS.production}${examplePath}`,
        sandboxUrl: `${DATEV_API_BASE_URLS.sandbox}${examplePath}`,
      };
    }),
    supportedAuthProviders: Object.entries(DATEV_OAUTH_PROVIDER_CONFIG).map(([provider, config]) => ({
      provider: provider as ListEndpointOptionsResult['supportedAuthProviders'][number]['provider'],
      authorizeUrl: config.authorizeUrl,
      tokenUrl: config.tokenUrl,
    })),
    authDiscovery: {
      production: DATEV_AUTH_DISCOVERY_URLS.production,
      sandbox: DATEV_AUTH_DISCOVERY_URLS.sandbox,
    },
  };
};

export const callDatevEndpoint: IntegrationHandler<
  CallDatevEndpointInput,
  CallDatevEndpointResult,
  DatevIntegrationConfig
> = async (input, context): Promise<CallDatevEndpointResult> => {
  const runtime = await buildRuntime(context);

  if (!input?.method || !input?.path) {
    return {
      success: false,
      error: 'method and path are required.',
      request: {
        method: input?.method ?? '',
        path: input?.path ?? '',
        url: runtime.apiBaseUrl,
      },
    };
  }

  try {
    const resolvedPath = applyPathParams(input.path, input.pathParams);
    const response = await runtime.client.request<unknown>({
      method: input.method,
      path: resolvedPath,
      query: input.query,
      body: input.body,
      contentType: trimToUndefined(input.contentType),
    });

    return {
      success: true,
      message: 'DATEV endpoint call succeeded.',
      request: {
        method: input.method,
        path: resolvedPath,
        url: `${runtime.apiBaseUrl}${resolvedPath}`,
      },
      response,
    };
  } catch (error) {
    context.logger.error('DATEV generic endpoint call failed', { error: toErrorMessage(error) });
    return {
      success: false,
      error: toErrorMessage(error),
      request: {
        method: input.method,
        path: input.path,
        url: `${runtime.apiBaseUrl}${input.path}`,
      },
    };
  }
};

export const listClients: IntegrationHandler<unknown, HandlerResult & { clients?: unknown[] }, DatevIntegrationConfig> =
  async (_input, context) => {
    try {
      const runtime = await buildRuntime(context);
      const clients = await runtime.client.listClients();
      return {
        success: true,
        message: `Fetched ${clients.length} client(s).`,
        clients,
      };
    } catch (error) {
      context.logger.error('DATEV list clients failed', { error: toErrorMessage(error) });
      return {
        success: false,
        error: toErrorMessage(error),
      };
    }
  };

export const getClient: IntegrationHandler<ClientInput, HandlerResult & { client?: unknown }, DatevIntegrationConfig> = async (
  input,
  context
) => {
  try {
    const runtime = await buildRuntime(context);
    const clientId = requireClientId(input?.clientId, context.config.defaultClientId);
    const client = await runtime.client.getClient(clientId);
    return {
      success: true,
      message: `Fetched DATEV client ${clientId}.`,
      client,
    };
  } catch (error) {
    context.logger.error('DATEV get client failed', { error: toErrorMessage(error) });
    return {
      success: false,
      error: toErrorMessage(error),
    };
  }
};

export const createDxsoJob: IntegrationHandler<
  CreateDxsoJobInput,
  HandlerResult & { clientId?: string; job?: unknown },
  DatevIntegrationConfig
> = async (input, context) => {
  try {
    const runtime = await buildRuntime(context);
    const clientId = requireClientId(input?.clientId, context.config.defaultClientId);

    const importType = input?.importType ?? context.config.defaultImportType;
    const accountingMonth = input?.accountingMonth ?? context.config.defaultAccountingMonth;

    if ((importType && !accountingMonth) || (!importType && accountingMonth)) {
      throw new Error('Provide both importType and accountingMonth together, or omit both.');
    }

    const payload: {
      import_type?: CreateDxsoJobInput['importType'];
      accounting_month?: string;
    } = {};

    if (importType) {
      payload.import_type = importType;
      payload.accounting_month = accountingMonth;
    }

    const job = await runtime.client.createDxsoJob(clientId, payload);
    return {
      success: true,
      message: `Created DATEV dxso-job for client ${clientId}.`,
      clientId,
      job,
    };
  } catch (error) {
    context.logger.error('DATEV create dxso job failed', { error: toErrorMessage(error) });
    return {
      success: false,
      error: toErrorMessage(error),
    };
  }
};

export const uploadDxsoJobFile: IntegrationHandler<
  UploadDxsoJobFileInput,
  HandlerResult & { clientId?: string; jobId?: string; response?: unknown },
  DatevIntegrationConfig
> = async (input, context) => {
  try {
    const runtime = await buildRuntime(context);
    const clientId = requireClientId(input?.clientId, context.config.defaultClientId);
    const jobId = trimToUndefined(input?.jobId);
    const fileName = trimToUndefined(input?.fileName);
    const fileContentBase64 = trimToUndefined(input?.fileContentBase64);

    if (!jobId || !fileName || !fileContentBase64) {
      throw new Error('jobId, fileName, and fileContentBase64 are required.');
    }

    const fileContent = Buffer.from(fileContentBase64, 'base64');
    const response = await runtime.client.uploadDxsoJobFile({
      clientId,
      jobId,
      fileName,
      fileContent,
      contentType: input?.contentType,
    });

    return {
      success: true,
      message: `Uploaded file ${fileName} to dxso-job ${jobId}.`,
      clientId,
      jobId,
      response,
    };
  } catch (error) {
    context.logger.error('DATEV upload dxso file failed', { error: toErrorMessage(error) });
    return {
      success: false,
      error: toErrorMessage(error),
    };
  }
};

export const getDxsoJob: IntegrationHandler<
  JobInput,
  HandlerResult & { clientId?: string; jobId?: string; jobStatus?: unknown },
  DatevIntegrationConfig
> = async (input, context) => {
  try {
    const runtime = await buildRuntime(context);
    const clientId = requireClientId(input?.clientId, context.config.defaultClientId);
    const jobId = requireJobId(input?.jobId);
    const jobStatus = await runtime.client.getDxsoJob(clientId, jobId);

    return {
      success: true,
      message: `Fetched status for dxso-job ${jobId}.`,
      clientId,
      jobId,
      jobStatus,
    };
  } catch (error) {
    context.logger.error('DATEV get dxso job failed', { error: toErrorMessage(error) });
    return {
      success: false,
      error: toErrorMessage(error),
    };
  }
};

export const finalizeDxsoJob: IntegrationHandler<
  JobInput & { ready?: boolean },
  HandlerResult & { clientId?: string; jobId?: string; jobStatus?: unknown },
  DatevIntegrationConfig
> = async (input, context) => {
  try {
    const runtime = await buildRuntime(context);
    const clientId = requireClientId(input?.clientId, context.config.defaultClientId);
    const jobId = requireJobId(input?.jobId);
    const jobStatus = await runtime.client.finalizeDxsoJob(clientId, jobId, input?.ready ?? true);

    return {
      success: true,
      message: `Finalized dxso-job ${jobId}.`,
      clientId,
      jobId,
      jobStatus,
    };
  } catch (error) {
    context.logger.error('DATEV finalize dxso job failed', { error: toErrorMessage(error) });
    return {
      success: false,
      error: toErrorMessage(error),
    };
  }
};

export const cancelDxsoJob: IntegrationHandler<
  JobInput,
  HandlerResult & { clientId?: string; jobId?: string; response?: unknown },
  DatevIntegrationConfig
> = async (input, context) => {
  try {
    const runtime = await buildRuntime(context);
    const clientId = requireClientId(input?.clientId, context.config.defaultClientId);
    const jobId = requireJobId(input?.jobId);
    const response = await runtime.client.cancelDxsoJob(clientId, jobId);

    return {
      success: true,
      message: `Canceled dxso-job ${jobId}.`,
      clientId,
      jobId,
      response,
    };
  } catch (error) {
    context.logger.error('DATEV cancel dxso job failed', { error: toErrorMessage(error) });
    return {
      success: false,
      error: toErrorMessage(error),
    };
  }
};

export const listDxsoJobProtocolEntries: IntegrationHandler<
  JobInput,
  HandlerResult & { clientId?: string; jobId?: string; protocolEntries?: unknown[] },
  DatevIntegrationConfig
> = async (input, context) => {
  try {
    const runtime = await buildRuntime(context);
    const clientId = requireClientId(input?.clientId, context.config.defaultClientId);
    const jobId = requireJobId(input?.jobId);
    const protocolEntries = await runtime.client.listDxsoJobProtocolEntries(clientId, jobId);

    return {
      success: true,
      message: `Fetched ${protocolEntries.length} protocol entr${protocolEntries.length === 1 ? 'y' : 'ies'}.`,
      clientId,
      jobId,
      protocolEntries,
    };
  } catch (error) {
    context.logger.error('DATEV list protocol entries failed', { error: toErrorMessage(error) });
    return {
      success: false,
      error: toErrorMessage(error),
    };
  }
};

async function buildRuntime(
  context: IntegrationContext<DatevIntegrationConfig>
): Promise<DatevRuntime> {
  const authProvider = resolveAuthProvider(context.config);
  const environment = resolveEnvironment(context.config);
  const connectionInfo = await context.credentials.getConnectionInfo(authProvider);

  if (!connectionInfo.connected) {
    throw new Error(`DATEV auth provider "${authProvider}" is not connected.`);
  }

  const accessToken = await context.credentials.getAccessToken(authProvider);
  const apiBaseUrl = resolveApiBaseUrl(context.config);
  const xDatevClientId = resolveDatevClientId({
    configClientId: context.config.xDatevClientId,
    connectionAccountId: connectionInfo.accountId,
  });

  return {
    client: new DatevClient({
      accessToken,
      xDatevClientId,
      baseUrl: apiBaseUrl,
      maxRequestAttempts: context.config.maxRequestAttempts,
      requestTimeoutMs: context.config.requestTimeoutMs,
    }),
    authProvider,
    environment,
    apiBaseUrl,
    xDatevClientId,
  };
}

function requireClientId(inputClientId: string | undefined, defaultClientId: string | undefined): string {
  const clientId = trimToUndefined(inputClientId) ?? trimToUndefined(defaultClientId);
  if (!clientId) {
    throw new Error('clientId is required. Provide it in action input or set defaultClientId in config.');
  }
  return clientId;
}

function requireJobId(jobId: string | undefined): string {
  const normalized = trimToUndefined(jobId);
  if (!normalized) {
    throw new Error('jobId is required.');
  }
  return normalized;
}

function applyPathParams(path: string, params: Record<string, string> | undefined): string {
  if (!params) {
    return path;
  }

  let output = path;
  for (const [key, value] of Object.entries(params)) {
    const cleanedKey = trimToUndefined(key);
    const cleanedValue = trimToUndefined(value);
    if (!cleanedKey || !cleanedValue) {
      continue;
    }

    output = output.replaceAll(`{${cleanedKey}}`, encodeURIComponent(cleanedValue));
  }
  return output;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof DatevApiError) {
    const body = trimToUndefined(error.responseBody);
    return body
      ? `DATEV API error (${error.status}): ${truncate(body, 800)}`
      : `DATEV API error (${error.status}).`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const array = value.filter((item): item is string => typeof item === 'string');
  return array.length > 0 ? array : undefined;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
