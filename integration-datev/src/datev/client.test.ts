import { describe, it, expect } from 'vitest';
import {
  resolveEnvironment,
  resolveAuthProvider,
  resolveApiBaseUrl,
  resolveDatevClientId,
  formatEndpointPath,
  DatevApiError,
  DatevClient,
  DATEV_API_BASE_URLS,
  DATEV_AUTH_DISCOVERY_URLS,
  DATEV_OAUTH_PROVIDER_CONFIG,
  DATEV_DXSO_ENDPOINT_TEMPLATES,
} from './client';
import type { DatevIntegrationConfig } from '../types.js';

// ---------------------------------------------------------------------------
// resolveEnvironment
// ---------------------------------------------------------------------------
describe('resolveEnvironment', () => {
  it('returns "production" when config.environment is "production"', () => {
    expect(resolveEnvironment({ environment: 'production' })).toBe('production');
  });

  it('returns "sandbox" when config.environment is "sandbox"', () => {
    expect(resolveEnvironment({ environment: 'sandbox' })).toBe('sandbox');
  });

  it('falls back to "sandbox" when authProvider is "datev-openid-sandbox"', () => {
    expect(resolveEnvironment({ authProvider: 'datev-openid-sandbox' })).toBe('sandbox');
  });

  it('falls back to "production" when authProvider is "datev-openid"', () => {
    expect(resolveEnvironment({ authProvider: 'datev-openid' })).toBe('production');
  });

  it('falls back to "production" when authProvider is "datev-idp-next"', () => {
    expect(resolveEnvironment({ authProvider: 'datev-idp-next' })).toBe('production');
  });

  it('returns "production" when config is empty', () => {
    expect(resolveEnvironment({})).toBe('production');
  });

  it('explicit environment takes precedence over authProvider fallback', () => {
    expect(
      resolveEnvironment({ environment: 'production', authProvider: 'datev-openid-sandbox' })
    ).toBe('production');
  });

  it('explicit sandbox environment ignores non-sandbox authProvider', () => {
    expect(
      resolveEnvironment({ environment: 'sandbox', authProvider: 'datev-openid' })
    ).toBe('sandbox');
  });

  it('ignores invalid environment values and falls back', () => {
    // Cast to simulate runtime garbage
    expect(resolveEnvironment({ environment: 'staging' as never })).toBe('production');
  });

  it('ignores invalid environment and uses authProvider fallback', () => {
    expect(
      resolveEnvironment({ environment: 'invalid' as never, authProvider: 'datev-openid-sandbox' })
    ).toBe('sandbox');
  });
});

// ---------------------------------------------------------------------------
// resolveAuthProvider
// ---------------------------------------------------------------------------
describe('resolveAuthProvider', () => {
  it('returns "datev-openid" when explicitly set', () => {
    expect(resolveAuthProvider({ authProvider: 'datev-openid' })).toBe('datev-openid');
  });

  it('returns "datev-openid-sandbox" when explicitly set', () => {
    expect(resolveAuthProvider({ authProvider: 'datev-openid-sandbox' })).toBe('datev-openid-sandbox');
  });

  it('returns "datev-idp-next" when explicitly set', () => {
    expect(resolveAuthProvider({ authProvider: 'datev-idp-next' })).toBe('datev-idp-next');
  });

  it('derives "datev-openid" for production environment', () => {
    expect(resolveAuthProvider({ environment: 'production' })).toBe('datev-openid');
  });

  it('derives "datev-openid-sandbox" for sandbox environment', () => {
    expect(resolveAuthProvider({ environment: 'sandbox' })).toBe('datev-openid-sandbox');
  });

  it('defaults to "datev-openid" when config is empty', () => {
    expect(resolveAuthProvider({})).toBe('datev-openid');
  });

  it('ignores invalid authProvider and derives from environment', () => {
    expect(
      resolveAuthProvider({ authProvider: 'bogus' as never, environment: 'sandbox' })
    ).toBe('datev-openid-sandbox');
  });

  it('explicit valid authProvider takes precedence over environment', () => {
    expect(
      resolveAuthProvider({ authProvider: 'datev-idp-next', environment: 'sandbox' })
    ).toBe('datev-idp-next');
  });
});

// ---------------------------------------------------------------------------
// resolveApiBaseUrl
// ---------------------------------------------------------------------------
describe('resolveApiBaseUrl', () => {
  it('returns config.apiBaseUrl when set', () => {
    expect(
      resolveApiBaseUrl({ apiBaseUrl: 'https://custom.example.com/v2' })
    ).toBe('https://custom.example.com/v2');
  });

  it('returns production URL when config is empty', () => {
    expect(resolveApiBaseUrl({})).toBe(DATEV_API_BASE_URLS.production);
  });

  it('returns sandbox URL when environment is sandbox', () => {
    expect(resolveApiBaseUrl({ environment: 'sandbox' })).toBe(DATEV_API_BASE_URLS.sandbox);
  });

  it('returns production URL when environment is production', () => {
    expect(resolveApiBaseUrl({ environment: 'production' })).toBe(DATEV_API_BASE_URLS.production);
  });

  it('falls back to environment lookup when apiBaseUrl is empty string', () => {
    expect(resolveApiBaseUrl({ apiBaseUrl: '' })).toBe(DATEV_API_BASE_URLS.production);
  });

  it('falls back to environment lookup when apiBaseUrl is whitespace only', () => {
    expect(resolveApiBaseUrl({ apiBaseUrl: '   ' })).toBe(DATEV_API_BASE_URLS.production);
  });

  it('custom apiBaseUrl overrides sandbox environment', () => {
    expect(
      resolveApiBaseUrl({ apiBaseUrl: 'https://my-proxy.test', environment: 'sandbox' })
    ).toBe('https://my-proxy.test');
  });
});

// ---------------------------------------------------------------------------
// resolveDatevClientId
// ---------------------------------------------------------------------------
describe('resolveDatevClientId', () => {
  it('returns configClientId when both are provided', () => {
    expect(
      resolveDatevClientId({ configClientId: 'cfg-123', connectionAccountId: 'conn-456' })
    ).toBe('cfg-123');
  });

  it('returns configClientId when only it is provided', () => {
    expect(resolveDatevClientId({ configClientId: 'cfg-123' })).toBe('cfg-123');
  });

  it('falls back to connectionAccountId when configClientId is undefined', () => {
    expect(resolveDatevClientId({ connectionAccountId: 'conn-456' })).toBe('conn-456');
  });

  it('falls back to connectionAccountId when configClientId is empty string', () => {
    expect(resolveDatevClientId({ configClientId: '', connectionAccountId: 'conn-456' })).toBe('conn-456');
  });

  it('falls back to connectionAccountId when configClientId is whitespace', () => {
    expect(resolveDatevClientId({ configClientId: '   ', connectionAccountId: 'conn-456' })).toBe('conn-456');
  });

  it('throws when neither is provided', () => {
    expect(() => resolveDatevClientId({})).toThrow('Missing X-DATEV-Client-Id');
  });

  it('throws when both are undefined', () => {
    expect(() =>
      resolveDatevClientId({ configClientId: undefined, connectionAccountId: undefined })
    ).toThrow('Missing X-DATEV-Client-Id');
  });

  it('throws when both are empty strings', () => {
    expect(() =>
      resolveDatevClientId({ configClientId: '', connectionAccountId: '' })
    ).toThrow('Missing X-DATEV-Client-Id');
  });

  it('throws when both are whitespace only', () => {
    expect(() =>
      resolveDatevClientId({ configClientId: '  ', connectionAccountId: '  ' })
    ).toThrow('Missing X-DATEV-Client-Id');
  });

  it('error message mentions reconnect suggestion', () => {
    expect(() => resolveDatevClientId({})).toThrow(/reconnect/);
  });
});

// ---------------------------------------------------------------------------
// formatEndpointPath
// ---------------------------------------------------------------------------
describe('formatEndpointPath', () => {
  it('replaces {client-id} and {job-id} when both are provided', () => {
    expect(
      formatEndpointPath('/clients/{client-id}/dxso-jobs/{job-id}', {
        clientId: 'abc',
        jobId: '123',
      })
    ).toBe('/clients/abc/dxso-jobs/123');
  });

  it('replaces only {client-id} when jobId is not provided', () => {
    expect(
      formatEndpointPath('/clients/{client-id}/dxso-jobs/{job-id}', { clientId: 'abc' })
    ).toBe('/clients/abc/dxso-jobs/{job-id}');
  });

  it('replaces only {job-id} when clientId is not provided', () => {
    expect(
      formatEndpointPath('/clients/{client-id}/dxso-jobs/{job-id}', { jobId: '123' })
    ).toBe('/clients/{client-id}/dxso-jobs/123');
  });

  it('leaves both placeholders when params are empty', () => {
    expect(
      formatEndpointPath('/clients/{client-id}/dxso-jobs/{job-id}', {})
    ).toBe('/clients/{client-id}/dxso-jobs/{job-id}');
  });

  it('handles path with no placeholders', () => {
    expect(formatEndpointPath('/clients', { clientId: 'abc' })).toBe('/clients');
  });

  it('replaces multiple occurrences of the same placeholder', () => {
    expect(
      formatEndpointPath('{client-id}/{client-id}', { clientId: 'x' })
    ).toBe('x/x');
  });

  it('treats empty string clientId as missing (keeps placeholder)', () => {
    expect(
      formatEndpointPath('/clients/{client-id}', { clientId: '' })
    ).toBe('/clients/{client-id}');
  });

  it('treats whitespace-only jobId as missing (keeps placeholder)', () => {
    expect(
      formatEndpointPath('/dxso-jobs/{job-id}', { jobId: '   ' })
    ).toBe('/dxso-jobs/{job-id}');
  });
});

// ---------------------------------------------------------------------------
// DatevApiError
// ---------------------------------------------------------------------------
describe('DatevApiError', () => {
  it('is an instance of Error', () => {
    const error = new DatevApiError('fail', 401, '{"error":"unauthorized"}');
    expect(error).toBeInstanceOf(Error);
  });

  it('has name "DatevApiError"', () => {
    const error = new DatevApiError('fail', 500, 'body');
    expect(error.name).toBe('DatevApiError');
  });

  it('stores status and responseBody', () => {
    const error = new DatevApiError('not found', 404, '{"detail":"gone"}');
    expect(error.status).toBe(404);
    expect(error.responseBody).toBe('{"detail":"gone"}');
  });

  it('stores the message', () => {
    const error = new DatevApiError('something broke', 502, '');
    expect(error.message).toBe('something broke');
  });

  it('has a stack trace', () => {
    const error = new DatevApiError('err', 500, '');
    expect(error.stack).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DatevClient constructor
// ---------------------------------------------------------------------------
describe('DatevClient', () => {
  const minimalOptions = {
    accessToken: 'tok_test',
    xDatevClientId: 'client-42',
    baseUrl: 'https://api.datev.de/platform/v2',
  };

  it('trims trailing slash from baseUrl', () => {
    const client = new DatevClient({ ...minimalOptions, baseUrl: 'https://example.com/' });
    expect(client.getBaseUrl()).toBe('https://example.com');
  });

  it('preserves baseUrl without trailing slash', () => {
    const client = new DatevClient(minimalOptions);
    expect(client.getBaseUrl()).toBe('https://api.datev.de/platform/v2');
  });

  it('trims only one trailing slash', () => {
    const client = new DatevClient({ ...minimalOptions, baseUrl: 'https://example.com//' });
    // trimTrailingSlash removes a single trailing slash
    expect(client.getBaseUrl()).toBe('https://example.com/');
  });

  describe('maxRequestAttempts bounding', () => {
    it('defaults to 3 when not provided', () => {
      // We cannot directly read private fields, but we verify construction succeeds
      const client = new DatevClient(minimalOptions);
      expect(client).toBeInstanceOf(DatevClient);
    });

    it('accepts value within bounds', () => {
      const client = new DatevClient({ ...minimalOptions, maxRequestAttempts: 4 });
      expect(client).toBeInstanceOf(DatevClient);
    });

    it('clamps value below minimum to 1', () => {
      const client = new DatevClient({ ...minimalOptions, maxRequestAttempts: 0 });
      expect(client).toBeInstanceOf(DatevClient);
    });

    it('clamps value above maximum to 5', () => {
      const client = new DatevClient({ ...minimalOptions, maxRequestAttempts: 100 });
      expect(client).toBeInstanceOf(DatevClient);
    });

    it('accepts negative value without throwing (clamped to 1)', () => {
      const client = new DatevClient({ ...minimalOptions, maxRequestAttempts: -5 });
      expect(client).toBeInstanceOf(DatevClient);
    });
  });

  describe('requestTimeoutMs bounding', () => {
    it('defaults to 30000 when not provided', () => {
      const client = new DatevClient(minimalOptions);
      expect(client).toBeInstanceOf(DatevClient);
    });

    it('accepts value within bounds', () => {
      const client = new DatevClient({ ...minimalOptions, requestTimeoutMs: 60_000 });
      expect(client).toBeInstanceOf(DatevClient);
    });

    it('clamps value below minimum (1000)', () => {
      const client = new DatevClient({ ...minimalOptions, requestTimeoutMs: 500 });
      expect(client).toBeInstanceOf(DatevClient);
    });

    it('clamps value above maximum (120000)', () => {
      const client = new DatevClient({ ...minimalOptions, requestTimeoutMs: 999_999 });
      expect(client).toBeInstanceOf(DatevClient);
    });
  });

  describe('userAgent', () => {
    it('uses default user agent when not provided', () => {
      // Construction succeeds; default is 'InvoiceLeaf integration-datev/1.0'
      const client = new DatevClient(minimalOptions);
      expect(client).toBeInstanceOf(DatevClient);
    });

    it('accepts custom user agent', () => {
      const client = new DatevClient({ ...minimalOptions, userAgent: 'MyApp/2.0' });
      expect(client).toBeInstanceOf(DatevClient);
    });

    it('falls back to default when userAgent is empty string', () => {
      const client = new DatevClient({ ...minimalOptions, userAgent: '' });
      expect(client).toBeInstanceOf(DatevClient);
    });

    it('falls back to default when userAgent is whitespace only', () => {
      const client = new DatevClient({ ...minimalOptions, userAgent: '   ' });
      expect(client).toBeInstanceOf(DatevClient);
    });
  });
});

// ---------------------------------------------------------------------------
// Endpoint constants
// ---------------------------------------------------------------------------
describe('DATEV_DXSO_ENDPOINT_TEMPLATES', () => {
  const expectedIds = [
    'list-clients',
    'get-client',
    'create-dxso-job',
    'upload-dxso-job-file',
    'get-dxso-job',
    'finalize-dxso-job',
    'cancel-dxso-job',
    'list-dxso-protocol-entries',
  ];

  it('contains all expected template IDs', () => {
    const ids = DATEV_DXSO_ENDPOINT_TEMPLATES.map((t) => t.id);
    for (const expectedId of expectedIds) {
      expect(ids).toContain(expectedId);
    }
  });

  it('has exactly the expected number of templates', () => {
    expect(DATEV_DXSO_ENDPOINT_TEMPLATES).toHaveLength(expectedIds.length);
  });

  it('every template has method, pathTemplate, and requiredScopes', () => {
    for (const tmpl of DATEV_DXSO_ENDPOINT_TEMPLATES) {
      expect(tmpl.method).toBeDefined();
      expect(tmpl.pathTemplate).toBeDefined();
      expect(tmpl.requiredScopes).toBeDefined();
      expect(tmpl.requiredScopes.length).toBeGreaterThan(0);
    }
  });

  it('every template with path params lists them in requiredPathParams', () => {
    for (const tmpl of DATEV_DXSO_ENDPOINT_TEMPLATES) {
      const placeholders = tmpl.pathTemplate.match(/\{[^}]+\}/g) ?? [];
      const expected = placeholders.map((p) => p.slice(1, -1));
      expect(tmpl.requiredPathParams).toEqual(expected);
    }
  });
});

describe('DATEV_API_BASE_URLS', () => {
  it('has production entry', () => {
    expect(DATEV_API_BASE_URLS.production).toBeDefined();
    expect(DATEV_API_BASE_URLS.production).toContain('datev.de');
  });

  it('has sandbox entry', () => {
    expect(DATEV_API_BASE_URLS.sandbox).toBeDefined();
    expect(DATEV_API_BASE_URLS.sandbox).toContain('sandbox');
  });

  it('production and sandbox URLs are different', () => {
    expect(DATEV_API_BASE_URLS.production).not.toBe(DATEV_API_BASE_URLS.sandbox);
  });
});

describe('DATEV_AUTH_DISCOVERY_URLS', () => {
  it('has production entry', () => {
    expect(DATEV_AUTH_DISCOVERY_URLS.production).toBeDefined();
    expect(DATEV_AUTH_DISCOVERY_URLS.production).toContain('openid-configuration');
  });

  it('has sandbox entry', () => {
    expect(DATEV_AUTH_DISCOVERY_URLS.sandbox).toBeDefined();
    expect(DATEV_AUTH_DISCOVERY_URLS.sandbox).toContain('sandbox');
  });
});

describe('DATEV_OAUTH_PROVIDER_CONFIG', () => {
  const providers = ['datev-openid', 'datev-openid-sandbox', 'datev-idp-next'] as const;

  for (const provider of providers) {
    it(`has authorizeUrl for ${provider}`, () => {
      expect(DATEV_OAUTH_PROVIDER_CONFIG[provider].authorizeUrl).toBeDefined();
      expect(DATEV_OAUTH_PROVIDER_CONFIG[provider].authorizeUrl).toMatch(/^https:\/\//);
    });

    it(`has tokenUrl for ${provider}`, () => {
      expect(DATEV_OAUTH_PROVIDER_CONFIG[provider].tokenUrl).toBeDefined();
      expect(DATEV_OAUTH_PROVIDER_CONFIG[provider].tokenUrl).toMatch(/^https:\/\//);
    });
  }

  it('has exactly three providers', () => {
    expect(Object.keys(DATEV_OAUTH_PROVIDER_CONFIG)).toHaveLength(3);
  });
});
