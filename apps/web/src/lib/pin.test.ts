import { describe, expect, it } from 'vitest';
import { hashPin, isValidPinFormat, verifyPin } from './pin';

describe('isValidPinFormat', () => {
  it.each(['0000', '1234', '9999'])('accepts %s', (pin) => {
    expect(isValidPinFormat(pin)).toBe(true);
  });

  it.each(['123', '12345', '12a4', '', ' 1234', '１２３４'])(
    'rejects %j', (pin) => {
      expect(isValidPinFormat(pin)).toBe(false);
    });
});

describe('hashPin / verifyPin', () => {
  it('round-trips the right PIN', async () => {
    const hash = await hashPin('4821');
    expect(await verifyPin('4821', hash)).toBe(true);
  });

  it('rejects a wrong PIN', async () => {
    const hash = await hashPin('4821');
    expect(await verifyPin('4822', hash)).toBe(false);
  });

  it('salts, so the same PIN hashes differently every time', async () => {
    expect(await hashPin('4821')).not.toBe(await hashPin('4821'));
  });

  it('never stores the PIN in the hash string', async () => {
    expect(await hashPin('4821')).not.toContain('4821');
  });

  it('refuses to hash something that is not four digits', async () => {
    await expect(hashPin('12')).rejects.toThrow(/four digits/);
  });

  it.each([
    ['empty', ''],
    ['not scrypt', 'argon2$1$2$3$4$5'],
    ['too few parts', 'scrypt$16384$8$1$abc'],
    ['garbage cost', 'scrypt$x$8$1$YWJj$YWJj'],
  ])('rejects a malformed stored hash (%s) instead of throwing', async (_l, stored) => {
    expect(await verifyPin('4821', stored)).toBe(false);
  });
});
