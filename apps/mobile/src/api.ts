import type { FeedEntry, Participant, Rsvp, TravelMode } from '@wat/core';
import { API_BASE_URL } from './config';

/**
 * The native client speaks to exactly the same API as the web surface, and
 * carries the same credential as a bearer token rather than a cookie (PS-6).
 */

export interface Snapshot {
  event: {
    id: string;
    token: string;
    title: string;
    venue: { name: string; address: string; lat: number; lng: number };
    startsAt: number;
    timezone: string;
    status: 'active' | 'cancelled';
  };
  participants: Participant[];
  summary: { here: number; onTheWay: number; notStarted: number; notComing: number };
  everyoneHereBy: number | null;
  me: { id: string } | null;
  serverTime: number;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; secret?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'x-wat-client': 'native' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.secret != null) headers['authorization'] = `Bearer ${options.secret}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const shape = data as { error?: string; code?: string };
    throw new ApiError(
      response.status,
      shape.error ?? 'Something went wrong.',
      shape.code ?? 'unknown',
    );
  }
  return data as T;
}

export const api = {
  snapshot: (token: string, secret: string | null) =>
    request<Snapshot>(`/api/events/${token}`, { secret }),

  join: (token: string, displayName: string) =>
    request<{ participant: Participant; rejoined: boolean; sessionSecret?: string }>(
      `/api/events/${token}/join`,
      { method: 'POST', body: { displayName } },
    ),

  updateMe: (
    token: string,
    secret: string,
    body: {
      rsvp?: Rsvp;
      travelMode?: TravelMode;
      status?: 'not_started' | 'en_route' | 'arrived';
      sharing?: boolean;
      selfReportedEta?: string | null;
    },
  ) =>
    request<{ participant: Participant }>(`/api/events/${token}/me`, {
      method: 'PATCH', body, secret,
    }),

  feed: (token: string, secret: string | null) =>
    request<{ entries: FeedEntry[]; lastReadAt: number | null }>(
      `/api/events/${token}/messages`, { secret },
    ),

  postMessage: (
    token: string,
    secret: string,
    payload: { body?: string; quickReply?: string },
  ) =>
    request<{ entry: FeedEntry }>(`/api/events/${token}/messages`, {
      method: 'POST', body: payload, secret,
    }),

  markRead: (token: string, secret: string) =>
    request<{ ok: true }>(`/api/events/${token}/me/read`, {
      method: 'POST', secret,
    }),

  /** FR-10 — background fixes arrive in batches, oldest first. */
  sendPositions: (
    token: string,
    secret: string,
    positions: { lat: number; lng: number; accuracyM: number; recordedAt: number }[],
    source: 'app_background' | 'app_foreground',
  ) =>
    request<{ accepted: number; arrived: boolean; etaComputed: boolean }>(
      `/api/events/${token}/me/position`,
      { method: 'POST', body: { positions, source }, secret },
    ),
};
