import { isValidEventToken } from '@wat/core';
import { ApiError, badRequest, notFound, unauthorized } from './errors';
import { findEventByToken, findParticipantBySession, type EventRecord } from './events';
import { hashSessionSecret, sessionCookieName } from './session';
import type { Participant } from '@wat/core';

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * One place where errors become responses. An ApiError carries a message
 * written for a person; anything else is logged and becomes a bare 500, so
 * internal detail never leaks into a body.
 */
export function handle(
  fn: () => Promise<Response>,
): Promise<Response> {
  return fn().catch((error: unknown) => {
    if (error instanceof ApiError) {
      return json({ error: error.message, code: error.code }, error.status);
    }
    console.error('Unhandled route error:', error);
    return json({ error: 'Something went wrong.', code: 'internal' }, 500);
  });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest('Expected a JSON body.');
  }
}

/**
 * PS-4 — validate the token's shape before it reaches a query, and answer a
 * malformed token exactly as we answer an unknown one.
 */
export async function requireEvent(token: string): Promise<EventRecord> {
  if (!isValidEventToken(token)) throw notFound();
  const event = await findEventByToken(token);
  if (event === null) throw notFound();
  return event;
}

export function sessionSecretFrom(
  request: Request,
  eventToken: string,
): string | null {
  const header = request.headers.get('cookie');
  if (header === null) return null;

  const wanted = sessionCookieName(eventToken);
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== wanted) continue;
    const value = part.slice(index + 1).trim();
    return value === '' ? null : decodeURIComponent(value);
  }
  return null;
}

/** The caller's participant record, or 401. Never trusts a client-sent id. */
export async function requireParticipant(
  request: Request,
  event: EventRecord,
): Promise<Participant> {
  const secret = sessionSecretFrom(request, event.token);
  if (secret === null) {
    throw unauthorized('Join this event first.', 'not_joined');
  }
  const participant = await findParticipantBySession(
    event.id,
    hashSessionSecret(secret),
  );
  if (participant === null) {
    throw unauthorized('Join this event first.', 'not_joined');
  }
  return participant;
}

/**
 * Best-effort client address for IP-scoped limits (PS-7). Behind Vercel the
 * left-most x-forwarded-for entry is the client; if we cannot tell, everyone
 * shares one bucket, which fails closed rather than open.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first !== undefined && first !== '') return first;
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export function setSessionCookie(
  response: Response,
  eventToken: string,
  secret: string,
  options: { secure: boolean; maxAge: number },
): Response {
  const parts = [
    `${sessionCookieName(eventToken)}=${encodeURIComponent(secret)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${options.maxAge}`,
  ];
  if (options.secure) parts.push('Secure');
  response.headers.append('set-cookie', parts.join('; '));
  return response;
}
