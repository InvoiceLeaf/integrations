import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
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
  buildRuntime,
  requireClientId,
  requireJobId,
  toErrorMessage,
} from '../handlers/actions.js';
import { DatevApiError } from '../datev/client.js';
import { createMockContext } from './helpers.js';

// Stub global fetch for discoverAuthEndpoints
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// toErrorMessage
// ---------------------------------------------------------------------------

describe('toErrorMessage', () => {
  it('formats DatevApiError with response body', () => {
    const err = new DatevApiError('fail', 400, '{"detail":"bad"}');
    expect(toErrorMessage(err)).toContain('DATEV API error (400)');
    expect(toErrorMessage(err)).toContain('{"detail":"bad"}');
  });

  it('formats DatevApiError without response body', () => {
    const err = new DatevApiError('fail', 500, '');
    expect(toErrorMessage(err)).toBe('DATEV API error (500).');
  });

  it('formats regular Error', () => {
    expect(toErrorMessage(new Error('something broke'))).toBe('something broke');
  });

  it('formats non-Error values', () => {
    expect(toErrorMessage('string error')).toBe('string error');
    expect(toErrorMessage(42)).toBe('42');
  });

  it('truncates long response bodies', () => {
    const longBody = 'x'.repeat(1000);
    const err = new DatevApiError('fail', 400, longBody);
    const msg = toErrorMessage(err);
    expect(msg.length).toBeLessThan(longBody.length + 50);
    expect(msg).toContain('...');
  });
});

// ---------------------------------------------------------------------------
// requireClientId / requireJobId
// ---------------------------------------------------------------------------

describe('requireClientId', () => {
  it('returns input clientId when provided', () => {
    expect(requireClientId('input-id', 'default-id')).toBe('input-id');
  });

  it('falls back to default clientId', () => {
    expect(requireClientId(undefined, 'default-id')).toBe('default-id');
  });

  it('throws when both are undefined', () => {
    expect(() => requireClientId(undefined, undefined)).toThrow('clientId is required');
  });

  it('throws when both are blank', () => {
    expect(() => requireClientId('  ', '  ')).toThrow('clientId is required');
  });
});

describe('requireJobId', () => {
  it('returns jobId when provided', () => {
    expect(requireJobId('job-123')).toBe('job-123');
  });

  it('throws when undefined', () => {
    expect(() => requireJobId(undefined)).toThrow('jobId is required');
  });

  it('throws when blank', () => {
    expect(() => requireJobId('   ')).toThrow('jobId is required');
  });
});

// ---------------------------------------------------------------------------
// buildRuntime
// ---------------------------------------------------------------------------

describe('buildRuntime', () => {
  it('builds runtime with correct properties', async () => {
    const ctx = createMockContext();
    const runtime = await buildRuntime(ctx);

    expect(runtime.authProvider).toBe('datev-openid-sandbox');
    expect(runtime.environment).toBe('sandbox');
    expect(runtime.apiBaseUrl).toContain('platform-sandbox');
    expect(runtime.xDatevClientId).toBe('test-x-client-id');
    expect(runtime.client).toBeDefined();
  });

  it('throws when auth provider is not connected', async () => {
    const ctx = createMockContext({}, {
      credentials: {
        getAccessToken: vi.fn(),
        getApiKey: vi.fn(),
        refreshToken: vi.fn(),
        getConnectionInfo: vi.fn().mockResolvedValue({ connected: false, provider: 'datev-openid-sandbox' }),
      },
    });

    await expect(buildRuntime(ctx)).rejects.toThrow('is not connected');
  });

  it('falls back to connectionAccountId when xDatevClientId is not configured', async () => {
    const ctx = createMockContext({ xDatevClientId: undefined });
    const runtime = await buildRuntime(ctx);

    // Should use accountId from connection info
    expect(runtime.xDatevClientId).toBe('mock-account-id');
  });
});

// ---------------------------------------------------------------------------
// discoverAuthEndpoints
// ---------------------------------------------------------------------------

describe('discoverAuthEndpoints', () => {
  it('fetches OIDC discovery metadata successfully', async () => {
    const discoveryPayload = {
      issuer: 'https://login.datev.de/openidsandbox',
      authorization_endpoint: 'https://login.datev.de/openidsandbox/authorize',
      token_endpoint: 'https://sandbox-api.datev.de/token',
      jwks_uri: 'https://login.datev.de/openidsandbox/jwks',
      scopes_supported: ['openid', 'accounting:clients:read'],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(discoveryPayload),
    });

    const ctx = createMockContext({ environment: 'sandbox' });
    const result = await discoverAuthEndpoints({}, ctx);

    expect(result.success).toBe(true);
    expect(result.issuer).toBe('https://login.datev.de/openidsandbox');
    expect(result.authorizationEndpoint).toBe('https://login.datev.de/openidsandbox/authorize');
    expect(result.scopesSupported).toContain('openid');
  });

  it('uses custom discoveryUrl when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ issuer: 'custom' }),
    });

    const ctx = createMockContext();
    const result = await discoverAuthEndpoints(
      { discoveryUrl: 'https://custom.idp/discovery' },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.discoveryUrl).toBe('https://custom.idp/discovery');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom.idp/discovery',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('returns error when fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const ctx = createMockContext();
    const result = await discoverAuthEndpoints({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const ctx = createMockContext();
    const result = await discoverAuthEndpoints({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });
});

// ---------------------------------------------------------------------------
// listEndpointOptions
// ---------------------------------------------------------------------------

describe('listEndpointOptions', () => {
  it('returns endpoint templates with example paths', async () => {
    const ctx = createMockContext();
    const result = await listEndpointOptions(
      { clientId: '455148-1', jobId: 'job-123' },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.endpointTemplates.length).toBeGreaterThan(0);

    const listClientsTemplate = result.endpointTemplates.find((t) => t.id === 'list-clients');
    expect(listClientsTemplate).toBeDefined();
    expect(listClientsTemplate?.examplePath).toBe('/clients');

    const createJobTemplate = result.endpointTemplates.find((t) => t.id === 'create-dxso-job');
    expect(createJobTemplate?.examplePath).toContain('455148-1');
  });

  it('uses default placeholders when no input', async () => {
    const ctx = createMockContext();
    const result = await listEndpointOptions({}, ctx);

    expect(result.success).toBe(true);
    // Default clientId is 455148-1 per the handler
    const getJobTemplate = result.endpointTemplates.find((t) => t.id === 'get-dxso-job');
    expect(getJobTemplate?.examplePath).toContain('455148-1');
  });

  it('returns supported auth providers', async () => {
    const ctx = createMockContext();
    const result = await listEndpointOptions({}, ctx);

    expect(result.supportedAuthProviders.length).toBe(3);
    const providers = result.supportedAuthProviders.map((p) => p.provider);
    expect(providers).toContain('datev-openid');
    expect(providers).toContain('datev-openid-sandbox');
    expect(providers).toContain('datev-idp-next');
  });

  it('returns auth discovery URLs', async () => {
    const ctx = createMockContext();
    const result = await listEndpointOptions({}, ctx);

    expect(result.authDiscovery.production).toContain('openid');
    expect(result.authDiscovery.sandbox).toContain('openidsandbox');
  });
});

// ---------------------------------------------------------------------------
// callDatevEndpoint
// ---------------------------------------------------------------------------

describe('callDatevEndpoint', () => {
  it('returns error when method is missing', async () => {
    const ctx = createMockContext();
    const result = await callDatevEndpoint(
      { method: '' as 'GET', path: '/clients' },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('method and path are required');
  });

  it('returns error when path is missing', async () => {
    const ctx = createMockContext();
    const result = await callDatevEndpoint(
      { method: 'GET', path: '' },
      ctx
    );

    expect(result.success).toBe(false);
  });

  it('makes successful API call', async () => {
    // The underlying DatevClient.request will call fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: vi.fn().mockResolvedValue(JSON.stringify([{ id: '1' }])),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('[]').buffer),
    });

    const ctx = createMockContext();
    const result = await callDatevEndpoint(
      { method: 'GET', path: '/clients' },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.request.method).toBe('GET');
    expect(result.request.path).toBe('/clients');
  });

  it('applies path params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: vi.fn().mockResolvedValue('{}'),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('{}').buffer),
    });

    const ctx = createMockContext();
    const result = await callDatevEndpoint(
      {
        method: 'GET',
        path: '/clients/{client-id}/dxso-jobs',
        pathParams: { 'client-id': '455148-1' },
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.request.path).toContain('455148-1');
    expect(result.request.path).not.toContain('{client-id}');
  });

  it('returns error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('Forbidden'),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('Forbidden').buffer),
    });

    const ctx = createMockContext();
    const result = await callDatevEndpoint(
      { method: 'GET', path: '/clients' },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// listClients action handler
// ---------------------------------------------------------------------------

describe('listClients', () => {
  it('returns clients on success', async () => {
    const clientList = [{ id: '455148-1', name: 'Test Corp' }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: vi.fn().mockResolvedValue(JSON.stringify(clientList)),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify(clientList)).buffer),
    });

    const ctx = createMockContext();
    const result = await listClients({}, ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('1 client(s)');
    expect(result.clients).toEqual(clientList);
  });

  it('returns error on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('Unauthorized'),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('Unauthorized').buffer),
    });

    const ctx = createMockContext();
    const result = await listClients({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getClient action handler
// ---------------------------------------------------------------------------

describe('getClient', () => {
  it('returns client details on success', async () => {
    const clientDetails = { id: '455148-1', name: 'Test Corp', is_document_management_available: true };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: vi.fn().mockResolvedValue(JSON.stringify(clientDetails)),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify(clientDetails)).buffer),
    });

    const ctx = createMockContext();
    const result = await getClient({ clientId: '455148-1' }, ctx);

    expect(result.success).toBe(true);
    expect(result.client).toEqual(clientDetails);
  });

  it('falls back to defaultClientId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: vi.fn().mockResolvedValue(JSON.stringify({ id: '455148-1' })),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('{}').buffer),
    });

    const ctx = createMockContext({ defaultClientId: '455148-1' });
    const result = await getClient({}, ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('455148-1');
  });
});

// ---------------------------------------------------------------------------
// createDxsoJob action handler
// ---------------------------------------------------------------------------

describe('createDxsoJob', () => {
  it('creates a job with provided import type and accounting month', async () => {
    const jobResponse = { id: 'job-abc', account_length: 4 };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: vi.fn().mockResolvedValue(JSON.stringify(jobResponse)),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify(jobResponse)).buffer),
    });

    const ctx = createMockContext();
    const result = await createDxsoJob(
      { clientId: '455148-1', importType: 'accountsPayableLedgerImport', accountingMonth: '2026-03' },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.job).toEqual(jobResponse);
    expect(result.clientId).toBe('455148-1');
  });

  it('returns error when only importType is provided without accountingMonth', async () => {
    // Need to mock fetch for buildRuntime
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: vi.fn().mockResolvedValue('[]'),
      arrayBuffer: vi.fn(),
    });

    const ctx = createMockContext({
      defaultImportType: undefined,
      defaultAccountingMonth: undefined,
    });
    const result = await createDxsoJob(
      { importType: 'accountsPayableLedgerImport' },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('both importType and accountingMonth');
  });
});

// ---------------------------------------------------------------------------
// uploadDxsoJobFile action handler
// ---------------------------------------------------------------------------

describe('uploadDxsoJobFile', () => {
  it('returns error when required fields are missing', async () => {
    // Still needs to call buildRuntime which calls fetch
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: vi.fn().mockResolvedValue('[]'),
      arrayBuffer: vi.fn(),
    });

    const ctx = createMockContext();
    const result = await uploadDxsoJobFile(
      { jobId: '', fileName: '', fileContentBase64: '' },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });
});

// ---------------------------------------------------------------------------
// getDxsoJob action handler
// ---------------------------------------------------------------------------

describe('getDxsoJob', () => {
  it('returns error when jobId is missing', async () => {
    const ctx = createMockContext();
    const result = await getDxsoJob({ jobId: '' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('jobId is required');
  });
});

// ---------------------------------------------------------------------------
// finalizeDxsoJob action handler
// ---------------------------------------------------------------------------

describe('finalizeDxsoJob', () => {
  it('returns error when jobId is missing', async () => {
    const ctx = createMockContext();
    const result = await finalizeDxsoJob({ jobId: '' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('jobId is required');
  });
});

// ---------------------------------------------------------------------------
// cancelDxsoJob action handler
// ---------------------------------------------------------------------------

describe('cancelDxsoJob', () => {
  it('returns error when jobId is missing', async () => {
    const ctx = createMockContext();
    const result = await cancelDxsoJob({ jobId: '' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('jobId is required');
  });
});

// ---------------------------------------------------------------------------
// listDxsoJobProtocolEntries action handler
// ---------------------------------------------------------------------------

describe('listDxsoJobProtocolEntries', () => {
  it('returns error when jobId is missing', async () => {
    const ctx = createMockContext();
    const result = await listDxsoJobProtocolEntries({ jobId: '' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('jobId is required');
  });
});
