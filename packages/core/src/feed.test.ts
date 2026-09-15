import { describe, expect, it } from 'vitest';
import {
  QUICK_REPLIES, describeEntry, isSystemEntry, lateEta, messageTooLong,
  sortEntries, unreadCount, type FeedEntry,
} from './feed';

const NOW = Date.UTC(2026, 8, 10, 23, 30, 0);
const MINUTE = 60_000;

function entry(overrides: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id: '1',
    kind: 'text',
    participantId: 'p1',
    authorName: 'Ana',
    body: 'grabbing the table',
    meta: null,
    createdAt: NOW,
    ...overrides,
  };
}

describe('describeEntry', () => {
  it('renders a text message as itself', () => {
    expect(describeEntry(entry())).toBe('grabbing the table');
  });

  it.each([
    ['checked_in', 'Ana is on the way'],
    ['arrived', 'Ana arrived'],
    ['late', 'Ana is running late'],
    ['joined', 'Ana joined'],
    ['cancelled', 'Ana cancelled this'],
  ])('renders a %s event as a sentence', (kind, expected) => {
    expect(describeEntry(entry({ kind: kind as FeedEntry['kind'], body: null })))
      .toBe(expected);
  });

  it('distinguishes the organizer from everyone else joining', () => {
    expect(describeEntry(entry({
      kind: 'joined', body: null, meta: { organizer: true },
    }))).toBe('Ana started this');
  });

  it.each([
    ['going', 'Ana is coming'],
    ['maybe', 'Ana might come'],
    ['cant', "Ana can't make it"],
  ])('renders an RSVP of %s', (rsvp, expected) => {
    expect(describeEntry(entry({ kind: 'rsvp', body: null, meta: { rsvp } })))
      .toBe(expected);
  });

  it('still reads correctly after the author has left', () => {
    // participant_id is ON DELETE SET NULL, so the name is denormalised onto
    // the entry when it is written.
    expect(describeEntry(entry({
      kind: 'arrived', body: null, participantId: null, authorName: 'Marco',
    }))).toBe('Marco arrived');
  });

  it('degrades to something readable if even the name is gone', () => {
    expect(describeEntry(entry({
      kind: 'arrived', body: null, participantId: null, authorName: null,
    }))).toBe('Someone arrived');
  });

  it('does not throw on an unrecognised rsvp payload', () => {
    expect(describeEntry(entry({ kind: 'rsvp', body: null, meta: { rsvp: 'huh' } })))
      .toBe('Ana replied');
  });
});

describe('isSystemEntry', () => {
  it('separates what people said from what happened', () => {
    expect(isSystemEntry(entry())).toBe(false);
    expect(isSystemEntry(entry({ kind: 'arrived', body: null }))).toBe(true);
  });
});

describe('quick replies', () => {
  it('offers exactly the three things people actually send', () => {
    expect(QUICK_REPLIES.map((r) => r.label)).toEqual([
      'On my way', 'Running 10 late', 'Grab a table',
    ]);
  });

  it('makes two of them change state, not just say something', () => {
    const omw = QUICK_REPLIES.find((r) => r.id === 'omw');
    const late = QUICK_REPLIES.find((r) => r.id === 'late10');
    expect(omw?.checksIn).toBe(true);
    expect(late?.lateMinutes).toBe(10);
  });
});

describe('lateEta', () => {
  it('counts from the start time when the event has not started', () => {
    const startsAt = NOW + 30 * MINUTE;
    expect(lateEta(startsAt, 10, NOW)).toBe(startsAt + 10 * MINUTE);
  });

  it('counts from now once the start time has passed', () => {
    // Otherwise someone an hour late could claim to be ten minutes away.
    const startsAt = NOW - 60 * MINUTE;
    expect(lateEta(startsAt, 10, NOW)).toBe(NOW + 10 * MINUTE);
  });

  it('is always in the future', () => {
    expect(lateEta(NOW - 5 * MINUTE, 10, NOW)).toBeGreaterThan(NOW);
    expect(lateEta(NOW + 5 * MINUTE, 10, NOW)).toBeGreaterThan(NOW);
  });
});

describe('unreadCount', () => {
  const entries = [
    entry({ id: '1', participantId: 'p2', createdAt: NOW - 3 * MINUTE }),
    entry({ id: '2', participantId: 'p1', createdAt: NOW - 2 * MINUTE }),
    entry({ id: '3', participantId: 'p2', createdAt: NOW - MINUTE }),
    entry({ id: '4', kind: 'arrived', body: null, participantId: 'p2', createdAt: NOW }),
  ];

  it('counts what other people said since you last looked', () => {
    expect(unreadCount(entries, NOW - 2.5 * MINUTE, 'p1')).toBe(1);
  });

  it('never counts your own messages', () => {
    expect(unreadCount(entries, NOW - 10 * MINUTE, 'p1')).toBe(2);
  });

  it('never counts system events — a badge for your own arrival is noise', () => {
    expect(unreadCount([entries[3]!], null, 'p1')).toBe(0);
  });

  it('counts everything for someone who has never read the thread', () => {
    expect(unreadCount(entries, null, 'p1')).toBe(2);
  });

  it('is zero once caught up', () => {
    expect(unreadCount(entries, NOW, 'p1')).toBe(0);
  });
});

describe('sortEntries', () => {
  it('reads oldest first, like a thread', () => {
    const sorted = sortEntries([
      entry({ id: 'b', createdAt: NOW }),
      entry({ id: 'a', createdAt: NOW - MINUTE }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('breaks ties deterministically so the list never jitters', () => {
    const a = sortEntries([entry({ id: 'y' }), entry({ id: 'x' })]);
    const b = sortEntries([entry({ id: 'x' }), entry({ id: 'y' })]);
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
  });

  it('does not mutate its input', () => {
    const input = [entry({ id: 'b', createdAt: NOW }), entry({ id: 'a', createdAt: 0 })];
    sortEntries(input);
    expect(input.map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('messageTooLong', () => {
  it('accepts an ordinary message', () => {
    expect(messageTooLong('on my way')).toBe(false);
  });

  it('rejects one over the limit', () => {
    expect(messageTooLong('x'.repeat(501))).toBe(true);
  });

  it('measures the trimmed message, not the whitespace around it', () => {
    expect(messageTooLong(`  ${'x'.repeat(500)}  `)).toBe(false);
  });
});
