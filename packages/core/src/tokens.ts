/**
 * Invite tokens are bearer credentials (PS-4): anyone holding one can see the
 * event and everyone's live position in it. 16 random bytes = 128 bits,
 * base64url-encoded to 22 characters.
 *
 * This module is deliberately free of Node and DOM APIs — it runs unchanged in
 * the Expo app, the browser, and route handlers, which is the point of
 * packages/core.
 */

const TOKEN_BYTES = 16;
const TOKEN_LENGTH = 22;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

interface RandomSource {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

function randomSource(): RandomSource {
  const source = (globalThis as { crypto?: RandomSource }).crypto;
  if (source === undefined || typeof source.getRandomValues !== 'function') {
    // Falling back to Math.random here would silently downgrade a security
    // boundary, so we refuse instead.
    throw new Error('No cryptographic random source available');
  }
  return source;
}

/** Unpadded base64url, without depending on btoa or Buffer. */
function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);

    out += BASE64URL_ALPHABET[(triple >> 18) & 63];
    out += BASE64URL_ALPHABET[(triple >> 12) & 63];
    if (b1 !== undefined) out += BASE64URL_ALPHABET[(triple >> 6) & 63];
    if (b2 !== undefined) out += BASE64URL_ALPHABET[triple & 63];
  }
  return out;
}

/** Generate a fresh invite token. Never sequential, never guessable. */
export function generateEventToken(): string {
  const bytes = randomSource().getRandomValues(new Uint8Array(TOKEN_BYTES));
  return toBase64Url(bytes);
}

/** Shape check only — says nothing about whether the event exists. */
export function isValidEventToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function inviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/e/${token}`;
}

export { TOKEN_LENGTH };
