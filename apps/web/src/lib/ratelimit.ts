import { queryOne } from './db';
import { tooManyRequests } from './errors';

/**
 * PS-7 — the limits from the plan, in one place so a route cannot quietly pick
 * a looser number than the requirement.
 */
export const LIMITS = {
  /** Joining an event: 10 per hour per IP. */
  join: { limit: 10, window: '1 hour' },
  /** Creating events: 20 per hour per IP. */
  createEvent: { limit: 20, window: '1 hour' },
  /** PIN attempts: 5 per hour per device. The one that actually matters. */
  pin: { limit: 5, window: '1 hour' },
  /** Position updates: 6 per minute per participant. */
  position: { limit: 6, window: '1 minute' },
  /** Feed messages: 20 per minute per participant. */
  message: { limit: 20, window: '1 minute' },
} as const;

export type LimitName = keyof typeof LIMITS;

interface ConsumeRow {
  allowed: boolean;
  used: number;
  retry_after_s: number;
}

export interface RateLimitResult {
  allowed: boolean;
  used: number;
  retryAfterSeconds: number;
}

export async function consume(
  name: LimitName,
  subject: string,
): Promise<RateLimitResult> {
  const { limit, window } = LIMITS[name];
  const row = await queryOne<ConsumeRow>(
    'select allowed, used, retry_after_s from consume_rate_limit($1, $2, $3::interval)',
    [`${name}:${subject}`, limit, window],
  );

  if (row === null) {
    // The function always returns a row; if it somehow did not, failing closed
    // is the only safe choice for something guarding a 4-digit PIN.
    return { allowed: false, used: limit, retryAfterSeconds: 60 };
  }

  return {
    allowed: row.allowed,
    used: row.used,
    retryAfterSeconds: row.retry_after_s,
  };
}

/** Consume and throw a 429 if the caller is over. */
export async function enforce(name: LimitName, subject: string): Promise<void> {
  const result = await consume(name, subject);
  if (!result.allowed) {
    throw tooManyRequests(
      `Too many attempts. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} min.`,
    );
  }
}
