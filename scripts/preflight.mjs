#!/usr/bin/env node
/**
 * Checks a deployment target before you trust it with a real dinner.
 *
 *   DATABASE_URL=... APP_URL=https://... node scripts/preflight.mjs
 *
 * Reports three levels: things that are broken, things that will silently not
 * work, and things that are fine. Exits non-zero only for the first.
 */
import pg from 'pg';

const problems = [];
const warnings = [];
const ok = [];

const env = process.env;
const appUrl = env.APP_URL ?? env.NEXT_PUBLIC_APP_URL;

// --- required ---------------------------------------------------------------

if (!env.DATABASE_URL) {
  problems.push('DATABASE_URL is not set — nothing can work without it.');
}
if (!appUrl) {
  problems.push('NEXT_PUBLIC_APP_URL is not set — invite links will be wrong.');
} else if (!/^https?:\/\//.test(appUrl)) {
  problems.push(`NEXT_PUBLIC_APP_URL ("${appUrl}") must start with http:// or https://`);
} else if (appUrl.endsWith('/')) {
  warnings.push('NEXT_PUBLIC_APP_URL has a trailing slash; it will be trimmed.');
} else {
  ok.push(`Invite links will point at ${appUrl}`);
}

if (!env.CRON_SECRET) {
  problems.push(
    'CRON_SECRET is not set — the purge and notify routes refuse to run ' +
      'without it, so nothing expires and nobody is notified.',
  );
} else if (env.CRON_SECRET.length < 24) {
  warnings.push('CRON_SECRET is short. 32 random bytes is the intent.');
} else {
  ok.push('Scheduled routes are protected by CRON_SECRET');
}

// --- optional, but silent when missing --------------------------------------

if (!env.NEXT_PUBLIC_MAPBOX_TOKEN) {
  warnings.push(
    'NEXT_PUBLIC_MAPBOX_TOKEN is not set — ETAs fall back to straight-line ' +
      'estimates and the map tab shows a panel explaining itself.',
  );
} else {
  ok.push('Mapbox is configured: routed ETAs and a real map');
}

const hasExpo = Boolean(env.EXPO_ACCESS_TOKEN || env.PUSH_ENABLED === 'true');
const hasVapid = Boolean(
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT,
);
if (!hasExpo && !hasVapid) {
  warnings.push(
    'No push is configured — notifications are planned and deduped but never ' +
      'delivered. Everything else works.',
  );
} else {
  ok.push(
    `Push configured: ${[hasExpo && 'Expo (native)', hasVapid && 'Web Push']
      .filter(Boolean)
      .join(' and ')}`,
  );
}
if (hasVapid && !env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
  problems.push(
    'VAPID keys are set but NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing — the ' +
      'browser cannot subscribe without it.',
  );
}

// --- the database itself ----------------------------------------------------

if (env.DATABASE_URL) {
  const isLocal =
    env.DATABASE_URL.includes('localhost') || env.DATABASE_URL.includes('host=/');
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();
    ok.push('Database reachable');

    const { rows: migrations } = await client.query(
      `select name from schema_migrations order by name`,
    ).catch(() => ({ rows: null }));

    if (migrations === null) {
      problems.push('No schema_migrations table — run `pnpm migrate` first.');
    } else {
      ok.push(`${migrations.length} migration(s) applied`);
    }

    const { rows: rls } = await client.query(`
      select tablename from pg_tables
       where schemaname = 'public' and rowsecurity = false
         and tablename in ('events','participants','positions','etas','messages',
                           'rate_limits','notifications_sent','message_reads')
    `);
    if (rls.length > 0) {
      problems.push(
        `Row level security is OFF on: ${rls.map((r) => r.tablename).join(', ')}`,
      );
    } else {
      ok.push('Row level security enabled on every table');
    }

    const { rows: policies } = await client.query(
      `select count(*)::int as count from pg_policies where schemaname = 'public'`,
    );
    if ((policies[0]?.count ?? 0) > 0) {
      warnings.push(
        'Policies exist on public tables. R1 expects none — the API is the ' +
          'only door until accounts arrive in R2.',
      );
    }
  } catch (error) {
    problems.push(`Could not reach the database: ${error.message}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

// --- report -----------------------------------------------------------------

const line = (symbol, text) => console.log(`  ${symbol} ${text}`);

console.log('\nPreflight\n');
if (ok.length > 0) {
  console.log('Ready:');
  ok.forEach((text) => line('✓', text));
  console.log('');
}
if (warnings.length > 0) {
  console.log('Will not work, but will not break anything either:');
  warnings.forEach((text) => line('!', text));
  console.log('');
}
if (problems.length > 0) {
  console.log('Must be fixed:');
  problems.forEach((text) => line('✗', text));
  console.log('');
  process.exit(1);
}

console.log('Good to deploy.\n');
