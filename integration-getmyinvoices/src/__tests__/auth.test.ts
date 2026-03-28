import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveGetMyInvoicesApiKey } from '../handlers/auth.js';
import { createMockContext } from './helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('resolveGetMyInvoicesApiKey', () => {
  it('returns trimmed API key from credentials', async () => {
    const context = createMockContext();
    vi.mocked(context.credentials.getApiKey).mockResolvedValue('  my-api-key  ');

    const result = await resolveGetMyInvoicesApiKey(context);

    expect(result).toBe('my-api-key');
    expect(context.credentials.getApiKey).toHaveBeenCalledWith('getmyinvoices');
  });

  it('throws when API key is empty', async () => {
    const context = createMockContext();
    vi.mocked(context.credentials.getApiKey).mockResolvedValue('');

    await expect(resolveGetMyInvoicesApiKey(context)).rejects.toThrow(
      'GetMyInvoices API key is missing'
    );
  });

  it('throws when API key is whitespace only', async () => {
    const context = createMockContext();
    vi.mocked(context.credentials.getApiKey).mockResolvedValue('   ');

    await expect(resolveGetMyInvoicesApiKey(context)).rejects.toThrow(
      'GetMyInvoices API key is missing'
    );
  });

  it('propagates errors from credentials client', async () => {
    const context = createMockContext();
    vi.mocked(context.credentials.getApiKey).mockRejectedValue(new Error('Credential store unavailable'));

    await expect(resolveGetMyInvoicesApiKey(context)).rejects.toThrow(
      'Credential store unavailable'
    );
  });
});
