# Deploying

About 20 minutes, most of it waiting for accounts. Nothing here needs a phone,
and — if you take the SQL-editor route in step 1 — nothing needs anything
installed on your machine either. Two browser tabs and a card-free signup on
each of Supabase and Vercel.

Everything is verified locally except the parts that need your accounts, so if
`pnpm preflight` is happy the deploy usually is too.

> **Never paste a key into a chat, an issue, or a commit.** Every secret below
> belongs in the provider's own dashboard or in `.env.local`, which is
> gitignored.

---

## 1. Database — Supabase (5 min)

1. Create a project at [supabase.com](https://supabase.com). Any region near
   your group; the free tier is plenty for a dinner.
2. **Project Settings → Database → Connection string → URI.** Copy it and
   replace `[YOUR-PASSWORD]` with the database password you set.
3. Apply the schema. Two ways, same result:

   **Browser only** — open the **SQL Editor** in Supabase, paste the whole of
   [`supabase/schema.sql`](../supabase/schema.sql), and run it once. Nothing to
   install.

   **With the repo checked out:**

   ```bash
   DATABASE_URL='postgres://...' pnpm migrate
   ```

   Both leave the database in exactly the same state, including the
   `schema_migrations` bookkeeping — verified by diffing `pg_dump` output of a
   database built each way. So you can paste the file now and use `pnpm
   migrate` later for the next change; it will correctly do nothing about what
   is already applied.

4. Optional, if you have the repo: check it.

   ```bash
   DATABASE_URL='postgres://...' NEXT_PUBLIC_APP_URL=https://placeholder \
     CRON_SECRET=placeholder-value-long-enough pnpm preflight
   ```

Use the **pooled** connection string (port 6543) for the app, and the direct
one (5432) for migrations. Serverless functions open a lot of short-lived
connections, which is exactly what the pooler is for.

## 2. Maps and ETAs — Mapbox (3 min)

Optional. Without it, ETAs are straight-line estimates labelled as such and the
map tab explains itself. With it, ETAs are traffic-aware.

1. [account.mapbox.com/access-tokens](https://account.mapbox.com/access-tokens/)
2. Copy the **default public token** (`pk.…`) → `NEXT_PUBLIC_MAPBOX_TOKEN`.
3. Only if you later build the native app, create a **secret** token (`sk.…`)
   with the `DOWNLOADS:READ` scope → `RNMAPBOX_MAPS_DOWNLOAD_TOKEN`. This is a
   different token from the one above and the native build cannot fetch the
   Mapbox SDK without it.

## 3. Web app — Vercel (5 min)

1. Import the repository at [vercel.com/new](https://vercel.com/new).
   `vercel.json` already sets the build for this monorepo; leave the defaults.
2. Add environment variables (Production **and** Preview):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the pooled Supabase URI |
   | `NEXT_PUBLIC_APP_URL` | `https://your-project.vercel.app`, **no trailing slash** |
   | `CRON_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
   | `NEXT_PUBLIC_MAPBOX_TOKEN` | optional, from step 2 |

3. Deploy. Then set `NEXT_PUBLIC_APP_URL` to the real domain and redeploy —
   invite links are built from it, so a wrong value makes every link wrong.

### Regenerating schema.sql

After adding a migration:

```bash
pnpm migrate:bundle    # rewrites supabase/schema.sql
```

Do not edit that file by hand — it is generated, and its checksums have to
match the migration files for the runner to agree with it.

## 4. The two scheduled jobs

**Purge** (FR-19, deletes expired location data) is in `vercel.json` and runs
daily. Nothing more to do.

**Notify** (FR-18, "Priya is 5 minutes away") needs to run far more often than
that, and **Vercel's Hobby plan only runs crons once a day** — which would make
proximity notifications useless. Pick one:

- **Free:** `.github/workflows/notify.yml` runs it every 5 minutes. Add two
  repository secrets under Settings → Secrets → Actions: `APP_URL` and
  `CRON_SECRET` (the same value as Vercel's).
- **Vercel Pro:** add `{"path": "/api/cron/notify", "schedule": "* * * * *"}`
  to `vercel.json` and delete the workflow. A one-minute tick is meaningfully
  better: at five minutes, someone who goes from seven minutes out to arrived
  between ticks never triggers a proximity notification at all.

Check the purge route by hand once:

```bash
curl -X POST https://your-app.vercel.app/api/cron/purge \
  -H "authorization: Bearer $CRON_SECRET"
```

## 5. Push notifications (optional, 5 min)

Skip this and everything works except the buzzing.

**Web Push:**

```bash
pnpm --filter @wat/web exec npx web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
(`mailto:you@example.com`), and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to the same
value as the public key.

**Native:** set `PUSH_ENABLED=true`. An `EXPO_ACCESS_TOKEN` is only needed if
you turn on Expo's enhanced security mode.

## 6. Prove it works

```bash
# 1. Create an event through the API
curl -sS -X POST https://your-app.vercel.app/api/events \
  -H 'content-type: application/json' \
  -d '{"placeName":"Kisa Izakaya","placeAddress":"118 Bowery",
       "lat":40.7188,"lng":-73.9938,
       "startsAt":"'"$(date -u -d '+45 minutes' +%Y-%m-%dT%H:%M:%SZ)"'",
       "timezone":"America/New_York","organizerName":"You"}'
```

Open the `inviteUrl` it returns on your phone, join with a name, tap **I'm on
my way**, and allow location. Then open the same link on a laptop and watch
your own dot move.

That last step is the first real validation this project has had: everything
up to now is tested against a local database and a headless browser.

---

## What deployment cannot tell you

Four things still need a real phone on a real journey:

1. Whether **background location** keeps delivering with the screen off.
2. Whether the **geofence** fires while the app is suspended.
3. What any of it **costs in battery** — the targets (under 6%/hr approaching,
   under 1%/hr far out) are currently aspirations, not measurements.
4. Whether a **push notification** actually arrives.

The web surface deployed here covers 1 and 4 partially: browser location works
while the tab is open, and Web Push works if you granted it. Background
tracking is the native app's job, and that needs an EAS build.

## Rolling back

Vercel keeps every deployment; promote a previous one from the dashboard.

Migrations do **not** roll back automatically and the runner refuses to
re-apply a file that has changed since it ran. If a migration was wrong, add a
new one that corrects it rather than editing history — the checksum check
exists to stop the database and the repository quietly disagreeing.
