/**
 * Pure-JS base64 encoding.
 *
 * Plugin code runs in an isolated-vm sandbox without `Buffer` or `btoa`,
 * so the OAuth Basic authorization header has to be encoded by hand.
 */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode raw bytes (values 0-255) as standard base64 with padding. */
export function base64EncodeBytes(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]! & 0xff;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1]! & 0xff : 0;
    const b2 = hasB2 ? bytes[i + 2]! & 0xff : 0;
    out += BASE64_ALPHABET[b0 >> 2]!;
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    out += hasB1 ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]! : '=';
    out += hasB2 ? BASE64_ALPHABET[b2 & 0x3f]! : '=';
  }
  return out;
}

/** UTF-8 encode a string into bytes. */
export function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (const char of input) {
    const code = char.codePointAt(0)!;
    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return bytes;
}

/** Base64 of the UTF-8 encoding of `input` (used for the OAuth Basic header). */
export function base64EncodeUtf8(input: string): string {
  return base64EncodeBytes(utf8Bytes(input));
}
