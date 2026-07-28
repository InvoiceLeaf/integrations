/**
 * Pure-JS base64 encoding for the Braintree Basic auth header.
 *
 * The plugin runtime isolate has no `Buffer`, no `btoa`, and no Node
 * builtins, so the encoder is implemented from scratch (RFC 4648, with
 * UTF-8 input encoding).
 */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (const char of input) {
    const codePoint = char.codePointAt(0)!;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return bytes;
}

/** Encode a string (UTF-8) as standard base64 with `=` padding. */
export function encodeBase64(input: string): string {
  const bytes = utf8Bytes(input);
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    output += BASE64_ALPHABET[b0 >> 2]!;
    output += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]!;
    output += b1 === undefined ? '=' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]!;
    output += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 0x3f]!;
  }
  return output;
}

/** Build the `Authorization` header value for Braintree API key auth. */
export function basicAuthHeader(publicKey: string, privateKey: string): string {
  return `Basic ${encodeBase64(`${publicKey}:${privateKey}`)}`;
}
