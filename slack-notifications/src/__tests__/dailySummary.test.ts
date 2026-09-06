/**
 * Daily Summary Aggregation Tests
 *
 * The plugin runtime hands monetary fields to plugins as decimal strings
 * (see parseJsonPreservingMonetaryPrecision in the runtime), while the SDK
 * types them as numbers. Summing those strings with `+` used to concatenate
 * them, which rendered the daily summary total as NaN.
 */
import { describe, it, expect } from 'vitest';
import type { Document } from '@invoiceleaf/integration-sdk';
import { calculateStats } from '../handlers/dailySummary.js';
import { getNetTotal, getTotal, getVatTotal, toAmount } from '../types.js';
import { formatCurrency } from '../utils/formatters.js';

/** Builds a document the way the runtime delivers it: amounts as strings. */
function runtimeDocument(overrides: Record<string, unknown>): Document {
  return {
    id: `doc-${Math.random().toString(36).slice(2)}`,
    currency: { code: 'EUR' },
    ...overrides,
  } as unknown as Document;
}

describe('toAmount', () => {
  it('passes numbers through', () => {
    expect(toAmount(12.5)).toBe(12.5);
    expect(toAmount(0)).toBe(0);
  });

  it('parses decimal strings from the runtime', () => {
    expect(toAmount('12.50')).toBe(12.5);
    expect(toAmount('-3.1')).toBe(-3.1);
    expect(toAmount('1234567.89')).toBe(1234567.89);
  });

  it('returns undefined for missing or unparseable values', () => {
    expect(toAmount(undefined)).toBeUndefined();
    expect(toAmount(null)).toBeUndefined();
    expect(toAmount('')).toBeUndefined();
    expect(toAmount('n/a')).toBeUndefined();
    expect(toAmount(Number.NaN)).toBeUndefined();
  });
});

describe('document amount accessors', () => {
  it('coerce string amounts to numbers', () => {
    const doc = runtimeDocument({ totalAmount: '119.00', netAmount: '100.00', taxAmount: '19.00' });
    expect(getTotal(doc)).toBe(119);
    expect(getNetTotal(doc)).toBe(100);
    expect(getVatTotal(doc)).toBe(19);
  });

  it('still work with numeric amounts', () => {
    const doc = runtimeDocument({ totalAmount: 119, netAmount: 100, taxAmount: 19 });
    expect(getTotal(doc)).toBe(119);
    expect(getNetTotal(doc)).toBe(100);
    expect(getVatTotal(doc)).toBe(19);
  });
});

describe('calculateStats', () => {
  it('sums string amounts numerically instead of concatenating them', () => {
    const stats = calculateStats([
      runtimeDocument({ totalAmount: '12.50' }),
      runtimeDocument({ totalAmount: '34.90' }),
      runtimeDocument({ totalAmount: '100.00' }),
    ]);

    expect(stats.processedCount).toBe(3);
    expect(stats.totalAmount).toBeCloseTo(147.4, 2);
    expect(stats.currency).toBe('EUR');
    expect(Number.isNaN(stats.totalAmount)).toBe(false);
    expect(formatCurrency(stats.totalAmount, stats.currency)).toBe('€147.40');
  });

  it('treats documents without an amount as zero', () => {
    const stats = calculateStats([
      runtimeDocument({ totalAmount: '10.00' }),
      runtimeDocument({}),
      runtimeDocument({ totalAmount: null }),
    ]);

    expect(stats.processedCount).toBe(3);
    expect(stats.totalAmount).toBe(10);
  });

  it('reports the total for the most common currency', () => {
    const stats = calculateStats([
      runtimeDocument({ totalAmount: '10.00', currency: { code: 'USD' } }),
      runtimeDocument({ totalAmount: '20.00', currency: { code: 'USD' } }),
      runtimeDocument({ totalAmount: '999.00', currency: { code: 'EUR' } }),
    ]);

    expect(stats.currency).toBe('USD');
    expect(stats.totalAmount).toBe(30);
  });
});
