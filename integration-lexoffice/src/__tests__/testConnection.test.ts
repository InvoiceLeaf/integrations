import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import type { LexofficeIntegrationConfig, TestConnectionResult } from '../types.js';
import { testConnection } from '../handlers/testConnection.js';
import { LexofficeApiError } from '../lexoffice/client.js';

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
  configOverrides: Partial<LexofficeIntegrationConfig> = {},
  credentialOverrides: Partial<{
    connected: boolean;
    getApiKey: string | null;
    getApiKeyThrows: boolean;
  }> = {}
): IntegrationContext<LexofficeIntegrationConfig> {
  const connected = credentialOverrides.connected ?? true;
  const apiKey = credentialOverrides.getApiKey ?? 'test-lexoffice-key';
  const getApiKeyThrows = credentialOverrides.getApiKeyThrows ?? false;

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
      getAccessToken: vi.fn(),
      getApiKey: getApiKeyThrows
        ? vi.fn().mockRejectedValue(new Error('No API key'))
        : vi.fn().mockResolvedValue(apiKey),
      refreshToken: vi.fn(),
      getConnectionInfo: vi.fn().mockResolvedValue({
        connected,
        provider: 'lexoffice',
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
  it('returns not connected when no credential and no config.apiKey', async () => {
    const ctx = createMockContext({}, { connected: false, getApiKey: null });

    const result: TestConnectionResult = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('not connected');
  });

  it('succeeds with valid connection and returns sampleContactId', async () => {
    const ctx = createMockContext();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ content: [{ id: 'contact-abc' }] })
    );

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.sampleContactId).toBe('contact-abc');
    expect(result.message).toContain('valid');
  });

  it('falls back to config.apiKey when credentials.getApiKey fails', async () => {
    const ctx = createMockContext(
      { apiKey: 'fallback-key' },
      { getApiKeyThrows: true }
    );
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ content: [{ id: 'contact-fallback' }] })
    );

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.sampleContactId).toBe('contact-fallback');

    // Verify the fallback key was used in the request
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer fallback-key'
    );
  });

  it('handles LexofficeApiError', async () => {
    const ctx = createMockContext();
    mockFetch.mockResolvedValueOnce(errorResponse(401, 'Invalid API key'));

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('lexoffice API error');
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
});
