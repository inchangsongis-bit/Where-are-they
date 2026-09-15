# Where Are They

The app your group opens when you're meeting up — who's coming, who's close,
and who owes what.

Join one event with nothing but a link and a first name. Accounts, persistent
groups, roles, and bill splitting layer on top for groups that meet more than
once.

📄 **[Product plan & requirements](docs/PLAN.md)** — also readable as a [shareable page](https://claude.ai/code/artifact/14b8865a-b0a2-4d23-8c9e-fb0f16f2570a)

## Deploying

See **[docs/DEPLOY.md](docs/DEPLOY.md)** — about 20 minutes, no phone needed.

```bash
pnpm install
DATABASE_URL=... pnpm migrate      # apply the schema, once each, safely re-run
pnpm preflight                     # check a target before trusting it
pnpm verify                        # typecheck, migrations, schema, all tests
pnpm smoke                         # walk the whole flow over real HTTP
```

## Status

Planning. Nothing built yet.

Planned as three releases: arrival and ETAs first, then groups and roles, then
bills. Native (React Native + Expo) with a web join page so the invite link
works without an install.
