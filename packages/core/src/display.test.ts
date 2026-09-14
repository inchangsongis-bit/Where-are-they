import { describe, expect, it } from 'vitest';
import { arrivalDisplay, formatAge, formatClockTime, isLate } from './display';
import { MINUTE, NOW, enRoute, participant, position } from './test-helpers';

const ETA_AT = NOW + 8 * MINUTE;

describe('arrivalDisplay', () => {
  it('shows the arrival time once someone is here', () => {
    const p = participant({ status: 'arrived', arrivedAt: NOW - 12 * MINUTE });
    expect(arrivalDisplay(p, NOW)).toEqual({ kind: 'arrived', at: NOW - 12 * MINUTE });
  });

  it('shows a live ETA from a fresh position', () => {
    expect(arrivalDisplay(enRoute('Priya', 20_000, ETA_AT), NOW)).toEqual({
      kind: 'eta',
      at: ETA_AT,
      stale: false,
    });
  });

  it('marks the ETA stale past two minutes but still shows it', () => {
    expect(arrivalDisplay(enRoute('Dev', 3 * MINUTE, ETA_AT), NOW)).toEqual({
      kind: 'eta',
      at: ETA_AT,
      stale: true,
    });
  });

  it('withholds the ETA past ten minutes and reports the age instead', () => {
    expect(arrivalDisplay(enRoute('Sam', 11 * MINUTE, ETA_AT), NOW)).toEqual({
      kind: 'last_seen',
      agoMs: 11 * MINUTE,
    });
  });

  it('falls back to what they told us when the position has expired', () => {
    const p = enRoute('Sam', 11 * MINUTE, ETA_AT, {
      selfReportedEta: NOW + 20 * MINUTE,
    });
    expect(arrivalDisplay(p, NOW)).toEqual({
      kind: 'self_reported',
      at: NOW + 20 * MINUTE,
    });
  });

  it('uses a self-reported ETA when location was never granted', () => {
    const p = participant({
      status: 'en_route',
      selfReportedEta: NOW + 15 * MINUTE,
      trackingSource: 'manual',
    });
    expect(arrivalDisplay(p, NOW)).toEqual({
      kind: 'self_reported',
      at: NOW + 15 * MINUTE,
    });
  });

  it('says nothing at all when it knows nothing at all', () => {
    expect(arrivalDisplay(participant(), NOW)).toEqual({ kind: 'unknown' });
  });

  it('does not invent an ETA from a position with no route', () => {
    const p = participant({
      status: 'en_route',
      lastPosition: position({ recordedAt: NOW - 30_000 }),
    });
    expect(arrivalDisplay(p, NOW)).toEqual({ kind: 'last_seen', agoMs: 30_000 });
  });
});

describe('isLate', () => {
  const startsAt = NOW + 5 * MINUTE;

  it('flags an ETA after the start time', () => {
    expect(isLate(enRoute('Dev', 20_000, NOW + 12 * MINUTE), startsAt, NOW)).toBe(true);
  });

  it('does not flag someone arriving in time', () => {
    expect(isLate(enRoute('Priya', 20_000, NOW + 2 * MINUTE), startsAt, NOW)).toBe(false);
  });

  it('never flags someone who is already here', () => {
    const p = participant({ status: 'arrived', arrivedAt: NOW + 30 * MINUTE });
    expect(isLate(p, startsAt, NOW)).toBe(false);
  });

  it('does not flag someone we simply have no estimate for', () => {
    expect(isLate(participant(), startsAt, NOW)).toBe(false);
  });
});

describe('formatting', () => {
  it('renders a clock time in the event timezone', () => {
    expect(formatClockTime(Date.UTC(2026, 8, 10, 23, 34), 'America/New_York', 'en-US'))
      .toBe('7:34 PM');
  });

  it.each([
    [10_000, 'just now'],
    [MINUTE, '1 min ago'],
    [11 * MINUTE, '11 min ago'],
    [61 * MINUTE, '1 hr ago'],
    [180 * MINUTE, '3 hr ago'],
  ])('describes an age of %ims as %s', (age, expected) => {
    expect(formatAge(age as number)).toBe(expected);
  });
});
