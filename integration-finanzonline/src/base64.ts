/**
 * Pure-JS UTF-8 -> base64 encoder.
 *
 * The plugin-runtime isolate provides none of Node's `Buffer`, the Web
 * `TextEncoder`, or `btoa`, so the ELSTER plugin's `Buffer.from(...).toString('base64')`
 * helper would throw a ReferenceError here. fon-api's `build()` returns a UTF-8 XML
 * string; this encodes that string to UTF-8 bytes and then to base64 using only
 * core ECMAScript, for the `FileOutput.fileBase64` field.
 */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode a JS string as UTF-8 bytes (surrogate-pair aware). */
function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let cp = input.charCodeAt(i);
    // Combine a high+low surrogate pair into a single code point.
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    }
  }
  return bytes;
}

/** Encode a UTF-8 string to a base64 string. */
export function utf8ToBase64(input: string): string {
  const bytes = utf8Bytes(input);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1]! : 0;
    const b2 = hasB2 ? bytes[i + 2]! : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += hasB1 ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += hasB2 ? B64_ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}
