import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { promisify } from 'node:util';

// promisify picks the 3-argument overload, which drops the cost parameters we
// specifically want to pin, so the signature is restated here.
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * PS-5 — the optional 4-digit event PIN.
 *
 * Four digits is 10,000 possibilities, which is trivial to brute force offline.
 * Two things make it acceptable: the PIN is a second factor behind a 128-bit
 * invite token (never a credential on its own), and attempts are rate limited
 * server-side (PS-7). We still use scrypt rather than a plain hash so that a
 * database leak does not hand over the PINs for free.
 */

const KEY_LENGTH = 32;
const SALT_BYTES = 16;
const COST = 16_384; // scrypt N
const BLOCK_SIZE = 8; // r
const PARALLELISM = 1; // p

const PIN_PATTERN = /^\d{4}$/;

export function isValidPinFormat(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  if (!isValidPinFormat(pin)) {
    throw new Error('A PIN must be exactly four digits.');
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(pin, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
  });

  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (!isValidPinFormat(pin)) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelism = Number(parts[3]);
  const saltPart = parts[4];
  const hashPart = parts[5];
  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelism) ||
    saltPart === undefined ||
    hashPart === undefined
  ) {
    return false;
  }

  const expected = Buffer.from(hashPart, 'base64url');
  const derived = await scrypt(
    pin,
    Buffer.from(saltPart, 'base64url'),
    expected.length,
    { N: cost, r: blockSize, p: parallelism },
  );

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
