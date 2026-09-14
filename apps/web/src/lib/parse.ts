import { badRequest } from './errors';

/**
 * Small hand-rolled parsers for request bodies. Every field a client sends is
 * checked here before it reaches a query — the API refuses, it does not
 * sanitise-and-hope.
 */

export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badRequest('Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`"${field}" is required.`, 'missing_field');
  }
  return value;
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw badRequest(`"${field}" must be a string.`);
  }
  return value;
}

export function requireNumber(
  body: Record<string, unknown>,
  field: string,
): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw badRequest(`"${field}" must be a number.`, 'missing_field');
  }
  return value;
}

export function requireLatLng(
  body: Record<string, unknown>,
): { lat: number; lng: number } {
  const lat = requireNumber(body, 'lat');
  const lng = requireNumber(body, 'lng');
  if (lat < -90 || lat > 90) throw badRequest('"lat" must be between -90 and 90.');
  if (lng < -180 || lng > 180) {
    throw badRequest('"lng" must be between -180 and 180.');
  }
  return { lat, lng };
}

/** An ISO timestamp, rejected rather than coerced if it is nonsense. */
export function requireTimestamp(
  body: Record<string, unknown>,
  field: string,
): number {
  const raw = body[field];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') {
    throw badRequest(`"${field}" must be an ISO timestamp.`, 'missing_field');
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw badRequest(`"${field}" is not a valid date.`);
  }
  return parsed;
}

/**
 * FR-7 — an event needs a timezone to render clock times correctly for
 * everyone, so we validate it rather than defaulting to the server's.
 */
export function requireTimezone(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = requireString(body, field);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw badRequest(`"${value}" is not a recognised timezone.`);
  }
  return value;
}

export function requireEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = requireString(body, field);
  if (!(allowed as readonly string[]).includes(value)) {
    throw badRequest(`"${field}" must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}
