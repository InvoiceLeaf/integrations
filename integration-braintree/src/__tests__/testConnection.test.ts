import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testConnection } from '../handlers/testConnection.js';
import { createMockContext, graphqlResponse, jsonResponse, mockFetch, transactionsPage } from './helpers.js';

describe('testConnection', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('verifies ping and transaction search', async () => {
    const context = createMockContext();
    mockFetch
      .mockResolvedValueOnce(graphqlResponse({ ping: 'pong' }))
      .mockResolvedValueOnce(transactionsPage([]));

    const result = await testConnection({}, context);

    expect(result.success).toBe(true);
    expect(result.pingOk).toBe(true);
    expect(result.searchOk).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Braintree-Version']).toBe('2019-01-01');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });

  it('reports a ping failure from a GraphQL errors array', async () => {
    const context = createMockContext();
    mockFetch.mockResolvedValueOnce(
      graphqlResponse(null, [{ message: 'Authentication credentials are invalid' }])
    );

    const result = await testConnection({}, context);

    expect(result.success).toBe(false);
    expect(result.pingOk).toBe(false);
    expect(result.searchOk).toBe(false);
    expect(result.error).toContain('Authentication credentials are invalid');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('reports a failure when ping does not answer pong', async () => {
    const context = createMockContext();
    mockFetch.mockResolvedValueOnce(graphqlResponse({ ping: 'nope' }));

    const result = await testConnection({}, context);

    expect(result.success).toBe(false);
    expect(result.pingOk).toBe(false);
    expect(result.error).toContain('did not answer');
  });

  it('reports a search failure separately from ping', async () => {
    const context = createMockContext();
    mockFetch
      .mockResolvedValueOnce(graphqlResponse({ ping: 'pong' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403));

    const result = await testConnection({}, context);

    expect(result.success).toBe(false);
    expect(result.pingOk).toBe(true);
    expect(result.searchOk).toBe(false);
    expect(result.error).toContain('Transaction search');
  });

  it('fails with a clear error when the public key is not configured', async () => {
    const context = createMockContext({ publicKey: undefined });

    const result = await testConnection({}, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('public key is not configured');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails with a clear error when the merchant ID is not configured', async () => {
    const context = createMockContext({ merchantId: undefined });

    const result = await testConnection({}, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('merchant ID is not configured');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails with a clear error when the private key credential is missing', async () => {
    const context = createMockContext();
    (context.credentials.getApiKey as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('No api_key credential stored for provider braintree')
    );

    const result = await testConnection({}, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No api_key credential stored');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
