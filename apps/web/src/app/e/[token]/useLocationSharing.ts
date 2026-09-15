'use client';

import { shouldSendPosition, type Position } from '@wat/core';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * FR-9 — foreground location sharing on the web surface.
 *
 * Two things this hook is careful about:
 *
 * 1. It applies the shared throttle from packages/core before sending, so a
 *    phone sitting still costs nothing. The server does not re-apply it.
 * 2. It queues fixes it could not send and flushes them later, timestamped by
 *    the *client*, because the age of a fix is what the staleness rules judge —
 *    not when it happened to reach us.
 *
 * It does not pretend to work in the background. Browsers stop delivering
 * positions when the tab is hidden or the phone locks, and the honest response
 * is to let the position age visibly rather than fake continuity.
 */

const QUEUE_LIMIT = 20; // ~5 minutes of fixes, per the offline NFR for web

export type SharingError = 'denied' | 'unavailable' | 'timeout' | null;

export interface SharingState {
  supported: boolean;
  active: boolean;
  error: SharingError;
  queued: number;
  lastSentAt: number | null;
}

export function useLocationSharing(options: {
  token: string;
  enabled: boolean;
  onAfterSend?: () => void;
}) {
  const { token, enabled, onAfterSend } = options;

  const [state, setState] = useState<SharingState>({
    supported: typeof navigator !== 'undefined' && 'geolocation' in navigator,
    active: false,
    error: null,
    queued: 0,
    lastSentAt: null,
  });

  const lastSent = useRef<Position | null>(null);
  const queue = useRef<Position[]>([]);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const flush = useCallback(async () => {
    if (queue.current.length === 0) return;

    const batch = queue.current.slice();
    try {
      const response = await fetch(`/api/events/${token}/me/position`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ positions: batch, source: 'web' }),
      });
      if (!response.ok) return; // Keep the queue; try again on the next fix.

      queue.current = queue.current.slice(batch.length);
      const newest = batch[batch.length - 1];
      setState((previous) => ({
        ...previous,
        queued: queue.current.length,
        lastSentAt: newest?.recordedAt ?? previous.lastSentAt,
      }));
      onAfterSend?.();
    } catch {
      // Offline. The queue holds, and the UI will show the position ageing,
      // which is the truth.
    }
  }, [token, onAfterSend]);

  useEffect(() => {
    if (!enabled || !state.supported) {
      setState((previous) => ({ ...previous, active: false }));
      return;
    }

    let cancelled = false;

    const watchId = navigator.geolocation.watchPosition(
      (fix) => {
        if (cancelled) return;
        const position: Position = {
          lat: fix.coords.latitude,
          lng: fix.coords.longitude,
          accuracyM: fix.coords.accuracy,
          recordedAt: fix.timestamp,
        };

        // The throttle lives in packages/core so the native app cannot drift
        // from this behaviour later.
        if (!shouldSendPosition(lastSent.current, position)) return;
        lastSent.current = position;

        queue.current = [...queue.current, position].slice(-QUEUE_LIMIT);
        setState((previous) => ({ ...previous, queued: queue.current.length, error: null }));
        void flush();
      },
      (error) => {
        if (cancelled) return;
        const kind: SharingError =
          error.code === error.PERMISSION_DENIED ? 'denied'
          : error.code === error.TIMEOUT ? 'timeout'
          : 'unavailable';
        setState((previous) => ({ ...previous, error: kind, active: false }));
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );

    setState((previous) => ({ ...previous, active: true, error: null }));

    // Keeping the screen awake is the single biggest thing that keeps a browser
    // delivering positions at all. It costs battery, so it follows sharing
    // exactly and is released the moment sharing stops.
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock.current = await navigator.wakeLock.request('screen');
        }
      } catch {
        // Not available, or refused. Sharing still works; it just stops sooner.
      }
    };
    void requestWakeLock();

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock();
        void flush(); // Coming back to the tab is a chance to catch up.
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
      document.removeEventListener('visibilitychange', onVisible);
      void wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
      setState((previous) => ({ ...previous, active: false }));
    };
  }, [enabled, state.supported, flush]);

  return state;
}
