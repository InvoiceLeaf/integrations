import { describe, expect, it } from 'vitest';
import { stripeAmountToDecimalString } from '../stripe/client.js';

describe('stripeAmountToDecimalString', () => {
  it('converts cent amounts to decimal strings', () => {
    expect(stripeAmountToDecimalString(12345, 'eur')).toBe('123.45');
    expect(stripeAmountToDecimalString(100, 'usd')).toBe('1.00');
    expect(stripeAmountToDecimalString(5, 'usd')).toBe('0.05');
    expect(stripeAmountToDecimalString(0, 'usd')).toBe('0.00');
  });

  it('keeps zero-decimal currencies unscaled', () => {
    expect(stripeAmountToDecimalString(1200, 'jpy')).toBe('1200');
    expect(stripeAmountToDecimalString(500, 'KRW')).toBe('500');
  });

  it('handles negative amounts', () => {
    expect(stripeAmountToDecimalString(-12345, 'eur')).toBe('-123.45');
  });

  it('rejects non-finite amounts', () => {
    expect(() => stripeAmountToDecimalString(Number.NaN, 'eur')).toThrow();
  });
});
