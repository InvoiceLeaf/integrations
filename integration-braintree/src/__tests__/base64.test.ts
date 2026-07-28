import { describe, expect, it } from 'vitest';
import { basicAuthHeader, encodeBase64 } from '../braintree/base64.js';

describe('encodeBase64', () => {
  it('matches the RFC 4648 test vectors', () => {
    expect(encodeBase64('')).toBe('');
    expect(encodeBase64('f')).toBe('Zg==');
    expect(encodeBase64('fo')).toBe('Zm8=');
    expect(encodeBase64('foo')).toBe('Zm9v');
    expect(encodeBase64('foob')).toBe('Zm9vYg==');
    expect(encodeBase64('fooba')).toBe('Zm9vYmE=');
    expect(encodeBase64('foobar')).toBe('Zm9vYmFy');
  });

  it('encodes public:private key pairs', () => {
    expect(encodeBase64('publicKey:privateKey')).toBe('cHVibGljS2V5OnByaXZhdGVLZXk=');
    expect(encodeBase64('nx4h9k2m3w5q7r8t:c8e2f5a1b3d4e6f7a9b0c1d2e3f4a5b6')).toBe(
      'bng0aDlrMm0zdzVxN3I4dDpjOGUyZjVhMWIzZDRlNmY3YTliMGMxZDJlM2Y0YTViNg=='
    );
  });

  it('encodes multi-byte UTF-8 input', () => {
    expect(encodeBase64('ü')).toBe('w7w=');
    expect(encodeBase64('grüße:key')).toBe('Z3LDvMOfZTprZXk=');
  });
});

describe('basicAuthHeader', () => {
  it('builds a Basic auth header from public and private key', () => {
    expect(basicAuthHeader('publicKey', 'privateKey')).toBe('Basic cHVibGljS2V5OnByaXZhdGVLZXk=');
  });
});
