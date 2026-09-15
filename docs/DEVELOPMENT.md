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
apps/mobile      Expo app — background tracking, geofenced arrival
apps/web         Next.js — invite target, browser participation
packages/core    Shared rules: staleness, ordering, tracking tiers, stop rules
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

## The mobile app

```bash
cd apps/mobile
pnpm typecheck
pnpm exec expo config --type public          # resolves app config and plugins
pnpm exec expo export --platform ios         # bundles; catches import errors
pnpm start                                   # needs a device or simulator
```

**What cannot be verified without a device:** whether background location
actually keeps delivering with the screen off, whether the geofence fires while
the app is suspended, and what any of it costs in battery. Those are the claims
R1.3 exists to make, and they need a real phone on a real journey. Typechecking
and bundling prove the code is wired together, not that the OS behaves.

### Where the policy lives

`packages/core/src/tracking.ts` holds the tier policy (how hard the device
should work at a given distance) and `stopTrackingReason` (every reason
tracking must stop). Both are pure and tested, so the rules that matter most
are verifiable without a phone. The Expo layer maps them onto `expo-location`.

`stopTrackingReason` is checked on **every** background wake, not only where it
seemed relevant. A location task that outlives its event is a phone quietly
reporting someone's position to a group that stopped caring hours ago, so it
has a four-hour backstop that no other condition can talk it out of. The server
enforces the same window independently — it does not take the client's word for
having stopped.

### Permissions

The app asks for *When In Use* first, then *Always* behind its own disclosure
screen (PS-11). Being granted only foreground is a supported outcome, not a
failure: the app degrades, says so in the sharing indicator, and does not nag.
Both stores require that disclosure before the system prompt, and Google Play
additionally requires a declaration form and a demo video — start that during
this phase, not at submission.

## The map

`packages/core/src/map.ts` decides what goes on the map — which dots to draw
and how to frame them — and both surfaces import it, so they cannot disagree
about whether a position is worth believing. The map inherits the list's
staleness rules exactly: faded at two minutes, gone at ten. A dot sitting
confidently on a street corner is a stronger claim than a line of text, so if
anything it should expire sooner.

No route lines in v1: six overlapping polylines is noise, not information.

**Two different Mapbox tokens are involved**, which is a common first-build
trip-up:

| Token | Used by | Where |
| --- | --- | --- |
| Public (`pk.…`) | The running app, at runtime | `NEXT_PUBLIC_MAPBOX_TOKEN`, `EXPO_PUBLIC_MAPBOX_TOKEN` |
| Download (`sk.…`) | The native build, fetching the Mapbox SDK | `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` |

Without the public token both surfaces show a panel saying so and point at the
list, rather than rendering a grey rectangle. Without the download token a
native build fails at dependency resolution, before anything runs.

## Routing and ETAs

`packages/core` carries a straight-line estimator, and `apps/web/src/lib/routing.ts`
wraps it behind a provider interface alongside Mapbox.

With no `MAPBOX_TOKEN` set, the app uses the straight-line estimator — an
assumed urban speed plus a detour factor, labelled `straight_line` all the way
to the UI so nobody mistakes it for a routed answer. That is why the whole ETA
path is testable here without a Mapbox account.

With a token set, it uses the Mapbox Matrix API, grouped into one call per
travel mode rather than one per person, because routing is the only metered
cost in the product. If Mapbox fails or returns a non-Ok code, it degrades to
the estimate rather than showing the group nothing.

## Applying migrations to Supabase

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_release1_schema.sql
```

Or use the Supabase CLI (`supabase db push`) once the project is linked.
