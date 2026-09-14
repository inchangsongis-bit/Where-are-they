import { describe, expect, it } from 'vitest';
import {
  hashSessionSecret, issueSession, sessionCookieName, sessionMatches,
} from './session';

describe('issueSession', () => {
  it('issues a high-entropy secret and a hash that is not the secret', () => {
    const { secret, hash } = issueSession();
    expect(secret.length).toBeGreaterThanOrEqual(40);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(secret);
  });

  it('never repeats', () => {
    const secrets = new Set(Array.from({ length: 2_000 }, () => issueSession().secret));
    expect(secrets.size).toBe(2_000);
  });
});

describe('sessionMatches', () => {
  it('matches the secret it was derived from', () => {
    const { secret, hash } = issueSession();
    expect(sessionMatches(secret, hash)).toBe(true);
  });

  it('rejects a different secret', () => {
    const { hash } = issueSession();
    expect(sessionMatches(issueSession().secret, hash)).toBe(false);
  });

  it('rejects a non-hex stored value without throwing', () => {
    const { secret } = issueSession();
    expect(sessionMatches(secret, 'not-hex-at-all')).toBe(false);
  });

  it('rejects a truncated hash rather than matching on a prefix', () => {
    const { secret, hash } = issueSession();
    expect(sessionMatches(secret, hash.slice(0, 40))).toBe(false);
  });
});

describe('sessionCookieName', () => {
  it('is scoped per event, so one device can be in several', () => {
    expect(sessionCookieName('AAAAAAAAAAAAAAAAAAAAAA'))
      .not.toBe(sessionCookieName('BBBBBBBBBBBBBBBBBBBBBB'));
  });

  it('produces a legal cookie name', () => {
    expect(sessionCookieName('AAAAAAAAAAAAAAAAAAAAAA'))
      .toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('hashSessionSecret', () => {
  it('is stable for the same input', () => {
    expect(hashSessionSecret('abc')).toBe(hashSessionSecret('abc'));
  });
});
