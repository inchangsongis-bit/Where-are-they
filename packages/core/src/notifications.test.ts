import { describe, expect, it } from 'vitest';
import {
  MESSAGE_COLLAPSE_MS, planEventNotifications, planMessageNotification, planNudge,
  type NotifiableParticipant,
} from './notifications';

const NOW = Date.UTC(2026, 8, 10, 23, 25, 0);
const STARTS_AT = Date.UTC(2026, 8, 10, 23, 30, 0);
const MINUTE = 60_000;

function person(overrides: Partial<NotifiableParticipant> = {}): NotifiableParticipant {
  return {
    id: 'p1',
    displayName: 'Ana',
    rsvp: 'going',
    status: 'not_started',
    pushToken: 'ExponentPushToken[abc]',
    muted: false,
    etaAt: null,
    arrivedAt: null,
    ...overrides,
  };
}

function plan(
  participants: NotifiableParticipant[],
  alreadySent: string[] = [],
  now = NOW,
) {
  return planEventNotifications({
    eventTitle: 'Dinner at Kisa',
    startsAt: STARTS_AT,
    participants,
    alreadySent: new Set(alreadySent),
    now,
  });
}

describe('proximity', () => {
  const nearly = person({
    id: 'priya', displayName: 'Priya', status: 'en_route', etaAt: NOW + 4 * MINUTE,
  });
  const waiting = person({ id: 'ana', displayName: 'Ana', status: 'arrived', arrivedAt: NOW });

  it('tells everyone else when someone is nearly here', () => {
    const [notification] = plan([nearly, waiting]);
    expect(notification?.kind).toBe('proximity');
    expect(notification?.body).toBe('Priya is 5 minutes away');
    expect(notification?.recipientIds).toEqual(['ana']);
  });

  it('never tells the subject about themselves', () => {
    const [notification] = plan([nearly, waiting]);
    expect(notification?.recipientIds).not.toContain('priya');
  });

  it('stays quiet while they are still far out', () => {
    // Note this person is also *late* (25 minutes out, start is in 5), which is
    // a different notification to a different recipient — so assert on
    // proximity specifically rather than on the plan being empty.
    const planned = plan(
      [person({ id: 'p', status: 'en_route', etaAt: NOW + 25 * MINUTE }), waiting],
    );
    expect(planned.filter((n) => n.kind === 'proximity')).toEqual([]);
  });

  it('sends once and never again — this is what stops the app being muted', () => {
    expect(plan([nearly, waiting], ['priya:proximity'])).toEqual([]);
  });

  it('does not announce on a negative ETA, which means stale not arrived', () => {
    const overdue = person({ id: 'p', status: 'en_route', etaAt: NOW - 5 * MINUTE });
    expect(plan([overdue, waiting]).filter((n) => n.kind === 'proximity')).toEqual([]);
  });

  it('skips people who muted the event', () => {
    const planned = plan([nearly, { ...waiting, muted: true }]);
    expect(planned.filter((n) => n.kind === 'proximity')).toEqual([]);
  });

  it('skips people with no push token', () => {
    const planned = plan([nearly, { ...waiting, pushToken: null }]);
    expect(planned.filter((n) => n.kind === 'proximity')).toEqual([]);
  });

  it('says nothing when there is nobody to tell', () => {
    expect(plan([nearly]).filter((n) => n.kind === 'proximity')).toEqual([]);
  });
});

describe('all here', () => {
  const ana = person({ id: 'ana', status: 'arrived', arrivedAt: NOW - 10 * MINUTE });
  const marco = person({ id: 'marco', displayName: 'Marco', status: 'arrived', arrivedAt: NOW });

  it('fires once everyone coming has arrived', () => {
    const notification = plan([ana, marco]).find((n) => n.kind === 'all_here');
    expect(notification?.body).toBe('Everyone is here');
    expect(notification?.recipientIds).toEqual(['ana', 'marco']);
  });

  it('is attributed to the last person in, so it dedupes on them', () => {
    const notification = plan([ana, marco]).find((n) => n.kind === 'all_here');
    expect(notification?.subjectId).toBe('marco');
  });

  it('ignores people who said they cannot make it', () => {
    const declined = person({ id: 'kim', rsvp: 'cant' });
    expect(plan([ana, marco, declined]).some((n) => n.kind === 'all_here')).toBe(true);
  });

  it('does not fire while anyone coming is still out', () => {
    const enRoute = person({ id: 'dev', status: 'en_route', etaAt: NOW + 20 * MINUTE });
    expect(plan([ana, marco, enRoute]).some((n) => n.kind === 'all_here')).toBe(false);
  });

  it('does not fire for a party of one', () => {
    expect(plan([marco]).some((n) => n.kind === 'all_here')).toBe(false);
  });

  it('fires only once', () => {
    expect(plan([ana, marco], ['marco:all_here']).some((n) => n.kind === 'all_here'))
      .toBe(false);
  });
});

describe('late', () => {
  it('tells you, and only you, when your own ETA slips past the start', () => {
    const late = person({ id: 'dev', status: 'en_route', etaAt: STARTS_AT + 15 * MINUTE });
    const other = person({ id: 'ana', status: 'arrived', arrivedAt: NOW });

    const notification = plan([late, other]).find((n) => n.kind === 'late');
    // The group can already see it on the list; you are the only one who can
    // act on it.
    expect(notification?.recipientIds).toEqual(['dev']);
  });

  it('stays quiet for someone arriving on time', () => {
    const onTime = person({ id: 'dev', status: 'en_route', etaAt: STARTS_AT - 5 * MINUTE });
    expect(plan([onTime]).some((n) => n.kind === 'late')).toBe(false);
  });

  it('fires only once', () => {
    const late = person({ id: 'dev', status: 'en_route', etaAt: STARTS_AT + 15 * MINUTE });
    expect(plan([late], ['dev:late']).some((n) => n.kind === 'late')).toBe(false);
  });

  it('respects a mute, even for your own lateness', () => {
    const late = person({
      id: 'dev', status: 'en_route', etaAt: STARTS_AT + 15 * MINUTE, muted: true,
    });
    expect(plan([late]).some((n) => n.kind === 'late')).toBe(false);
  });
});

describe('planNudge', () => {
  const from = person({ id: 'ana', displayName: 'Ana' });

  it('names who is asking', () => {
    const to = person({ id: 'jules', displayName: 'Jules' });
    expect(planNudge({ eventTitle: 'Dinner', from, to })?.body)
      .toBe('Ana is wondering where you are');
  });

  it('goes only to the person being nudged', () => {
    const to = person({ id: 'jules' });
    expect(planNudge({ eventTitle: 'Dinner', from, to })?.recipientIds).toEqual(['jules']);
  });

  it('is nothing at all for someone who muted or has no token', () => {
    expect(planNudge({ eventTitle: 'D', from, to: person({ id: 'j', muted: true }) })).toBeNull();
    expect(planNudge({ eventTitle: 'D', from, to: person({ id: 'j', pushToken: null }) }))
      .toBeNull();
  });
});

describe('planMessageNotification', () => {
  const author = person({ id: 'marco', displayName: 'Marco' });
  const others = [author, person({ id: 'ana' }), person({ id: 'priya' })];

  it('tells everyone but the author', () => {
    const notification = planMessageNotification({
      eventTitle: 'Dinner', author, participants: others, lastNotifiedAt: null, now: NOW,
    });
    expect(notification?.recipientIds).toEqual(['ana', 'priya']);
  });

  it('collapses a burst into one notification', () => {
    expect(planMessageNotification({
      eventTitle: 'Dinner', author, participants: others,
      lastNotifiedAt: NOW - 20_000, now: NOW,
    })).toBeNull();
  });

  it('notifies again once the window has passed', () => {
    expect(planMessageNotification({
      eventTitle: 'Dinner', author, participants: others,
      lastNotifiedAt: NOW - MESSAGE_COLLAPSE_MS - 1_000, now: NOW,
    })).not.toBeNull();
  });

  it('says nothing when the author is talking to themselves', () => {
    expect(planMessageNotification({
      eventTitle: 'Dinner', author, participants: [author],
      lastNotifiedAt: null, now: NOW,
    })).toBeNull();
  });
});
