import { describe, expect, it } from 'vitest';
import { disambiguate, validateDisplayName, validateMessage } from './validation.js';

describe('validateDisplayName', () => {
  it('trims and collapses whitespace', () => {
    expect(validateDisplayName('  Ana   K  ')).toEqual({ ok: true, value: 'Ana K' });
  });

  it('rejects a blank name with something actionable', () => {
    const result = validateDisplayName('   ');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/Enter a name/);
  });

  it('rejects an over-long name', () => {
    expect(validateDisplayName('a'.repeat(25)).ok).toBe(false);
  });

  it('accepts a name of exactly the maximum length', () => {
    expect(validateDisplayName('a'.repeat(24)).ok).toBe(true);
  });

  it('accepts non-Latin names', () => {
    expect(validateDisplayName('송인창')).toEqual({ ok: true, value: '송인창' });
  });
});

describe('validateMessage', () => {
  it('accepts an ordinary message', () => {
    expect(validateMessage(' grabbing the table ')).toEqual({
      ok: true, value: 'grabbing the table',
    });
  });

  it('rejects whitespace only', () => {
    expect(validateMessage('\n\t ').ok).toBe(false);
  });

  it('rejects a message over 500 characters', () => {
    expect(validateMessage('x'.repeat(501)).ok).toBe(false);
  });
});

describe('disambiguate', () => {
  it('leaves unique names alone', () => {
    expect(disambiguate(['Ana', 'Marco'])).toEqual(['Ana', 'Marco']);
  });

  it('numbers repeats in order', () => {
    expect(disambiguate(['Sam', 'Ana', 'Sam'])).toEqual(['Sam 1', 'Ana', 'Sam 2']);
  });

  it('treats differing case as the same name', () => {
    expect(disambiguate(['sam', 'SAM'])).toEqual(['sam 1', 'SAM 2']);
  });
});
