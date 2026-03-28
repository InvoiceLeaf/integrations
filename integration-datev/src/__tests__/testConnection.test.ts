import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testConnection } from '../handlers/testConnection.js';
import { createMockContext } from './helpers.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonFetchResponse(body: unknown, status = 200): object {
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

beforeEach(() => {
  mockFetch.mockReset();
});

describe('testConnection', () => {
  it('returns connected=true when listClients succeeds', async () => {
    const clients = [
      { id: '455148-1', name: 'Client A' },
      { id: '455148-2', name: 'Client B' },
    ];
    mockFetch.mockResolvedValueOnce(jsonFetchResponse(clients));

    const ctx = createMockContext();
    const result = await testConnection({}, ctx);

    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.clientCount).toBe(2);
    expect(result.sampleClients).toEqual(clients);
    expect(result.environment).toBe('sandbox');
    expect(result.authProvider).toBe('datev-openid-sandbox');
    expect(result.message).toContain('2 accessible client(s)');
  });

  it('limits sampleClients to 10', async () => {
    const clients = Array.from({ length: 15 }, (_, i) => ({ id: `client-${i}`, name: `Client ${i}` }));
    mockFetch.mockResolvedValueOnce(jsonFetchResponse(clients));

    const ctx = createMockContext();
    const result = await testConnection({}, ctx);

    expect(result.success).toBe(true);
    expect(result.clientCount).toBe(15);
    expect(result.sampleClients?.length).toBe(10);
  });

  it('returns connected=false on DatevApiError', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('{"error":"invalid_token"}'),
      arrayBuffer: vi.fn().mockResolvedValue(
        new TextEncoder().encode('{"error":"invalid_token"}').buffer
      ),
    });

    const ctx = createMockContext();
    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('DATEV API error (401)');
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('returns connected=false on non-API error', async () => {
    const ctx = createMockContext({}, {
      credentials: {
        getAccessToken: vi.fn(),
        getApiKey: vi.fn(),
        refreshToken: vi.fn(),
        getConnectionInfo: vi.fn().mockRejectedValue(new Error('Network failure')),
      },
    });

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('Network failure');
  });

  it('returns connected=false when auth provider is not connected', async () => {
    const ctx = createMockContext({}, {
      credentials: {
        getAccessToken: vi.fn(),
        getApiKey: vi.fn(),
        refreshToken: vi.fn(),
        getConnectionInfo: vi.fn().mockResolvedValue({
          connected: false,
          provider: 'datev-openid-sandbox',
        }),
      },
    });

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('is not connected');
  });
});
