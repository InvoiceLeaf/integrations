import { describe, expect, it } from 'vitest';
import { base64EncodeBytes, base64EncodeUtf8, utf8Bytes } from '../paypal/base64.js';

describe('base64EncodeUtf8', () => {
  it('matches the RFC 4648 test vectors', () => {
    expect(base64EncodeUtf8('')).toBe('');
    expect(base64EncodeUtf8('f')).toBe('Zg==');
    expect(base64EncodeUtf8('fo')).toBe('Zm8=');
    expect(base64EncodeUtf8('foo')).toBe('Zm9v');
    expect(base64EncodeUtf8('foob')).toBe('Zm9vYg==');
    expect(base64EncodeUtf8('fooba')).toBe('Zm9vYmE=');
    expect(base64EncodeUtf8('foobar')).toBe('Zm9vYmFy');
  });

  it('encodes a Basic auth pair exactly like Buffer', () => {
    const input = 'AbCdEf123:secret-XYZ_987';
    expect(base64EncodeUtf8(input)).toBe(Buffer.from(input, 'utf8').toString('base64'));
  });

  it('handles multi-byte UTF-8 characters like Buffer', () => {
    for (const input of ['héllo wörld', 'zażółć gęślą jaźń', '日本語テスト', 'emoji 🚀🔥']) {
      expect(base64EncodeUtf8(input)).toBe(Buffer.from(input, 'utf8').toString('base64'));
    }
  });
});

describe('utf8Bytes', () => {
  it('produces the same bytes as Buffer for mixed content', () => {
    const input = 'a-ü-€-👍';
    expect(utf8Bytes(input)).toEqual([...Buffer.from(input, 'utf8')]);
  });
});

describe('base64EncodeBytes', () => {
  it('encodes all byte values like Buffer', () => {
    const bytes = Array.from({ length: 256 }, (_, i) => i);
    expect(base64EncodeBytes(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('encodes pseudo-random byte sequences of every padding length like Buffer', () => {
    for (const length of [1, 2, 3, 4, 5, 31, 32, 33]) {
      const bytes = Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
      expect(base64EncodeBytes(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});
