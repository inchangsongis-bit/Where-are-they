'use client';

import type { Participant, TravelMode } from '@wat/core';
import { useState } from 'react';
import { useLocationSharing } from './useLocationSharing';
import { useWebPush } from './useWebPush';

const MODES: { value: TravelMode; label: string }[] = [
  { value: 'driving', label: 'Driving' },
  { value: 'walking', label: 'Walking' },
  { value: 'transit', label: 'Transit' },
  { value: 'cycling', label: 'Cycling' },
];

/**
 * FR-9/FR-14 — the primary action, and everything that hangs off it.
 *
 * The manual path is never hidden behind the location path: someone who
 * refuses permission, or whose battery is dying, can still tell the group when
 * they expect to arrive and mark themselves here.
 */
export default function CheckinControls({
  token, me, onChanged,
}: {
  token: string;
  me: Participant;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualMinutes, setManualMinutes] = useState('20');
  const [showDisclosure, setShowDisclosure] = useState(false);
  const push = useWebPush(token);

  const sharing = useLocationSharing({
    token,
    enabled: me.status === 'en_route' && me.sharing,
    onAfterSend: onChanged,
  });

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${token}/me`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error ?? 'That did not work.');
        return;
      }
      onChanged();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (me.status === 'arrived') {
    return (
      <div className="checkin">
        <p className="here">You&rsquo;re here. Location sharing has stopped.</p>
      </div>
    );
  }

  const denied = sharing.error === 'denied';

  return (
    <div className="checkin">
      {error !== null && <p className="error">{error}</p>}

      <label htmlFor="mode">How are you getting there?</label>
      <select id="mode" value={me.travelMode} disabled={busy}
        onChange={(e) => void patch({ travelMode: e.target.value })}>
        {MODES.map((mode) => (
          <option key={mode.value} value={mode.value}>{mode.label}</option>
        ))}
      </select>

      {me.status === 'not_started' && showDisclosure ? (
        // PS-9/PS-11 — say what is about to happen *before* the browser's own
        // permission prompt, which offers no room to explain and only one
        // chance to be refused.
        <div className="disclosure">
          <p className="disclosure-title">Before we ask for your location</p>
          <p>
            It goes to the {"people in this event"} and nobody else, only while
            you&rsquo;re checked in, and it stops by itself when you arrive.
          </p>
          <p>
            We keep your latest position, not a trail of where you&rsquo;ve
            been, and it&rsquo;s deleted a few hours after the dinner.
          </p>
          <a href="/privacy" target="_blank" rel="noreferrer">
            What this app knows about you
          </a>
          <button type="button" disabled={busy}
            onClick={() => {
              setShowDisclosure(false);
              // FR-18 — ask for notifications here too: the first moment they
              // buy the user something, never at page load.
              void push.subscribe();
              void patch({ status: 'en_route', sharing: true });
            }}>
            Continue
          </button>
          <button type="button" className="secondary" disabled={busy}
            onClick={() => {
              setShowDisclosure(false);
              void patch({ status: 'en_route', sharing: false });
            }}>
            Check in without sharing location
          </button>
        </div>
      ) : me.status === 'not_started' ? (
        <button type="button" disabled={busy} onClick={() => setShowDisclosure(true)}>
          I&rsquo;m on my way
        </button>
      ) : (
        <>
          {me.sharing && sharing.active && (
            // PS-2 — a persistent indicator whenever location is being shared.
            <p className="sharing-on" role="status">
              ● Sharing your location with this group
              {sharing.queued > 0 && ` · ${sharing.queued} waiting to send`}
            </p>
          )}

          {denied && (
            <p className="error">
              Location is blocked for this site. You can still tell the group
              when you expect to arrive.
            </p>
          )}

          {me.sharing ? (
            <button type="button" className="secondary" disabled={busy}
              onClick={() => void patch({ sharing: false })}>
              Stop sharing location
            </button>
          ) : (
            <button type="button" className="secondary" disabled={busy}
              onClick={() => void patch({ sharing: true })}>
              Share my location
            </button>
          )}

          {(!me.sharing || denied) && (
            <div className="manual">
              <label htmlFor="eta">Or just tell them: arriving in</label>
              <div className="manual-row">
                <input id="eta" inputMode="numeric" value={manualMinutes}
                  onChange={(e) => setManualMinutes(e.target.value)} />
                <span className="hint">min</span>
                <button type="button" className="secondary" disabled={busy}
                  onClick={() => {
                    const minutes = Number(manualMinutes);
                    if (!Number.isFinite(minutes) || minutes < 0) {
                      setError('Enter a number of minutes.');
                      return;
                    }
                    void patch({
                      status: 'en_route',
                      selfReportedEta: new Date(Date.now() + minutes * 60_000).toISOString(),
                    });
                  }}>
                  Tell them
                </button>
              </div>
            </div>
          )}

          <button type="button" disabled={busy}
            onClick={() => void patch({ status: 'arrived' })}>
            I&rsquo;m here
          </button>

          <label className="mute">
            <input type="checkbox" checked={me.muted}
              onChange={(e) => void patch({ muted: e.target.checked })} />
            Mute notifications for this event
          </label>
        </>
      )}
    </div>
  );
}
