import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import type { TestConnectionResult, XeroIntegrationConfig } from '../types.js';
import { testConnection } from '../handlers/testConnection.js';
import { XeroApiError } from '../xero/client.js';

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
  configOverrides: Partial<XeroIntegrationConfig> = {},
  credentialOverrides: Partial<{
    connected: boolean;
    accountId: string;
    getAccessToken: string;
  }> = {}
): IntegrationContext<XeroIntegrationConfig> {
  const connected = credentialOverrides.connected ?? true;
  const accountId = credentialOverrides.accountId ?? 'tenant-from-cred';
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
        provider: 'xero',
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
  it('returns not-connected when Xero credential is not linked', async () => {
    const ctx = createMockContext({}, { connected: false });

    const result: TestConnectionResult = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('not connected');
  });

  it('returns not-connected when Xero returns zero connections', async () => {
    const ctx = createMockContext();
    // listXeroConnections returns empty array
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('no tenant connections');
  });

  it('succeeds with single tenant and returns organisation name', async () => {
    const ctx = createMockContext({}, { accountId: 't1' });

    // listXeroConnections
    mockFetch.mockResolvedValueOnce(
      jsonResponse([{ id: 'c1', tenantId: 't1', tenantName: 'My Company' }])
    );
    // getOrganisationName
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ Organisations: [{ Name: 'My Company Ltd' }] })
    );

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.tenantId).toBe('t1');
    expect(result.tenantName).toBe('My Company');
    expect(result.organisationName).toBe('My Company Ltd');
    expect(result.availableTenants).toEqual([
      { tenantId: 't1', tenantName: 'My Company' },
    ]);
  });

  it('selects preferred tenant from config', async () => {
    const ctx = createMockContext({ xeroTenantId: 't2' });

    // listXeroConnections returns two tenants
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { id: 'c1', tenantId: 't1', tenantName: 'Tenant A' },
        { id: 'c2', tenantId: 't2', tenantName: 'Tenant B' },
      ])
    );
    // getOrganisationName
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ Organisations: [{ Name: 'Tenant B Org' }] })
    );

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(true);
    expect(result.tenantId).toBe('t2');
    expect(result.tenantName).toBe('Tenant B');
    expect(result.availableTenants).toHaveLength(2);
  });

  it('uses accountId from connectionInfo when xeroTenantId is not set', async () => {
    const ctx = createMockContext({}, { accountId: 't1' });

    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { id: 'c1', tenantId: 't1', tenantName: 'From Account' },
        { id: 'c2', tenantId: 't2', tenantName: 'Other' },
      ])
    );
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ Organisations: [{ Name: 'Org from Account' }] })
    );

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(true);
    expect(result.tenantId).toBe('t1');
  });

  it('fails when preferred tenant is not found among connections', async () => {
    const ctx = createMockContext({ xeroTenantId: 'missing-tenant' });

    mockFetch.mockResolvedValueOnce(
      jsonResponse([{ id: 'c1', tenantId: 't1', tenantName: 'Only Tenant' }])
    );

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('Connection test failed');
  });

  it('handles XeroApiError from connections endpoint', async () => {
    const ctx = createMockContext();
    mockFetch.mockResolvedValueOnce(errorResponse(401, 'Invalid token'));

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('Xero API error');
    expect(result.error).toContain('401');
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('handles generic errors gracefully', async () => {
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
    // The body should be truncated to 280 characters
    if (result.error) {
      expect(result.error.length).toBeLessThan(400);
    }
  });
});
