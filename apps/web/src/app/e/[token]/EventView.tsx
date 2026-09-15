'use client';

import {
  arrivalDisplay, everyoneHereBy, formatAge, formatClockTime, isLate,
  sortRoster, summarise, unreadCount,
  type FeedEntry, type Participant, type Rsvp,
} from '@wat/core';
import { useCallback, useEffect, useState } from 'react';
import CheckinControls from './CheckinControls';
import MapPanel from './MapPanel';
import FeedPanel from './FeedPanel';

interface Snapshot {
  event: {
    token: string;
    title: string;
    venue: { name: string; address: string; lat: number; lng: number };
    startsAt: number;
    timezone: string;
    status: 'active' | 'cancelled';
  };
  participants: Participant[];
  me: { id: string } | null;
  feed: { entries: FeedEntry[]; lastReadAt: number | null };
}

const RSVP_LABELS: Record<Exclude<Rsvp, 'pending'>, string> = {
  going: 'Going',
  maybe: 'Maybe',
  cant: "Can't",
};

/**
 * R1.1 polls every 5 seconds. Supabase Realtime replaces this in R1.5 — but the
 * list has to update without a manual refresh from the first version, because
 * "everyone sees it update live" is what makes it feel like a shared thing.
 */
const POLL_MS = 5_000;

export default function EventView({ initial }: { initial: Snapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<'list' | 'map' | 'feed'>('list');
  const [feed, setFeed] = useState(initial.feed);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const token = snapshot.event.token;
  const joined = snapshot.me !== null;

  const refresh = useCallback(async () => {
    try {
      const [stateResponse, feedResponse] = await Promise.all([
        fetch(`/api/events/${token}`, { cache: 'no-store' }),
        fetch(`/api/events/${token}/messages`, { cache: 'no-store' }),
      ]);
      if (stateResponse.ok) {
        setSnapshot((await stateResponse.json()) as Snapshot);
      }
      if (feedResponse.ok) {
        const data = (await feedResponse.json()) as {
          entries: FeedEntry[]; lastReadAt: number | null;
        };
        setFeed(data);
      }
    } catch {
      // A failed poll is not worth interrupting anyone over — the list simply
      // keeps showing what it last knew, which is the honest thing to do.
    }
  }, [token]);

  useEffect(() => {
    const poll = setInterval(refresh, POLL_MS);
    // Re-tick independently so "last seen 4 min ago" ages even between polls.
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  async function join(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/events/${token}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: name }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        setError(
          typeof data === 'object' && data !== null && 'error' in data
            ? String((data as { error: unknown }).error)
            : 'Could not join.',
        );
        return;
      }
      await refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function setRsvp(rsvp: Rsvp) {
    const previous = snapshot;
    // Optimistic: an RSVP tap should feel instant, and the poll corrects it.
    setSnapshot({
      ...snapshot,
      participants: snapshot.participants.map((p) =>
        p.id === snapshot.me?.id ? { ...p, rsvp } : p,
      ),
    });
    try {
      const response = await fetch(`/api/events/${token}/me`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rsvp }),
      });
      if (!response.ok) setSnapshot(previous);
      else await refresh();
    } catch {
      setSnapshot(previous);
    }
  }

  const { event, participants } = snapshot;
  const timezone = event.timezone;
  const roster = sortRoster(participants, now);
  const summary = summarise(participants);
  const allHereBy = everyoneHereBy(participants, now);
  const me = participants.find((p) => p.id === snapshot.me?.id) ?? null;
  const unread =
    tab === 'feed' ? 0 : unreadCount(feed.entries, feed.lastReadAt, snapshot.me?.id ?? null);

  return (
    <main>
      <h1>{event.title}</h1>
      <p className="venue">
        {event.venue.name} · {event.venue.address} ·{' '}
        {formatClockTime(event.startsAt, timezone)}
      </p>

      {event.status === 'cancelled' && (
        <p className="error">This event was cancelled.</p>
      )}

      {!joined ? (
        <form onSubmit={join} style={{ marginTop: 20 }}>
          <h2>What&rsquo;s your name?</h2>
          <p>That&rsquo;s all — no account, no app.</p>
          {error !== null && <p className="error">{error}</p>}
          <label htmlFor="displayName">First name</label>
          <input id="displayName" value={name} maxLength={24} required
            onChange={(e) => setName(e.target.value)} />
          <button type="submit" disabled={busy}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </form>
      ) : (
        <>
          <div className="rsvp" role="group" aria-label="Your RSVP">
            {(Object.keys(RSVP_LABELS) as Array<keyof typeof RSVP_LABELS>).map((value) => (
              <button key={value} type="button"
                aria-pressed={me?.rsvp === value}
                onClick={() => void setRsvp(value)}>
                {RSVP_LABELS[value]}
              </button>
            ))}
          </div>

          {me !== null && me.rsvp !== 'cant' && (
            <CheckinControls token={token} me={me} onChanged={() => void refresh()} />
          )}
        </>
      )}

      <div className="tabs" role="tablist" aria-label="Views">
        <button type="button" role="tab" aria-selected={tab === 'list'}
          onClick={() => setTab('list')}>List</button>
        <button type="button" role="tab" aria-selected={tab === 'map'}
          onClick={() => setTab('map')}>Map</button>
        <button type="button" role="tab" aria-selected={tab === 'feed'}
          onClick={() => setTab('feed')}>
          Feed
          {unread > 0 && (
            <span className="tab-badge" aria-label={`${unread} unread`}>{unread}</span>
          )}
        </button>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-head">
          {allHereBy !== null && (
            <div>
              <span className="headline-label">Everyone here by </span>
              <span className="headline">{formatClockTime(allHereBy, timezone)}</span>
            </div>
          )}
          <div className="tally">
            {summary.here} here · {summary.onTheWay} on the way ·{' '}
            {summary.notStarted} not started
            {summary.notComing > 0 && ` · ${summary.notComing} can't make it`}
          </div>
        </div>

        {tab === 'feed' ? (
          <FeedPanel token={token} entries={feed.entries}
            lastReadAt={feed.lastReadAt} myParticipantId={snapshot.me?.id ?? null}
            canPost={joined} onChanged={() => void refresh()} />
        ) : tab === 'map' ? (
          <MapPanel participants={participants} venue={event.venue}
            selectedId={selectedId} onSelect={setSelectedId} />
        ) : (
          roster.map((participant) => (
            <Row key={participant.id} participant={participant}
              timezone={timezone} startsAt={event.startsAt} now={now}
              selected={participant.id === selectedId}
              onSelect={() =>
                setSelectedId(selectedId === participant.id ? null : participant.id)} />
          ))
        )}
      </div>
    </main>
  );
}

function Row({
  participant, timezone, startsAt, now, selected, onSelect,
}: {
  participant: Participant;
  timezone: string;
  startsAt: number;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const display = arrivalDisplay(participant, now);
  const late = isLate(participant, startsAt, now);

  // FR-11 — say how someone is being tracked, so a gap in their updates reads
  // as expected rather than broken.
  const parts: string[] = [];
  if (participant.isOrganizer) parts.push('organizer');
  if (participant.status === 'en_route') {
    parts.push(participant.travelMode);
    parts.push(participant.sharing ? 'sharing' : 'not sharing');
  }
  if (late) parts.push('late');
  const subtitle = parts.join(' · ');

  let eta: React.ReactNode;
  switch (display.kind) {
    case 'arrived':
      eta = <span className="eta">{formatClockTime(display.at, timezone)}</span>;
      break;
    case 'eta':
      eta = (
        <span className={display.stale ? 'eta dim' : 'eta'}>
          {formatClockTime(display.at, timezone)}
        </span>
      );
      break;
    case 'self_reported':
      eta = <span className="eta dim">~{formatClockTime(display.at, timezone)}</span>;
      break;
    case 'last_seen':
      eta = <span className="eta dim">last seen {formatAge(display.agoMs)}</span>;
      break;
    case 'unknown':
      eta = <span className="eta dim">—</span>;
      break;
  }

  // NFR: status is never conveyed by colour alone, so every chip carries text.
  const chip =
    participant.status === 'arrived' ? { className: 'chip chip-go', label: 'Arrived' }
    : participant.status === 'en_route' ? { className: 'chip chip-wait', label: 'En route' }
    : participant.rsvp === 'cant' ? { className: 'chip chip-idle', label: "Can't make it" }
    : participant.rsvp === 'maybe' ? { className: 'chip chip-idle', label: 'Maybe' }
    : participant.rsvp === 'going' ? { className: 'chip chip-idle', label: 'Going' }
    : { className: 'chip chip-idle', label: 'No answer' };

  return (
    <div className={selected ? 'row selected' : 'row'} onClick={onSelect}
      role="button" tabIndex={0}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
          keyEvent.preventDefault();
          onSelect();
        }
      }}>
      <div className="avatar" style={{ background: participant.color }}
        aria-hidden="true">
        {participant.displayName.slice(0, 1).toUpperCase()}
      </div>
      <div>
        <div className="name">{participant.displayName}</div>
        {subtitle !== '' && <div className="sub">{subtitle}</div>}
      </div>
      <div className="right">
        {eta}
        <br />
        <span className={chip.className}>{chip.label}</span>
      </div>
    </div>
  );
}
