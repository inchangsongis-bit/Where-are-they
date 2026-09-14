import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe } from 'vitest';
import { getPool, query } from './db';

/**
 * Integration suites need a real Postgres. Supabase is Postgres, so the same
 * SQL runs against a throwaway local cluster — which is how these queries get
 * tested without credentials for a hosted project.
 *
 * With no DATABASE_URL the suites skip loudly rather than silently passing.
 */
export const hasDatabase = (process.env.DATABASE_URL ?? '') !== '';

export const describeWithDb: typeof describe = (hasDatabase
  ? describe
  : describe.skip) as typeof describe;

if (!hasDatabase) {
  console.warn(
    '\n  ! DATABASE_URL is not set — integration suites are SKIPPED.' +
      '\n    Run `pnpm db:test` style setup or export DATABASE_URL to include them.\n',
  );
}

const MIGRATIONS_DIR = join(process.cwd(), '..', '..', 'supabase', 'migrations');

export async function applyMigrations(): Promise<void> {
  // Migrations are not idempotent (create type, create table), so each run
  // starts from an empty schema rather than on top of the last run's.
  await getPool().query('drop schema public cascade; create schema public;');

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await getPool().query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
}

/** Wipe between tests. Cascades clear participants, positions and messages. */
export async function resetData(): Promise<void> {
  await query('truncate events, rate_limits cascade');
}

export const KISA = {
  placeName: 'Kisa Izakaya',
  placeAddress: '118 Bowery',
  lat: 40.7188,
  lng: -73.9938,
  timezone: 'America/New_York',
};

/** Extracts a Set-Cookie value so a test can behave like a returning browser. */
export function cookieFrom(response: Response, name: string): string | null {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    if (pair === undefined) continue;
    const index = pair.indexOf('=');
    if (index === -1) continue;
    if (pair.slice(0, index).trim() !== name) continue;
    return pair.slice(index + 1).trim();
  }
  return null;
}
