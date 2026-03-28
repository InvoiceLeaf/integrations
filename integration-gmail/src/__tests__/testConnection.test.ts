import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import type { GmailConfig, HandlerResult } from '../types.js';
import { testConnection } from '../handlers/testConnection.js';
import { GmailApiError } from '../gmail/client.js';

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
  configOverrides: Partial<GmailConfig> = {},
  credentialOverrides: Partial<{
    connected: boolean;
    getAccessToken: string;
  }> = {}
): IntegrationContext<GmailConfig> {
  const connected = credentialOverrides.connected ?? true;
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
        provider: 'gmail',
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
  it('returns not connected when credential is not linked', async () => {
    const ctx = createMockContext({}, { connected: false });

    const result: HandlerResult = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not connected');
  });

  it('succeeds with profile info', async () => {
    const ctx = createMockContext();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ emailAddress: 'user@gmail.com', messagesTotal: 100 })
    );

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('valid');
    expect(result.details).toEqual({
      emailAddress: 'user@gmail.com',
      messagesTotal: 100,
    });
  });

  it('handles GmailApiError', async () => {
    const ctx = createMockContext();
    mockFetch.mockResolvedValueOnce(errorResponse(401, 'Invalid credentials'));

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Gmail API error');
    expect(result.error).toContain('401');
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('handles generic errors', async () => {
    const ctx = createMockContext();
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection test failed');
    expect(ctx.logger.error).toHaveBeenCalled();
  });
});
