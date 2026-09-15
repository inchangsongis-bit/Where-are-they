import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { ARRIVAL_RADIUS_M, trackingConfigFor, type StopReason } from '@wat/core';
import {
  clearTrackingSession, loadTrackingSession, saveTrackingSession,
} from '../storage';
import { GEOFENCE_TASK, LOCATION_TASK } from './task';

/**
 * FR-10/PS-11 — starting and stopping background tracking from the foreground.
 *
 * The permission ladder matters as much as the tracking. Both stores require an
 * in-app explanation *before* the system prompt, and Apple rejects builds that
 * ask for Always without a visible reason. So the caller shows its own screen
 * first, then calls this; and being granted only When In Use is a supported
 * outcome, not a failure — the app degrades and says so rather than nagging.
 */

export type PermissionLevel = 'denied' | 'foreground' | 'background';

export async function currentPermissionLevel(): Promise<PermissionLevel> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) return 'denied';
  const background = await Location.getBackgroundPermissionsAsync();
  return background.granted ? 'background' : 'foreground';
}

/** Call this only after showing the disclosure screen (PS-11). */
export async function requestPermissions(): Promise<PermissionLevel> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return 'denied';

  // Always is requested separately, and refusing it is fine: foreground-only
  // tracking still works, it just stops when the phone locks.
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.granted ? 'background' : 'foreground';
}

export interface StartArgs {
  eventToken: string;
  venue: { lat: number; lng: number };
  eventStartsAt: number;
  from: { lat: number; lng: number };
}

export async function startTracking(args: StartArgs): Promise<PermissionLevel> {
  const level = await currentPermissionLevel();
  if (level === 'denied') return 'denied';

  const config = trackingConfigFor(args.from, args.venue);

  await saveTrackingSession({
    eventToken: args.eventToken,
    venue: args.venue,
    eventStartsAt: args.eventStartsAt,
    startedAt: Date.now(),
    tier: config.tier,
    queue: [],
  });

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy:
      config.accuracy === 'high' ? Location.Accuracy.High : Location.Accuracy.Balanced,
    distanceInterval: config.distanceFilterM,
    timeInterval: config.minIntervalMs,
    deferredUpdatesInterval: config.deferredIntervalMs,
    deferredUpdatesDistance: config.distanceFilterM,
    pausesUpdatesAutomatically: false,
    // PS-2 — iOS shows a blue indicator while this is on, and Android gets a
    // non-dismissible notification. Both are deliberate: nobody should be
    // sharing their location without knowing it.
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Sharing your ETA',
      notificationBody: 'Your dinner group can see when you will arrive.',
      notificationColor: '#0B6E63',
    },
  });

  // FR-14 — the geofence fires even when the app is fully suspended, which is
  // what makes automatic arrival work with a phone in a pocket.
  if (level === 'background') {
    await Location.startGeofencingAsync(GEOFENCE_TASK, [
      {
        identifier: `venue:${args.eventToken}`,
        latitude: args.venue.lat,
        longitude: args.venue.lng,
        radius: ARRIVAL_RADIUS_M,
        notifyOnEnter: true,
        notifyOnExit: false,
      },
    ]);
  }

  return level;
}

export async function stopTracking(_reason: StopReason | 'user'): Promise<void> {
  for (const task of [LOCATION_TASK, GEOFENCE_TASK]) {
    try {
      if (await TaskManager.isTaskRegisteredAsync(task)) {
        if (task === LOCATION_TASK) await Location.stopLocationUpdatesAsync(task);
        else await Location.stopGeofencingAsync(task);
      }
    } catch {
      // Already stopped.
    }
  }
  await clearTrackingSession();
}

export async function isTracking(): Promise<boolean> {
  return (
    (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK)) &&
    (await loadTrackingSession()) !== null
  );
}

/**
 * Called on every app launch. An app that crashed mid-event can leave a
 * registered task with no session behind it; this is where that gets cleaned
 * up rather than left reporting into the void.
 */
export async function reconcileOnLaunch(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK);
  const session = await loadTrackingSession();

  if (registered && session === null) await stopTracking('user');
  if (!registered && session !== null) await clearTrackingSession();
}
