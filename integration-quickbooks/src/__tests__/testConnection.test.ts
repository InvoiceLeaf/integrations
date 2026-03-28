import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import type { QuickBooksIntegrationConfig, TestConnectionResult } from '../types.js';
import { testConnection } from '../handlers/testConnection.js';
import { QuickBooksApiError } from '../quickbooks/client.js';

// Stub global fetch so the underlying client calls are interceptable
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): object {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    text: vi.fn().mockResolvedValue(text),
    arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(text).buffer),
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

function createMockContext(
  configOverrides: Partial<QuickBooksIntegrationConfig> = {},
  credentialOverrides: Partial<{
    connected: boolean;
    accountId: string;
    getAccessToken: string;
  }> = {}
): IntegrationContext<QuickBooksIntegrationConfig> {
  const connected = credentialOverrides.connected ?? true;
  const accountId = credentialOverrides.accountId ?? 'realm-from-cred';
  const accessToken = credentialOverrides.getAccessToken ?? 'test-access-token';

  return {
    spaceId: 'space-1',
    userId: 'user-1',
    installationId: 'install-1',
    config: configOverrides,
    data: {
      listDocuments: vi.fn(),
      getDocument: vi.fn(),
      getDocumentFile: vi.fn(),
      listCompanies: vi.fn(),
      getCompany: vi.fn(),
      listCategories: vi.fn(),
      getCategory: vi.fn(),
      getTag: vi.fn(),
      listTags: vi.fn(),
      createExport: vi.fn(),
      getExport: vi.fn(),
      importDocument: vi.fn(),
      patchDocumentIntegrationMeta: vi.fn(),
    },
    credentials: {
      getAccessToken: vi.fn().mockResolvedValue(accessToken),
      getApiKey: vi.fn(),
      refreshToken: vi.fn(),
      getConnectionInfo: vi.fn().mockResolvedValue({
        connected,
        provider: 'quickbooks',
        accountId,
      }),
    },
    mappings: {
      get: vi.fn(),
      findByExternal: vi.fn(),
      upsert: vi.fn(),
    },
    state: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    },
    email: {
      sendSmtpEmail: vi.fn(),
      testSmtpImapConnection: vi.fn(),
      crawlImapPdfAttachments: vi.fn(),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('testConnection handler', () => {
  it('returns not-connected when credential is not linked', async () => {
    const ctx = createMockContext({}, { connected: false });

    const result: TestConnectionResult = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('not connected');
  });

  it('succeeds when connection is valid, returns realmId and companyName', async () => {
    const ctx = createMockContext({}, { accountId: 'realm-456' });

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ CompanyInfo: { CompanyName: 'Acme Inc', LegalName: 'Acme Inc LLC' } })
    );

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.realmId).toBe('realm-456');
    expect(result.companyName).toBe('Acme Inc');
    expect(result.legalName).toBe('Acme Inc LLC');
  });

  it('uses config.realmId when set, falls back to connectionInfo.accountId', async () => {
    const ctx = createMockContext(
      { realmId: 'config-realm' },
      { accountId: 'cred-realm' }
    );

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ CompanyInfo: { CompanyName: 'Config Co' } })
    );

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(true);
    expect(result.realmId).toBe('config-realm');
  });

  it('falls back to connectionInfo.accountId when config.realmId is not set', async () => {
    const ctx = createMockContext({}, { accountId: 'fallback-realm' });

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ CompanyInfo: { CompanyName: 'Fallback Co' } })
    );

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(true);
    expect(result.realmId).toBe('fallback-realm');
  });

  it('handles QuickBooksApiError from API', async () => {
    const ctx = createMockContext();
    mockFetch.mockResolvedValueOnce(errorResponse(401, 'Invalid token'));

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('QuickBooks API error');
    expect(result.error).toContain('401');
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('handles generic errors', async () => {
    const ctx = createMockContext();
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('Connection test failed');
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('truncates long error bodies', async () => {
    const ctx = createMockContext();
    const longBody = 'x'.repeat(500);
    mockFetch.mockResolvedValueOnce(errorResponse(400, longBody));

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    // The body should be truncated to 280 characters (277 + "...")
    if (result.error) {
      expect(result.error.length).toBeLessThan(400);
    }
  });
});
