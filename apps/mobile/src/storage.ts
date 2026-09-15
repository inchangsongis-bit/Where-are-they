import * as SecureStore from 'expo-secure-store';

/**
 * PS-6 — the participant secret lives in the platform secure store, which is
 * the native equivalent of an httpOnly cookie: the app can use it, and nothing
 * else on the device can read it.
 *
 * Tracking bookkeeping lives here too, because a background task starts in a
 * fresh JS context with no memory of anything — whatever it needs to decide
 * whether to keep running has to be on disk.
 */

const SECRET_KEY = (eventToken: string) => `wat.secret.${eventToken}`;
const SESSION_KEY = 'wat.tracking.session';

export async function saveSecret(eventToken: string, secret: string): Promise<void> {
  await SecureStore.setItemAsync(SECRET_KEY(eventToken), secret);
}

export async function loadSecret(eventToken: string): Promise<string | null> {
  return SecureStore.getItemAsync(SECRET_KEY(eventToken));
}

export async function clearSecret(eventToken: string): Promise<void> {
  await SecureStore.deleteItemAsync(SECRET_KEY(eventToken));
}

/** Everything the background task needs, since it wakes with no context. */
export interface TrackingSession {
  eventToken: string;
  venue: { lat: number; lng: number };
  eventStartsAt: number;
  /** FR-10 — the four-hour backstop is measured from here. */
  startedAt: number;
  /** Last tier we configured for, so we do not restart the task needlessly. */
  tier: 'far' | 'approaching' | 'arrived' | null;
  /** Fixes we could not deliver yet, oldest first. */
  queue: {
    lat: number;
    lng: number;
    accuracyM: number;
    recordedAt: number;
  }[];
}

export async function saveTrackingSession(session: TrackingSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function loadTrackingSession(): Promise<TrackingSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as TrackingSession;
  } catch {
    // A corrupt session is worse than none: it could keep a location task
    // alive with no way to reason about stopping it.
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return null;
  }
}

export async function clearTrackingSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
