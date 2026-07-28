import { beforeEach, describe, expect, it } from 'vitest';
import { testConnection } from '../handlers/testConnection.js';
import { createMockContext, invoiceList, jsonResponse, mockFetch, tokenResponse, transactionList } from './helpers.js';

function installFetch(options: { tokenStatus?: number; transactionsStatus?: number } = {}): void {
  mockFetch.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/v1/oauth2/token')) {
      if (options.tokenStatus) {
        return jsonResponse({ error: 'invalid_client' }, options.tokenStatus);
      }
      return tokenResponse();
    }
    if (url.includes('/v1/reporting/transactions')) {
      if (options.transactionsStatus) {
        return jsonResponse({ name: 'NOT_AUTHORIZED' }, options.transactionsStatus);
      }
      return transactionList([]);
    }
    if (url.includes('/v2/invoicing/invoices')) {
      return invoiceList([]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe('testConnection', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('verifies token, invoices, and transaction search', async () => {
    const context = createMockContext();
    installFetch();

    const result = await testConnection({}, context);

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        tokenOk: true,
        invoicesReadable: true,
        transactionSearchAvailable: true,
      })
    );
  });

  it('stays successful when only the transaction search is unavailable', async () => {
    const context = createMockContext();
    installFetch({ transactionsStatus: 403 });

    const result = await testConnection({}, context);

    expect(result.success).toBe(true);
    expect(result.transactionSearchAvailable).toBe(false);
    expect(result.message).toContain('Transaction Search');
  });

  it('fails when the credentials are rejected', async () => {
    const context = createMockContext();
    installFetch({ tokenStatus: 401 });

    const result = await testConnection({}, context);

    expect(result.success).toBe(false);
    expect(result.tokenOk).toBe(false);
    expect(result.invoicesReadable).toBe(false);
    expect(result.error).toContain('OAuth token');
  });

  it('fails when the Client ID is not configured', async () => {
    const context = createMockContext({ clientId: '' });
    installFetch();

    const result = await testConnection({}, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Client ID');
  });
});
