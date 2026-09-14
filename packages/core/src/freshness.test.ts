import { describe, expect, it } from 'vitest';
import {
  positionFreshness,
  shouldRecomputeEta,
  shouldSendPosition,
} from './freshness';
import { MINUTE, NOW, position } from './test-helpers';

describe('positionFreshness', () => {
  it.each([
    ['a fresh fix', 5_000, 'fresh'],
    ['just under the stale line', 2 * MINUTE - 1, 'fresh'],
    ['exactly at the stale line', 2 * MINUTE, 'stale'],
    ['well past it', 5 * MINUTE, 'stale'],
    ['exactly at the expiry line', 10 * MINUTE, 'expired'],
    ['long gone', 40 * MINUTE, 'expired'],
  ])('treats %s as %s', (_label, age, expected) => {
    expect(positionFreshness(NOW - (age as number), NOW)).toBe(expected);
  });

  it('treats a clock-skewed future position as fresh rather than expired', () => {
    expect(positionFreshness(NOW + 30_000, NOW)).toBe('fresh');
  });
});

describe('shouldSendPosition', () => {
  it('always sends the first fix', () => {
    expect(shouldSendPosition(null, position())).toBe(true);
  });

  it('holds back an update that is too soon, however far it moved', () => {
    const last = position({ recordedAt: NOW });
    const next = position({ recordedAt: NOW + 5_000, lat: 40.75 });
    expect(shouldSendPosition(last, next)).toBe(false);
  });

  it('holds back a phone sitting still — this is the battery budget', () => {
    const last = position({ recordedAt: NOW });
    const next = position({ recordedAt: NOW + 10 * MINUTE });
    expect(shouldSendPosition(last, next)).toBe(false);
  });

  it('sends once both the interval and the distance are cleared', () => {
    const last = position({ recordedAt: NOW });
    const next = position({ recordedAt: NOW + 20_000, lat: 40.7198 });
    expect(shouldSendPosition(last, next)).toBe(true);
  });
});

describe('shouldRecomputeEta', () => {
  const from = { lat: 40.7188, lng: -73.9938 };

  it('computes when there is nothing to compare against', () => {
    expect(
      shouldRecomputeEta({
        lastComputedAt: null,
        lastComputedFrom: null,
        current: from,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('waits out the interval when barely moved — routing is the metered cost', () => {
    expect(
      shouldRecomputeEta({
        lastComputedAt: NOW - 10_000,
        lastComputedFrom: from,
        current: { lat: 40.7189, lng: -73.9938 },
        now: NOW,
      }),
    ).toBe(false);
  });

  it('recomputes after the interval', () => {
    expect(
      shouldRecomputeEta({
        lastComputedAt: NOW - 50_000,
        lastComputedFrom: from,
        current: from,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('recomputes early after covering real ground', () => {
    expect(
      shouldRecomputeEta({
        lastComputedAt: NOW - 5_000,
        lastComputedFrom: from,
        current: { lat: 40.7288, lng: -73.9938 },
        now: NOW,
      }),
    ).toBe(true);
  });
});
