import { describe, it, expect } from 'vitest';
import { escapeWhereValue, selectXeroTenant, XeroApiError } from './client';
import type { XeroConnection } from './client';

describe('escapeWhereValue', () => {
  it('returns plain strings unchanged', () => {
    expect(escapeWhereValue('hello')).toBe('hello');
  });

  it('escapes double quotes', () => {
    expect(escapeWhereValue('say "hi"')).toBe('say \\"hi\\"');
  });

  it('escapes backslashes', () => {
    expect(escapeWhereValue('path\\to')).toBe('path\\\\to');
  });

  it('escapes backslashes before quotes to prevent injection via \\"', () => {
    // A backslash-quote sequence like \" should NOT allow breaking out of the string.
    // If quotes were escaped first (producing \"), then backslashes escaped (producing \\"),
    // the trailing quote would be unescaped — injection.
    // Correct order: backslashes first, then quotes.
    // Input:  foo\"bar  (backslash then quote)
    // Step 1 (backslashes): foo\\"bar
    // Step 2 (quotes):      foo\\\\"bar  — both chars escaped, no injection
    expect(escapeWhereValue('foo\\"bar')).toBe('foo\\\\\\"bar');
  });

  it('handles multiple backslash-quote sequences', () => {
    expect(escapeWhereValue('\\"A\\" OR 1==1')).toBe('\\\\\\"A\\\\\\" OR 1==1');
  });

  it('handles empty string', () => {
    expect(escapeWhereValue('')).toBe('');
  });

  it('handles string with only special characters', () => {
    expect(escapeWhereValue('\\"\\\\"')).toBe('\\\\\\"\\\\\\\\\\"');
  });

  it('strips null bytes and control characters', () => {
    expect(escapeWhereValue('a\x00b\x01c\x1fd')).toBe('abcd');
    expect(escapeWhereValue('\x7fhidden')).toBe('hidden');
  });

  it('replaces tabs and newlines with spaces', () => {
    expect(escapeWhereValue('line1\nline2')).toBe('line1 line2');
    expect(escapeWhereValue('col1\tcol2')).toBe('col1 col2');
    expect(escapeWhereValue('a\r\nb')).toBe('a  b');
  });

  it('escapes single quotes', () => {
    expect(escapeWhereValue("it's")).toBe("it\\'s");
    expect(escapeWhereValue("'quoted'")).toBe("\\'quoted\\'");
  });
});

describe('selectXeroTenant', () => {
  const tenantA: XeroConnection = {
    id: 'conn-a',
    tenantId: 'tenant-a',
    tenantName: 'Tenant A',
  };
  const tenantB: XeroConnection = {
    id: 'conn-b',
    tenantId: 'tenant-b',
    tenantName: 'Tenant B',
    tenantType: 'ORGANISATION',
  };

  it('returns the only connection when there is exactly one', () => {
    expect(selectXeroTenant([tenantA])).toBe(tenantA);
  });

  it('returns the connection matching preferredTenantId', () => {
    expect(selectXeroTenant([tenantA, tenantB], 'tenant-b')).toBe(tenantB);
  });

  it('returns a matching preferred tenant even with a single connection', () => {
    expect(selectXeroTenant([tenantA], 'tenant-a')).toBe(tenantA);
  });

  it('throws when preferredTenantId does not match any connection', () => {
    expect(() => selectXeroTenant([tenantA, tenantB], 'tenant-missing')).toThrow(
      /Configured tenant "tenant-missing" was not found/
    );
  });

  it('throws when multiple connections exist and no preferredTenantId is provided', () => {
    expect(() => selectXeroTenant([tenantA, tenantB])).toThrow(
      /Multiple Xero tenants are connected/
    );
  });
});

describe('XeroApiError', () => {
  it('creates an error with status and responseBody', () => {
    const error = new XeroApiError('Something went wrong', 422, '{"message":"Validation failed"}');
    expect(error.message).toBe('Something went wrong');
    expect(error.status).toBe(422);
    expect(error.responseBody).toBe('{"message":"Validation failed"}');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(XeroApiError);
  });

  it('has the correct name property', () => {
    const error = new XeroApiError('Not found', 404, '');
    expect(error.name).toBe('XeroApiError');
  });
});
