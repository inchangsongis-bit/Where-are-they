#!/usr/bin/env node
/**
 * Applies pending migrations to $DATABASE_URL, once each, in order.
 *
 * The raw .sql files are not re-runnable on their own (`create type` fails the
 * second time), which is fine for a throwaway test database and useless for a
 * real one. This tracks what has been applied in a `schema_migrations` table
 * and refuses to run a file that has changed since it was applied — silently
 * diverging from what is actually in the database is the worst outcome here.
 *
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs [--dry-run]
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');
const dryRun = process.argv.includes('--dry-run');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  console.error('Supabase: Project Settings -> Database -> Connection string -> URI');
  process.exit(1);
}

const isLocal =
  connectionString.includes('localhost') || connectionString.includes('host=/');

const client = new pg.Client({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: true },
});

const checksum = (sql) => createHash('sha256').update(sql).digest('hex').slice(0, 16);

try {
  await client.connect();

  await client.query(`
    create table if not exists schema_migrations (
      name        text primary key,
      checksum    text        not null,
      applied_at  timestamptz not null default now()
    )
  `);

  const { rows: applied } = await client.query(
    'select name, checksum from schema_migrations',
  );
  const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]));

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  let pending = 0;

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const sum = checksum(sql);
    const previous = appliedByName.get(file);

    if (previous !== undefined) {
      if (previous !== sum) {
        console.error(`\n✗ ${file} has changed since it was applied.`);
        console.error('  Migrations are immutable once they have run. Add a new');
        console.error('  migration that alters what this one created instead.');
        process.exit(1);
      }
      continue;
    }

    pending += 1;
    if (dryRun) {
      console.log(`would apply  ${file}`);
      continue;
    }

    process.stdout.write(`applying     ${file} ... `);
    // Each migration is one transaction: a half-applied schema is worse than
    // an unapplied one.
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query(
        'insert into schema_migrations (name, checksum) values ($1, $2)',
        [file, sum],
      );
      await client.query('commit');
      console.log('ok');
    } catch (error) {
      await client.query('rollback');
      console.log('failed');
      console.error(`\n${error.message}`);
      process.exit(1);
    }
  }

  if (pending === 0) console.log('Nothing to apply — the database is up to date.');
  else if (dryRun) console.log(`\n${pending} migration(s) pending.`);
  else console.log(`\nApplied ${pending} migration(s).`);
} finally {
  await client.end();
}
