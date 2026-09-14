import { Pool, type PoolClient, type QueryResultRow } from 'pg';

/**
 * We talk to Postgres directly rather than through supabase-js.
 *
 * Supabase *is* Postgres, so one connection string works against both a
 * throwaway local cluster and the real project — which means every query in
 * this app is testable without credentials for a hosted service. Realtime
 * (R1.5) will use the Supabase client; data access does not need to.
 */

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool !== undefined) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === '') {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.',
    );
  }

  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    // Supabase requires TLS; a local cluster does not offer it.
    ssl: connectionString.includes('localhost') || connectionString.includes('/tmp')
      ? false
      : { rejectUnauthorized: true },
  });

  return pool;
}

export async function query<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params as unknown[]);
  return result.rows;
}

/** Exactly one row, or null. Anything else is a programming error. */
export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  if (rows.length > 1) {
    throw new Error(`Expected at most one row, got ${rows.length}`);
  }
  return rows[0] ?? null;
}

/** Runs `fn` in a transaction, rolling back on any throw. */
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** Test helper: drop the pool so a suite can close cleanly. */
export async function closePool(): Promise<void> {
  if (pool !== undefined) {
    await pool.end();
    pool = undefined;
  }
}
