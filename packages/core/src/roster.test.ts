import { describe, expect, it } from 'vitest';
import { everyoneHereBy, sortRoster, summarise } from './roster';
import { MINUTE, NOW, enRoute, participant } from './test-helpers';

const names = (list: { displayName: string }[]) => list.map((p) => p.displayName);

describe('sortRoster', () => {
  it('orders arrived, then en route by soonest, then not started, maybe, cant', () => {
    const roster = [
      participant({ id: 'j', displayName: 'Jules', rsvp: 'going' }),
      enRoute('Dev', 30_000, NOW + 11 * MINUTE),
      participant({ id: 'k', displayName: 'Kim', rsvp: 'cant' }),
      participant({ id: 'a', displayName: 'Ana', status: 'arrived', arrivedAt: NOW - 12 * MINUTE }),
      participant({ id: 'l', displayName: 'Lee', rsvp: 'maybe' }),
      enRoute('Priya', 20_000, NOW + 4 * MINUTE),
    ];

    expect(names(sortRoster(roster, NOW))).toEqual([
      'Ana', 'Priya', 'Dev', 'Jules', 'Lee', 'Kim',
    ]);
  });

  it('keeps someone who said maybe but is driving over with the en-route band', () => {
    const roster = [
      participant({ id: 'j', displayName: 'Jules', rsvp: 'going' }),
      enRoute('Lee', 20_000, NOW + 6 * MINUTE, { rsvp: 'maybe' }),
    ];
    expect(names(sortRoster(roster, NOW))).toEqual(['Lee', 'Jules']);
  });

  it('sorts a participant with no usable estimate last within their band', () => {
    const roster = [
      enRoute('Sam', 11 * MINUTE, NOW + 2 * MINUTE), // position expired
      enRoute('Priya', 20_000, NOW + 9 * MINUTE),
    ];
    expect(names(sortRoster(roster, NOW))).toEqual(['Priya', 'Sam']);
  });

  it('falls back to name order so the list never jitters between renders', () => {
    const roster = [
      participant({ id: 'z', displayName: 'Zoe' }),
      participant({ id: 'b', displayName: 'Bea' }),
    ];
    expect(names(sortRoster(roster, NOW))).toEqual(['Bea', 'Zoe']);
  });

  it('does not mutate the array it was given', () => {
    const roster = [
      participant({ id: 'z', displayName: 'Zoe' }),
      participant({ id: 'b', displayName: 'Bea' }),
    ];
    sortRoster(roster, NOW);
    expect(names(roster)).toEqual(['Zoe', 'Bea']);
  });
});

describe('summarise', () => {
  it('counts the four buckets the header line reports', () => {
    const roster = [
      participant({ id: 'a', status: 'arrived' }),
      participant({ id: 'm', status: 'arrived' }),
      enRoute('Priya', 20_000, NOW + 4 * MINUTE),
      enRoute('Dev', 20_000, NOW + 11 * MINUTE),
      participant({ id: 'j', rsvp: 'going' }),
      participant({ id: 'k', rsvp: 'cant' }),
    ];
    expect(summarise(roster)).toEqual({
      here: 2, onTheWay: 2, notStarted: 1, notComing: 1,
    });
  });
});

describe('everyoneHereBy', () => {
  it('returns the latest ETA among the people actually coming', () => {
    const roster = [
      participant({ id: 'a', status: 'arrived', arrivedAt: NOW - 12 * MINUTE }),
      enRoute('Priya', 20_000, NOW + 4 * MINUTE),
      enRoute('Dev', 20_000, NOW + 11 * MINUTE),
    ];
    expect(everyoneHereBy(roster, NOW)).toBe(NOW + 11 * MINUTE);
  });

  it('ignores people who said they cannot make it', () => {
    const roster = [
      enRoute('Priya', 20_000, NOW + 4 * MINUTE),
      participant({ id: 'k', displayName: 'Kim', rsvp: 'cant' }),
    ];
    expect(everyoneHereBy(roster, NOW)).toBe(NOW + 4 * MINUTE);
  });

  it('withholds a headline while someone coming has no estimate', () => {
    const roster = [
      enRoute('Priya', 20_000, NOW + 4 * MINUTE),
      participant({ id: 'j', displayName: 'Jules', rsvp: 'going' }),
    ];
    expect(everyoneHereBy(roster, NOW)).toBeNull();
  });

  it('returns null once everyone is already here', () => {
    const roster = [
      participant({ id: 'a', status: 'arrived', arrivedAt: NOW - 5 * MINUTE }),
    ];
    expect(everyoneHereBy(roster, NOW)).toBeNull();
  });
});
