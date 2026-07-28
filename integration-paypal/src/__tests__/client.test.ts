import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenCache } from '../paypal/client.js';
import {
  OAUTH_TOKEN_STATE_KEY,
  PaypalClient,
  parseInvoiceIdFromHref,
  resolveBaseUrl,
  toPaypalTimestamp,
} from '../paypal/client.js';
import { invoiceList, jsonResponse, mockFetch, tokenResponse } from './helpers.js';

function createTokenCache(): TokenCache & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)) as TokenCache['get'],
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }) as TokenCache['set'],
  };
}

function createClient(tokenCache: TokenCache = createTokenCache()): PaypalClient {
  return new PaypalClient({
    clientId: 'client-id-1',
    clientSecret: 'client-secret-1',
    environment: 'sandbox',
    tokenCache,
  });
}

describe('PaypalClient OAuth', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('requests an OAuth token with a Basic authorization header', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(invoiceList([]));

    await client.listInvoices();

    const [tokenUrl, tokenInit] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(String(tokenUrl)).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    expect((tokenInit.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('client-id-1:client-secret-1', 'utf8').toString('base64')}`
    );
    expect((tokenInit.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(String(tokenInit.body)).toBe('grant_type=client_credentials');
  });

  it('caches the token and reuses it for subsequent calls', async () => {
    const cache = createTokenCache();
    const client = createClient(cache);
    mockFetch
      .mockResolvedValueOnce(tokenResponse('token-a'))
      .mockResolvedValueOnce(invoiceList([]))
      .mockResolvedValueOnce(invoiceList([]));

    await client.listInvoices();
    await client.listInvoices();

    const tokenCalls = mockFetch.mock.calls.filter((call) => String(call[0]).includes('/v1/oauth2/token'));
    expect(tokenCalls).toHaveLength(1);
    expect(cache.set).toHaveBeenCalledWith(
      OAUTH_TOKEN_STATE_KEY,
      expect.objectContaining({ accessToken: 'token-a', expiresAt: expect.any(Number) })
    );

    const secondListInit = mockFetch.mock.calls[2]![1] as RequestInit;
    expect((secondListInit.headers as Record<string, string>).Authorization).toBe('Bearer token-a');
  });

  it('refetches when the cached token is within the expiry margin', async () => {
    const cache = createTokenCache();
    cache.store.set(OAUTH_TOKEN_STATE_KEY, { accessToken: 'nearly-expired', expiresAt: Date.now() + 60_000 });
    const client = createClient(cache);
    mockFetch.mockResolvedValueOnce(tokenResponse('token-fresh')).mockResolvedValueOnce(invoiceList([]));

    await client.listInvoices();

    const tokenCalls = mockFetch.mock.calls.filter((call) => String(call[0]).includes('/v1/oauth2/token'));
    expect(tokenCalls).toHaveLength(1);
    const listInit = mockFetch.mock.calls[1]![1] as RequestInit;
    expect((listInit.headers as Record<string, string>).Authorization).toBe('Bearer token-fresh');
  });

  it('refreshes once and retries when an API call returns 401', async () => {
    const cache = createTokenCache();
    cache.store.set(OAUTH_TOKEN_STATE_KEY, { accessToken: 'revoked-token', expiresAt: Date.now() + 3_600_000 });
    const client = createClient(cache);
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_token' }, 401))
      .mockResolvedValueOnce(tokenResponse('token-fresh'))
      .mockResolvedValueOnce(invoiceList([]));

    const result = await client.listInvoices();

    expect(result.items).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const retryInit = mockFetch.mock.calls[2]![1] as RequestInit;
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer token-fresh');
  });

  it('parses the invoice id from a create response that only carries an href', async () => {
    const client = createClient();
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({ href: 'https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-HREF-1' }, 201)
      );

    const id = await client.createDraftInvoice({
      detail: { currency_code: 'EUR' },
      items: [{ name: 'Item', quantity: '1', unit_amount: { currency_code: 'EUR', value: '10.00' } }],
    });

    expect(id).toBe('INV2-HREF-1');
  });
});

describe('resolveBaseUrl', () => {
  it('defaults to the live endpoint', () => {
    expect(resolveBaseUrl(undefined)).toBe('https://api-m.paypal.com');
    expect(resolveBaseUrl('live')).toBe('https://api-m.paypal.com');
  });

  it('uses the sandbox endpoint when configured', () => {
    expect(resolveBaseUrl('sandbox')).toBe('https://api-m.sandbox.paypal.com');
    expect(resolveBaseUrl('  SANDBOX  ')).toBe('https://api-m.sandbox.paypal.com');
  });
});

describe('toPaypalTimestamp', () => {
  it('formats without fractional seconds', () => {
    expect(toPaypalTimestamp(Date.parse('2026-07-01T12:34:56.789Z'))).toBe('2026-07-01T12:34:56Z');
  });
});

describe('parseInvoiceIdFromHref', () => {
  it('extracts the id from an invoice href', () => {
    expect(parseInvoiceIdFromHref('https://api-m.paypal.com/v2/invoicing/invoices/INV2-ABCD-1234')).toBe(
      'INV2-ABCD-1234'
    );
  });

  it('returns undefined for missing or unrelated hrefs', () => {
    expect(parseInvoiceIdFromHref(undefined)).toBeUndefined();
    expect(parseInvoiceIdFromHref('https://api-m.paypal.com/v2/invoicing/templates/T1')).toBeUndefined();
  });
});
