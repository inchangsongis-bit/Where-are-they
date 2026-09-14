'use client';

import { useState } from 'react';

/**
 * FR-1 — create an event. Deliberately the whole form: place, time, name.
 * Anything else can wait until there is a reason for it.
 */
export default function CreateEventPage() {
  const [title, setTitle] = useState('Dinner');
  const [placeName, setPlaceName] = useState('');
  const [placeAddress, setPlaceAddress] = useState('');
  const [coords, setCoords] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [organizerName, setOrganizerName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    // R1.1 takes coordinates as text. Mapbox Search replaces this in R1.4 —
    // but an event without coordinates cannot produce an ETA, so it is
    // required from the very first version rather than bolted on.
    const parts = coords.split(',').map((value) => Number(value.trim()));
    const lat = parts[0];
    const lng = parts[1];
    if (parts.length !== 2 || lat === undefined || lng === undefined ||
        Number.isNaN(lat) || Number.isNaN(lng)) {
      setError('Enter the venue coordinates as "latitude, longitude".');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          placeName,
          placeAddress: placeAddress || placeName,
          lat,
          lng,
          startsAt: new Date(startsAt).toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          organizerName,
          ...(pin === '' ? {} : { pin }),
        }),
      });

      const data: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof data === 'object' && data !== null && 'error' in data
            ? String((data as { error: unknown }).error)
            : 'Could not create the event.';
        setError(message);
        return;
      }
      setInvite((data as { inviteUrl: string }).inviteUrl);
    } catch {
      setError('Could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  if (invite !== null) {
    return (
      <main>
        <h1>Send this to the group</h1>
        <p>
          Anyone who opens it can join with just their first name — no account,
          no app.
        </p>
        <div className="invite">
          <code>{invite}</code>
        </div>
        <a href={invite}>
          <button type="button">Open the event</button>
        </a>
      </main>
    );
  }

  return (
    <main>
      <h1>Where Are They</h1>
      <p>Create a dinner, share one link, see who&rsquo;s close.</p>

      <form onSubmit={submit}>
        {error !== null && <p className="error">{error}</p>}

        <label htmlFor="organizerName">Your name</label>
        <input id="organizerName" value={organizerName} maxLength={24} required
          onChange={(e) => setOrganizerName(e.target.value)} />

        <label htmlFor="title">What is it</label>
        <input id="title" value={title} maxLength={80}
          onChange={(e) => setTitle(e.target.value)} />

        <label htmlFor="placeName">Place</label>
        <input id="placeName" value={placeName} required placeholder="Kisa Izakaya"
          onChange={(e) => setPlaceName(e.target.value)} />

        <label htmlFor="placeAddress">Address</label>
        <input id="placeAddress" value={placeAddress} placeholder="118 Bowery"
          onChange={(e) => setPlaceAddress(e.target.value)} />

        <label htmlFor="coords">Coordinates</label>
        <input id="coords" value={coords} required placeholder="40.7188, -73.9938"
          onChange={(e) => setCoords(e.target.value)} />
        <p className="hint">
          Place search arrives in R1.4. Until then, paste the coordinates —
          without them there is no ETA.
        </p>

        <label htmlFor="startsAt">When</label>
        <input id="startsAt" type="datetime-local" value={startsAt} required
          onChange={(e) => setStartsAt(e.target.value)} />

        <label htmlFor="pin">PIN (optional)</label>
        <input id="pin" value={pin} inputMode="numeric" pattern="\d{4}" maxLength={4}
          placeholder="4 digits" onChange={(e) => setPin(e.target.value)} />

        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create and get the link'}
        </button>
      </form>
    </main>
  );
}
