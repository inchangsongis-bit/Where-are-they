'use client';

import {
  QUICK_REPLIES, describeEntry, isSystemEntry, sortEntries, unreadCount,
  type FeedEntry,
} from '@wat/core';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * FR-15 — one thread, with what happened interleaved with what people said.
 *
 * That interleaving is the whole argument for having a feed at all: the group
 * already has a group chat, and this only earns its place by being the place
 * where "should we order?" sits directly under "Marco arrived 7:24".
 */
export default function FeedPanel({
  token, entries, lastReadAt, myParticipantId, canPost, onChanged,
}: {
  token: string;
  entries: FeedEntry[];
  lastReadAt: number | null;
  myParticipantId: string | null;
  canPost: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  const unread = unreadCount(entries, lastReadAt, myParticipantId);

  const markRead = useCallback(async () => {
    if (!canPost || unread === 0) return;
    try {
      await fetch(`/api/events/${token}/me/read`, { method: 'POST' });
      onChanged();
    } catch {
      // Not worth surfacing: the badge will clear on the next successful read.
    }
  }, [token, canPost, unread, onChanged]);

  useEffect(() => {
    void markRead();
  }, [markRead]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [entries.length]);

  async function send(payload: { body?: string; quickReply?: string }) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${token}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error ?? 'Could not send that.');
        return;
      }
      setDraft('');
      onChanged();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const ordered = sortEntries(entries);

  return (
    <div className="feed">
      <div className="feed-entries">
        {ordered.length === 0 && (
          <p className="feed-empty">Nothing here yet.</p>
        )}

        {ordered.map((entry) =>
          isSystemEntry(entry) ? (
            <p key={entry.id} className="feed-system">
              {describeEntry(entry)}
              <time>{formatTime(entry.createdAt)}</time>
            </p>
          ) : (
            <div key={entry.id}
              className={entry.participantId === myParticipantId ? 'feed-msg mine' : 'feed-msg'}>
              <div className="feed-author">
                {entry.authorName ?? 'Someone'}
                <time>{formatTime(entry.createdAt)}</time>
              </div>
              <div className="feed-body">{entry.body}</div>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>

      {canPost ? (
        <div className="feed-compose">
          {error !== null && <p className="error">{error}</p>}

          <div className="quick">
            {QUICK_REPLIES.map((reply) => (
              <button key={reply.id} type="button" className="secondary" disabled={busy}
                onClick={() => void send({ quickReply: reply.id })}>
                {reply.label}
              </button>
            ))}
          </div>

          <form className="compose-row"
            onSubmit={(formEvent) => {
              formEvent.preventDefault();
              if (draft.trim() === '') return;
              void send({ body: draft });
            }}>
            <input value={draft} maxLength={500} placeholder="Say something"
              aria-label="Message" onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" disabled={busy || draft.trim() === ''}>Send</button>
          </form>
        </div>
      ) : (
        <p className="feed-empty">Join the event to post.</p>
      )}
    </div>
  );
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(timestamp));
}
