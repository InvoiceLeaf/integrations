import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import type { TestConnectionResult, ZohoIntegrationConfig } from '../types.js';
import { testConnection } from '../handlers/testConnection.js';
import { ZohoBooksApiError } from '../zoho/client.js';
import { createMockContext, mockFetch, jsonResponse, errorResponse } from './helpers.js';

beforeEach(() => {
  mockFetch.mockReset();
});

describe('testConnection handler', () => {
  it('returns not-connected when credential is not linked', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.credentials.getConnectionInfo).mockResolvedValue({
      connected: false,
      provider: 'zoho-books',
    });

    const result: TestConnectionResult = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('not connected');
    // Should not attempt to fetch organizations
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns error when no organizations returned', async () => {
    const ctx = createMockContext();
    mockFetch.mockResolvedValueOnce(jsonResponse({ code: 0, organizations: [] }));

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('No Zoho organizations');
  });

  it('succeeds with single org and returns organizationId and organizationName', async () => {
    const ctx = createMockContext();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        code: 0,
        organizations: [{ organization_id: 'org-1', name: 'Acme Corp' }],
      })
    );

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.organizationId).toBe('org-1');
    expect(result.organizationName).toBe('Acme Corp');
    expect(result.availableOrganizations).toEqual([
      { organizationId: 'org-1', organizationName: 'Acme Corp' },
    ]);
    expect(result.message).toContain('valid');
  });

  it('selects preferred org from config.organizationId', async () => {
    const ctx = createMockContext({ organizationId: 'org-2' });
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        code: 0,
        organizations: [
          { organization_id: 'org-1', name: 'First Org' },
          { organization_id: 'org-2', name: 'Second Org' },
        ],
      })
    );

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(true);
    expect(result.organizationId).toBe('org-2');
    expect(result.organizationName).toBe('Second Org');
    expect(result.availableOrganizations).toHaveLength(2);
  });

  it('fails when configured org is not found', async () => {
    const ctx = createMockContext({ organizationId: 'missing-org' });
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        code: 0,
        organizations: [{ organization_id: 'org-1', name: 'Only Org' }],
      })
    );

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('Connection test failed');
  });

  it('handles ZohoBooksApiError', async () => {
    const ctx = createMockContext();
    mockFetch.mockResolvedValueOnce(errorResponse(401, 'Invalid token'));

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toContain('Zoho API error');
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

  it('truncates long error bodies in ZohoBooksApiError responses', async () => {
    const ctx = createMockContext();
    const longBody = 'x'.repeat(500);
    mockFetch.mockResolvedValueOnce(errorResponse(400, longBody));

    const result = await testConnection({}, ctx);

    expect(result.success).toBe(false);
    if (result.error) {
      expect(result.error.length).toBeLessThan(400);
    }
  });
});
