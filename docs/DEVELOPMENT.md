# Development

## Prerequisites

- Node 22+ and pnpm 10 (`corepack enable`)
- PostgreSQL 16 client + server binaries, for the schema tests
- A Supabase project and a Mapbox token, for anything that talks to a real backend

## Setup

```bash
pnpm install
cp .env.example .env.local   # then fill it in
```

## Checks

```bash
pnpm verify   # everything: typecheck, migrations, schema assertions, all tests
pnpm smoke    # boots the built app and walks the flow over real HTTP
pnpm test     # unit + integration tests (integration skips without a database)
pnpm typecheck
pnpm db:test  # migrations + schema assertions only
```

`pnpm verify` and `pnpm smoke` start their own throwaway PostgreSQL under
`.tmp/pgdata` and tear it down afterwards, so neither needs any credentials.
To run against an existing scratch database instead:

```bash
DATABASE_URL=postgres://... pnpm verify
```

Never point that at a database you care about — the suites truncate freely.

Integration tests **skip loudly** when `DATABASE_URL` is unset rather than
passing quietly, so a green run with no database is visibly a partial run.

## Layout

```
apps/mobile      Expo app (React Native)         — R1.2 onward
apps/web         Next.js — invite target, browser participation
packages/core    Shared rules: staleness, ordering, tokens, geo, validation
supabase/        Migrations and schema tests
```

### Why packages/core matters

The hybrid decision (D-6) means two clients render the same event. If the app
and the web page ever disagree about whether an ETA is stale, or about the
order people appear in, the group stops trusting both. So every rule that
both surfaces need lives in `packages/core` and is imported, never retyped —
and every one of those rules has a test.

## Why `pg` and not `supabase-js`

Supabase is Postgres, so one connection string reaches both a throwaway local
cluster and the real project. Talking to it with `pg` means every query and
every route handler is testable here, with no account and no network. The
Supabase client comes in at R1.5, where Realtime genuinely needs it.

## Database access in R1

R1 has no accounts, so there is nobody for a row-level policy to identify.
Every read and write goes through a server route handler holding the
service-role key, which validates the invite token (and PIN) first. RLS is
enabled on every table with **no policies at all**, which denies the `anon`
and `authenticated` roles outright.

This is deliberate, and it changes in R2: once accounts exist, real per-role
policies replace it and the service-role key stops being the only way in.

## Applying migrations to Supabase

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_release1_schema.sql
```

Or use the Supabase CLI (`supabase db push`) once the project is linked.
