import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DatevClient,
  DatevApiError,
  DATEV_API_BASE_URLS,
  DATEV_AUTH_DISCOVERY_URLS,
  DATEV_OAUTH_PROVIDER_CONFIG,
  DATEV_DXSO_ENDPOINT_TEMPLATES,
  resolveEnvironment,
  resolveAuthProvider,
  resolveApiBaseUrl,
  resolveDatevClientId,
  formatEndpointPath,
} from '../datev/client.js';
import type { DatevIntegrationConfig } from '../types.js';

// Stub global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): object {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify(body)).buffer),
  };
}

function errorResponse(status: number, body = ''): object {
  return {
    ok: false,
    status,
    statusText: 'Error',
    headers: new Headers(),
    text: vi.fn().mockResolvedValue(body),
    arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(body).buffer),
  };
}

function createClient(overrides: Partial<ConstructorParameters<typeof DatevClient>[0]> = {}): DatevClient {
  return new DatevClient({
    accessToken: 'test-access-token',
    xDatevClientId: 'test-x-client-id',
    baseUrl: 'https://accounting-dxso-jobs.api.datev.de/platform-sandbox/v2',
    maxRequestAttempts: 1,
    requestTimeoutMs: 5000,
    ...overrides,
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('DATEV constants', () => {
  it('DATEV_API_BASE_URLS has production and sandbox', () => {
    expect(DATEV_API_BASE_URLS.production).toContain('platform/v2');
    expect(DATEV_API_BASE_URLS.sandbox).toContain('platform-sandbox/v2');
  });

  it('DATEV_AUTH_DISCOVERY_URLS has production and sandbox', () => {
    expect(DATEV_AUTH_DISCOVERY_URLS.production).toContain('openid');
    expect(DATEV_AUTH_DISCOVERY_URLS.sandbox).toContain('openidsandbox');
  });

  it('DATEV_OAUTH_PROVIDER_CONFIG has all three providers', () => {
    expect(DATEV_OAUTH_PROVIDER_CONFIG['datev-openid']).toBeDefined();
    expect(DATEV_OAUTH_PROVIDER_CONFIG['datev-openid-sandbox']).toBeDefined();
    expect(DATEV_OAUTH_PROVIDER_CONFIG['datev-idp-next']).toBeDefined();
  });

  it('DATEV_DXSO_ENDPOINT_TEMPLATES contains expected endpoint ids', () => {
    const ids = DATEV_DXSO_ENDPOINT_TEMPLATES.map((t) => t.id);
    expect(ids).toContain('list-clients');
    expect(ids).toContain('create-dxso-job');
    expect(ids).toContain('upload-dxso-job-file');
    expect(ids).toContain('get-dxso-job');
    expect(ids).toContain('finalize-dxso-job');
    expect(ids).toContain('cancel-dxso-job');
    expect(ids).toContain('list-dxso-protocol-entries');
  });
});

// ---------------------------------------------------------------------------
// DatevApiError
// ---------------------------------------------------------------------------

describe('DatevApiError', () => {
  it('stores status and response body', () => {
    const err = new DatevApiError('bad request', 400, '{"error":"invalid"}');
    expect(err.name).toBe('DatevApiError');
    expect(err.status).toBe(400);
    expect(err.responseBody).toBe('{"error":"invalid"}');
    expect(err.message).toBe('bad request');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// DatevClient constructor & getBaseUrl
// ---------------------------------------------------------------------------

describe('DatevClient', () => {
  it('trims trailing slash from baseUrl', () => {
    const client = createClient({ baseUrl: 'https://example.com/api/' });
    expect(client.getBaseUrl()).toBe('https://example.com/api');
  });

  it('preserves baseUrl without trailing slash', () => {
    const client = createClient({ baseUrl: 'https://example.com/api' });
    expect(client.getBaseUrl()).toBe('https://example.com/api');
  });

  it('uses default user agent when none provided', () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    const client = createClient();
    client.listClients();
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['User-Agent']).toBe('InvoiceLeaf integration-datev/1.0');
  });

  it('uses custom user agent when provided', () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    const client = createClient({ userAgent: 'CustomAgent/2.0' });
    client.listClients();
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['User-Agent']).toBe('CustomAgent/2.0');
  });

  // -------------------------------------------------------------------------
  // listClients
  // -------------------------------------------------------------------------

  describe('listClients', () => {
    it('sends GET /clients with auth headers', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([{ id: '455148-1', name: 'Test Client' }])
      );
      const client = createClient();
      const result = await client.listClients();

      expect(result).toEqual([{ id: '455148-1', name: 'Test Client' }]);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/clients');
      expect(init.method).toBe('GET');
      expect(init.headers['Authorization']).toBe('Bearer test-access-token');
      expect(init.headers['X-DATEV-Client-Id']).toBe('test-x-client-id');
      expect(init.headers['Accept']).toBe('application/json');
    });
  });

  // -------------------------------------------------------------------------
  // getClient
  // -------------------------------------------------------------------------

  describe('getClient', () => {
    it('URL-encodes the client id', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: '455/148-1' }));
      const client = createClient();
      await client.getClient('455/148-1');

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain(encodeURIComponent('455/148-1'));
    });
  });

  // -------------------------------------------------------------------------
  // createDxsoJob
  // -------------------------------------------------------------------------

  describe('createDxsoJob', () => {
    it('sends POST with JSON body', async () => {
      const jobResponse = { id: 'job-123', account_length: 4 };
      mockFetch.mockResolvedValueOnce(jsonResponse(jobResponse));

      const client = createClient();
      const result = await client.createDxsoJob('455148-1', {
        import_type: 'accountsReceivableLedgerImport',
        accounting_month: '2026-01',
      });

      expect(result).toEqual(jobResponse);

      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(init.body as string);
      expect(body.import_type).toBe('accountsReceivableLedgerImport');
      expect(body.accounting_month).toBe('2026-01');
    });
  });

  // -------------------------------------------------------------------------
  // uploadDxsoJobFile
  // -------------------------------------------------------------------------

  describe('uploadDxsoJobFile', () => {
    it('sends POST with FormData body', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ uploaded: true }));

      const client = createClient();
      const result = await client.uploadDxsoJobFile({
        clientId: '455148-1',
        jobId: 'job-123',
        fileName: 'invoice.pdf',
        fileContent: Buffer.from('fake-pdf'),
        contentType: 'application/pdf',
      });

      expect(result).toEqual({ uploaded: true });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/dxso-jobs/job-123/files');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      // FormData should not set Content-Type header manually (browser/node sets boundary)
      expect(init.headers['Content-Type']).toBeUndefined();
    });

    it('defaults to application/octet-stream content type for blob', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const client = createClient();
      await client.uploadDxsoJobFile({
        clientId: '455148-1',
        jobId: 'job-123',
        fileName: 'file.bin',
        fileContent: Buffer.from('data'),
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // getDxsoJob
  // -------------------------------------------------------------------------

  describe('getDxsoJob', () => {
    it('sends GET for job status', async () => {
      const statusResponse = { id: 'job-123', status: 200 };
      mockFetch.mockResolvedValueOnce(jsonResponse(statusResponse));

      const client = createClient();
      const result = await client.getDxsoJob('455148-1', 'job-123');

      expect(result).toEqual(statusResponse);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('/clients/455148-1/dxso-jobs/job-123');
    });
  });

  // -------------------------------------------------------------------------
  // finalizeDxsoJob
  // -------------------------------------------------------------------------

  describe('finalizeDxsoJob', () => {
    it('sends PUT with ready=true body', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'job-123', status: 200 }));

      const client = createClient();
      await client.finalizeDxsoJob('455148-1', 'job-123', true);

      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe('PUT');
      expect(init.headers['Content-Type']).toBe('application/merge-patch+json');
      expect(JSON.parse(init.body as string)).toEqual({ ready: true });
    });

    it('defaults ready to true', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'job-123', status: 200 }));

      const client = createClient();
      await client.finalizeDxsoJob('455148-1', 'job-123');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.ready).toBe(true);
    });

    it('sends ready=false when specified', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'job-123', status: 200 }));

      const client = createClient();
      await client.finalizeDxsoJob('455148-1', 'job-123', false);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.ready).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // cancelDxsoJob
  // -------------------------------------------------------------------------

  describe('cancelDxsoJob', () => {
    it('sends DELETE request', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const client = createClient();
      await client.cancelDxsoJob('455148-1', 'job-123');

      const [url, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe('DELETE');
      expect(url).toContain('/clients/455148-1/dxso-jobs/job-123');
    });
  });

  // -------------------------------------------------------------------------
  // listDxsoJobProtocolEntries
  // -------------------------------------------------------------------------

  describe('listDxsoJobProtocolEntries', () => {
    it('returns protocol entries', async () => {
      const entries = [{ text: 'OK', type: 'info' }];
      mockFetch.mockResolvedValueOnce(jsonResponse(entries));

      const client = createClient();
      const result = await client.listDxsoJobProtocolEntries('455148-1', 'job-123');

      expect(result).toEqual(entries);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('/protocol-entries');
    });
  });

  // -------------------------------------------------------------------------
  // request (generic)
  // -------------------------------------------------------------------------

  describe('request', () => {
    it('appends query parameters', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const client = createClient();
      await client.request({
        method: 'GET',
        path: '/clients',
        query: { page: '1', limit: '10', empty: undefined },
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('page=1');
      expect(url).toContain('limit=10');
      expect(url).not.toContain('empty');
    });

    it('normalizes paths without leading slash', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const client = createClient();
      await client.request({ method: 'GET', path: 'clients' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('/clients');
    });

    it('throws DatevApiError on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(403, 'Forbidden'));

      const client = createClient();
      await expect(client.request({ method: 'GET', path: '/clients' })).rejects.toThrow(DatevApiError);
    });

    it('propagates DatevApiError status code', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

      const client = createClient();
      try {
        await client.request({ method: 'GET', path: '/clients' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(DatevApiError);
        expect((err as DatevApiError).status).toBe(401);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// resolveEnvironment
// ---------------------------------------------------------------------------

describe('resolveEnvironment', () => {
  it('returns "production" when config says production', () => {
    expect(resolveEnvironment({ environment: 'production' })).toBe('production');
  });

  it('returns "sandbox" when config says sandbox', () => {
    expect(resolveEnvironment({ environment: 'sandbox' })).toBe('sandbox');
  });

  it('returns "sandbox" when authProvider is datev-openid-sandbox', () => {
    expect(resolveEnvironment({ authProvider: 'datev-openid-sandbox' })).toBe('sandbox');
  });

  it('defaults to "production" when no environment or sandbox provider', () => {
    expect(resolveEnvironment({})).toBe('production');
  });

  it('defaults to "production" for unknown environment string', () => {
    // The function checks for exact matches; anything else falls through
    expect(resolveEnvironment({ environment: 'staging' as DatevIntegrationConfig['environment'] })).toBe('production');
  });
});

// ---------------------------------------------------------------------------
// resolveAuthProvider
// ---------------------------------------------------------------------------

describe('resolveAuthProvider', () => {
  it('returns the explicit provider from config', () => {
    expect(resolveAuthProvider({ authProvider: 'datev-idp-next' })).toBe('datev-idp-next');
  });

  it('returns datev-openid-sandbox for sandbox environment', () => {
    expect(resolveAuthProvider({ environment: 'sandbox' })).toBe('datev-openid-sandbox');
  });

  it('returns datev-openid for production environment', () => {
    expect(resolveAuthProvider({ environment: 'production' })).toBe('datev-openid');
  });

  it('defaults to datev-openid when nothing specified', () => {
    expect(resolveAuthProvider({})).toBe('datev-openid');
  });
});

// ---------------------------------------------------------------------------
// resolveApiBaseUrl
// ---------------------------------------------------------------------------

describe('resolveApiBaseUrl', () => {
  it('returns custom URL when configured', () => {
    const result = resolveApiBaseUrl({ apiBaseUrl: 'https://custom.api.example.com' });
    expect(result).toBe('https://custom.api.example.com');
  });

  it('returns production URL for production environment', () => {
    const result = resolveApiBaseUrl({ environment: 'production' });
    expect(result).toBe(DATEV_API_BASE_URLS.production);
  });

  it('returns sandbox URL for sandbox environment', () => {
    const result = resolveApiBaseUrl({ environment: 'sandbox' });
    expect(result).toBe(DATEV_API_BASE_URLS.sandbox);
  });

  it('ignores blank/whitespace-only apiBaseUrl', () => {
    const result = resolveApiBaseUrl({ apiBaseUrl: '   ', environment: 'sandbox' });
    expect(result).toBe(DATEV_API_BASE_URLS.sandbox);
  });
});

// ---------------------------------------------------------------------------
// resolveDatevClientId
// ---------------------------------------------------------------------------

describe('resolveDatevClientId', () => {
  it('prefers configClientId', () => {
    expect(resolveDatevClientId({ configClientId: 'from-config', connectionAccountId: 'from-conn' })).toBe(
      'from-config'
    );
  });

  it('falls back to connectionAccountId', () => {
    expect(resolveDatevClientId({ connectionAccountId: 'from-conn' })).toBe('from-conn');
  });

  it('throws when both are missing', () => {
    expect(() => resolveDatevClientId({})).toThrow('Missing X-DATEV-Client-Id');
  });

  it('throws when both are blank', () => {
    expect(() => resolveDatevClientId({ configClientId: '  ', connectionAccountId: '' })).toThrow(
      'Missing X-DATEV-Client-Id'
    );
  });
});

// ---------------------------------------------------------------------------
// formatEndpointPath
// ---------------------------------------------------------------------------

describe('formatEndpointPath', () => {
  it('replaces both placeholders', () => {
    const result = formatEndpointPath('/clients/{client-id}/dxso-jobs/{job-id}', {
      clientId: '455148-1',
      jobId: 'abc-123',
    });
    expect(result).toBe('/clients/455148-1/dxso-jobs/abc-123');
  });

  it('keeps placeholder when param is missing', () => {
    const result = formatEndpointPath('/clients/{client-id}/dxso-jobs/{job-id}', {});
    expect(result).toBe('/clients/{client-id}/dxso-jobs/{job-id}');
  });

  it('replaces only clientId when jobId is missing', () => {
    const result = formatEndpointPath('/clients/{client-id}/dxso-jobs/{job-id}', {
      clientId: 'my-client',
    });
    expect(result).toBe('/clients/my-client/dxso-jobs/{job-id}');
  });
});
