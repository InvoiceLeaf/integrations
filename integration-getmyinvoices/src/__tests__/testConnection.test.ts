import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testConnection } from '../handlers/testConnection.js';
import { createMockContext, mockFetch, jsonResponse, fakeResponse } from './helpers.js';

beforeEach(() => {
  mockFetch.mockReset();
});

describe('testConnection handler', () => {
  it('returns success with account info on valid API key', async () => {
    const context = createMockContext();
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ accountId: '42', email: 'user@example.com', organization: 'Acme', apiKeyType: 'full' })
      )
      .mockResolvedValueOnce(
        jsonResponse({ totalCount: 15, maxPages: 1, records: [] })
      );

    const result = await testConnection({} as never, context);

    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.accountId).toBe('42');
    expect(result.email).toBe('user@example.com');
    expect(result.organization).toBe('Acme');
    expect(result.apiKeyType).toBe('full');
    expect(result.message).toContain('15 document(s)');
  });

  it('returns failure when API key is missing', async () => {
    const context = createMockContext();
    vi.mocked(context.credentials.getApiKey).mockResolvedValue('');

    const result = await testConnection({} as never, context);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('API key is missing');
  });

  it('returns failure with API error details on HTTP error', async () => {
    const context = createMockContext();
    mockFetch.mockResolvedValueOnce(fakeResponse('{"error":"forbidden"}', 403));

    const result = await testConnection({} as never, context);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('403');
    expect(context.logger.error).toHaveBeenCalled();
  });

  it('returns failure with generic error on network failure', async () => {
    const context = createMockContext();
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await testConnection({} as never, context);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('fetch failed');
  });

  it('uses custom base URL from config', async () => {
    const context = createMockContext({ baseUrl: 'https://custom.api/v3' });
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ accountId: '1' }))
      .mockResolvedValueOnce(jsonResponse({ totalCount: 0, maxPages: 1, records: [] }));

    await testConnection({} as never, context);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('https://custom.api/v3');
  });

  it('truncates long error response bodies', async () => {
    const context = createMockContext();
    const longBody = 'x'.repeat(500);
    mockFetch.mockResolvedValueOnce(fakeResponse(longBody, 500));

    const result = await testConnection({} as never, context);

    expect(result.success).toBe(false);
    if (result.error) {
      // The truncation ensures the error message stays under a reasonable length.
      // The truncated body is 277 chars + "..."
      expect(result.error.length).toBeLessThan(400);
    }
  });
});
