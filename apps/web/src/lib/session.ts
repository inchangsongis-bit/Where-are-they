import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * PS-6 — participant identity.
 *
 * On joining, the server issues a 256-bit random secret. The cookie holds the
 * secret; the database stores only its SHA-256. A forged cookie matches no row,
 * and a database leak does not hand over anyone's session — which is why this
 * is a hashed bearer token rather than a signed identifier. There is nothing
 * for a client to tamper with, because the client is not trusted with an id.
 *
 * One cookie per event: a device can be in several events at once, and each
 * membership is a separate credential.
 */

const SECRET_BYTES = 32;
const COOKIE_PREFIX = 'wat_p_';

export interface IssuedSession {
  /** Goes in the cookie. Never stored. */
  secret: string;
  /** Goes in the database. Never leaves the server. */
  hash: string;
}

export function issueSession(): IssuedSession {
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return { secret, hash: hashSessionSecret(secret) };
}

export function hashSessionSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Constant-time compare, so a wrong guess leaks nothing through timing. */
export function sessionMatches(secret: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashSessionSecret(secret), 'hex');
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export function sessionCookieName(eventToken: string): string {
  return `${COOKIE_PREFIX}${eventToken}`;
}

export interface CookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
}

/**
 * SameSite=Lax rather than Strict: the whole product is a link someone taps in
 * a group chat, and Strict would drop the cookie on that first cross-site
 * navigation.
 */
export function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  };
}
