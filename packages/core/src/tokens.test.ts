import { describe, expect, it } from 'vitest';
import { generateEventToken, inviteUrl, isValidEventToken } from './tokens';

describe('generateEventToken', () => {
  it('produces a 22-character URL-safe token', () => {
    const token = generateEventToken();
    expect(token).toHaveLength(22);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never collides across a large sample', () => {
    const tokens = new Set(Array.from({ length: 5_000 }, generateEventToken));
    expect(tokens.size).toBe(5_000);
  });

  it('is not sequential — consecutive tokens share no long prefix', () => {
    const a = generateEventToken();
    const b = generateEventToken();
    expect(a.slice(0, 8)).not.toBe(b.slice(0, 8));
  });
});

describe('isValidEventToken', () => {
  it('accepts a generated token', () => {
    expect(isValidEventToken(generateEventToken())).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['too short', 'abc'],
    ['too long', 'a'.repeat(23)],
    ['padded base64', 'AAAAAAAAAAAAAAAAAAAAA='],
    ['path traversal', '../../../etc/passwd___'],
    ['sql-ish', "'; DROP TABLE events;--"],
  ])('rejects %s', (_label, input) => {
    expect(isValidEventToken(input)).toBe(false);
  });
});

describe('inviteUrl', () => {
  it('builds a link under /e/', () => {
    expect(inviteUrl('https://wat.app', 'abc')).toBe('https://wat.app/e/abc');
  });

  it('tolerates a trailing slash on the base URL', () => {
    expect(inviteUrl('https://wat.app/', 'abc')).toBe('https://wat.app/e/abc');
  });
});
