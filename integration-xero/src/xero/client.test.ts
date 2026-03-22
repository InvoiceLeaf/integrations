import { describe, it, expect } from 'vitest';
import { escapeWhereValue } from './client';

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
});
