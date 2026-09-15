'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * FR-18 — Web Push on the browser surface.
 *
 * Permission is requested at first check-in, never at page load: a site that
 * asks for notifications before you have done anything gets refused, and that
 * refusal is permanent.
 */

export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied';

// Backed by a plain ArrayBuffer rather than Uint8Array.from, because
// applicationServerKey will not accept a SharedArrayBuffer-backed view.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const view = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return view;
}

export function useWebPush(token: string) {
  const [permission, setPermission] = useState<PushPermission>('unsupported');

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission as PushPermission);
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
    if (vapidKey === '' || permission === 'unsupported') return false;

    try {
      const result = await Notification.requestPermission();
      setPermission(result as PushPermission);
      if (result !== 'granted') return false;

      const registration = await navigator.serviceWorker.register('/sw.js');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const response = await fetch(`/api/events/${token}/me/push-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pushToken: JSON.stringify(subscription) }),
      });
      return response.ok;
    } catch {
      // Blocked, unavailable, or the browser changed its mind. Notifications
      // are an upgrade, so failing to get them is never an error the user has
      // to deal with.
      return false;
    }
  }, [token, permission]);

  return { permission, subscribe };
}
