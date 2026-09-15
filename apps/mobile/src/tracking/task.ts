import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import {
  stopTrackingReason, trackingConfigFor, shouldReconfigure,
} from '@wat/core';
import { api, ApiError } from '../api';
import {
  clearTrackingSession, loadSecret, loadTrackingSession, saveTrackingSession,
  type TrackingSession,
} from '../storage';

/**
 * FR-10 — the background location task.
 *
 * This runs in a fresh JS context with no memory of the app, sometimes while
 * the app is not running at all. Three consequences shape everything here:
 *
 * 1. Every piece of state it needs comes off disk, not from a module variable.
 * 2. It must be defined at import time, in the top-level module graph, or the
 *    OS will wake a task that does not exist.
 * 3. It has to be able to stop *itself*. A task that can only be stopped by the
 *    foreground app will keep reporting someone's location after a crash.
 */

export const LOCATION_TASK = 'wat-location-updates';
export const GEOFENCE_TASK = 'wat-arrival-geofence';

/** Kept small: a background wake is not the place to upload an hour of history. */
const MAX_QUEUE = 120;

async function stopEverything(): Promise<void> {
  for (const task of [LOCATION_TASK, GEOFENCE_TASK]) {
    try {
      if (await TaskManager.isTaskRegisteredAsync(task)) {
        if (task === LOCATION_TASK) await Location.stopLocationUpdatesAsync(task);
        else await Location.stopGeofencingAsync(task);
      }
    } catch {
      // Already gone, or the OS refused. Either way we are trying to stop.
    }
  }
  await clearTrackingSession();
}

/**
 * The stop check, run on *every* wake rather than only where it seemed
 * relevant. PS-2: sharing that outlives its event is the failure mode that
 * actually matters.
 */
async function shouldKeepRunning(session: TrackingSession): Promise<boolean> {
  const secret = await loadSecret(session.eventToken);
  if (secret === null) {
    await stopEverything();
    return false;
  }

  const now = Date.now();

  // The four-hour backstop and the event window can both be judged offline,
  // so a phone with no signal still stops on time.
  const localReason = stopTrackingReason({
    status: 'en_route',
    sharing: true,
    inEvent: true,
    eventStartsAt: session.eventStartsAt,
    trackingStartedAt: session.startedAt,
    now,
  });
  if (localReason !== null) {
    await stopEverything();
    return false;
  }

  return true;
}

async function flush(session: TrackingSession): Promise<TrackingSession> {
  if (session.queue.length === 0) return session;

  const secret = await loadSecret(session.eventToken);
  if (secret === null) return session;

  try {
    const result = await api.sendPositions(
      session.eventToken, secret, session.queue, 'app_background',
    );

    // FR-14 — the server decides arrival, and it telling us so is the signal to
    // shut the task down. PS-2: sharing stops itself on arrival.
    if (result.arrived) {
      await stopEverything();
      return { ...session, queue: [] };
    }

    return { ...session, queue: [] };
  } catch (error) {
    if (error instanceof ApiError) {
      // The event is over or we are no longer in it: nothing to report, ever.
      if (error.status === 409 || error.status === 401) {
        await stopEverything();
        return { ...session, queue: [] };
      }
      // Rate limited: keep the fixes and try on the next wake.
      if (error.status === 429) return session;
    }
    // Offline. Hold the queue; the fixes are timestamped by this device, so
    // they stay truthful however late they arrive.
    return session;
  }
}

interface LocationTaskData {
  locations: Location.LocationObject[];
}

TaskManager.defineTask<LocationTaskData>(LOCATION_TASK, async ({ data, error }) => {
  if (error !== null) return;

  const session = await loadTrackingSession();
  if (session === null) {
    // No session but the task fired: a leftover registration from a previous
    // install or crash. Stop it rather than letting it linger.
    await stopEverything();
    return;
  }

  if (!(await shouldKeepRunning(session))) return;

  const locations = data?.locations ?? [];
  if (locations.length === 0) return;

  const fixes = locations.map((location) => ({
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracyM: location.coords.accuracy ?? 0,
    recordedAt: location.timestamp,
  }));

  let next: TrackingSession = {
    ...session,
    queue: [...session.queue, ...fixes].slice(-MAX_QUEUE),
  };

  next = await flush(next);

  // FR-10 — move between tiers as they get closer, but only when the tier
  // actually changed: restarting the OS task costs power of its own.
  const newest = fixes[fixes.length - 1];
  if (newest !== undefined) {
    const config = trackingConfigFor(newest, session.venue);
    if (shouldReconfigure(session.tier, config.tier)) {
      try {
        await Location.startLocationUpdatesAsync(LOCATION_TASK, {
          accuracy:
            config.accuracy === 'high'
              ? Location.Accuracy.High
              : Location.Accuracy.Balanced,
          distanceInterval: config.distanceFilterM,
          timeInterval: config.minIntervalMs,
          deferredUpdatesInterval: config.deferredIntervalMs,
          deferredUpdatesDistance: config.distanceFilterM,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Sharing your ETA',
            notificationBody: 'Your dinner group can see when you will arrive.',
            notificationColor: '#0B6E63',
          },
        });
        next = { ...next, tier: config.tier };
      } catch {
        // Keep the old settings rather than dropping tracking entirely.
      }
    }
  }

  await saveTrackingSession(next);
});

interface GeofenceTaskData {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
}

/**
 * FR-14 — arrival while the app is fully suspended.
 *
 * The OS wakes us on the region crossing; the server still applies the dwell
 * rule, because one geofence entry is not the same as being at the restaurant.
 */
TaskManager.defineTask<GeofenceTaskData>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error !== null) return;
  if (data?.eventType !== Location.GeofencingEventType.Enter) return;

  const session = await loadTrackingSession();
  if (session === null) {
    await stopEverything();
    return;
  }

  const secret = await loadSecret(session.eventToken);
  if (secret === null) {
    await stopEverything();
    return;
  }

  try {
    const fix = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const result = await api.sendPositions(
      session.eventToken,
      secret,
      [{
        lat: fix.coords.latitude,
        lng: fix.coords.longitude,
        accuracyM: fix.coords.accuracy ?? 0,
        recordedAt: fix.timestamp,
      }],
      'app_background',
    );
    if (result.arrived) await stopEverything();
  } catch {
    // The next location update will carry the same news.
  }
});
