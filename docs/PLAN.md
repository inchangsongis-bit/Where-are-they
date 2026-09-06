# Where Are They — Product Plan & Requirements

**Status:** Draft v4 — expanded scope: groups, roles, and bills
**Shareable version:** https://claude.ai/code/artifact/14b8865a-b0a2-4d23-8c9e-fb0f16f2570a
**One-line pitch:** The app your group opens when you're meeting up — who's coming, who's close, and who owes what.

---

## 0. What this is now

The original product answered one question: *when is everyone getting here?* The expanded product answers a bigger one: *everything about tonight, in one place* — arrival, the thread, and the bill.

That is a different company. It changes three things structurally:

1. **Identity stops being optional.** Roles need someone to hold them and money needs someone to owe it. "No accounts" survives only as "no accounts *to join one event*."
2. **A second object appears above the event.** The six friends are a **group** that persists; the dinner is an **event** that doesn't.
3. **Scope needs a rule, not a list.** "Anything group related" is unbounded. §4 proposes **modules** — a small framework so new capabilities slot in without redesigning the app each time.

**Positioning:** this now overlaps Splitwise (bills), Life360 (location), and the group chat itself. Arrival ETA is the wedge — it's the thing none of them do well for a one-off dinner. Bills are what make the group keep the app after the dinner ends. Neither works alone.

---

## 1. Decisions log

| # | Decision | Chosen | Consequence |
| --- | --- | --- | --- |
| D-1 | Platform | **Native from the start** (React Native + Expo) | Real background tracking; adds store review |
| D-2 | Stack | **Supabase + Mapbox** | Managed Postgres, Realtime, routing, auth, storage |
| D-3 | Map view | **In v1** | `@rnmapbox/maps` |
| D-4 | Event PIN | **In v1** | 4-digit code, one prompt per device |
| D-5 | Push notifications | **In v1** | Expo Push Service |
| D-6 | Invite link | **Hybrid** — native app + web join page | The link works without an install |
| D-7 | In-app chat | **In v1** | Reframed as an event feed, not a messenger |
| D-8 | Identity | **Guest-first, upgradeable accounts** | See §2 — the crux of the expanded scope |
| D-9 | Groups & roles | **Owner / Manager / Member / Guest** | See §3 |
| D-10 | Bills | **In scope** | See §6 and the open question in §16 |

**Timeline effect:** this is no longer a one-week project or a five-week one. Built as one release it is **~9–12 weeks**. §14 proposes shipping it as three releases instead, so each layer proves itself before the next is built.

---

## 2. Identity model (D-8)

The original onboarding — a link and a first name — is the best thing about this product. Accounts would kill it. But roles need a durable subject and money needs a durable creditor, so identity has to exist. The resolution is a ladder, not a gate.

### Tier 0 — Guest
Opens an invite link, types a name, gets a device-scoped token. **No account, no friction.**

Can: RSVP, check in, share location, post to the feed, **be included in a bill split**.
Cannot: belong to a group, hold a role, carry a balance between events, settle up.

### Tier 1 — Account
Sign in with Apple, Google, or phone OTP. Apple sign-in is mandatory if the others are offered, per App Store rules.

Required to: join a group, hold a role, carry balances across events, settle up, create a group.

### The upgrade moment
A guest is prompted to claim their identity **exactly once, at the moment it buys them something** — almost always when they first appear in a bill split: *"Marco added you to a £96 bill. Create an account to track what you're owed."* Never a launch-screen wall.

**Claiming rules.** A guest participant merges into an account when the claim comes from the device that joined, holding a valid participant token. On merge, all of that guest's participations, feed messages, and balances transfer. A participant already merged into an account cannot be re-claimed. This is the highest-risk flow in the product — a hijacked claim is a stolen debt — so it gets explicit tests before bills ship.

**Consequence for bills:** an unclaimed guest can be *included* in a split, but their balance is held against the participant record, not a person. The UI must say so — *"Sam hasn't claimed their account; this balance can't be settled yet."* Managers can still see the total.

---

## 3. Groups and roles (D-9)

A **group** is a set of people who meet more than once — "Dinner Crew", "Flat 4". It persists. An **event** belongs to a group, or stands alone for a one-off with no group behind it.

### Roles

| Role | Who |
| --- | --- |
| **Owner** | Created the group. Exactly one per group, transferable. |
| **Manager** | Trusted co-organizer. Any number. |
| **Member** | Belongs to the group, participates. |
| **Guest** | Joined one event by link. Not a group member; no role. |

### Permission matrix

| Action | Owner | Manager | Member | Guest |
| --- | :---: | :---: | :---: | :---: |
| Delete group | ✓ | | | |
| Transfer ownership | ✓ | | | |
| Rename / edit group | ✓ | ✓ | | |
| Invite to group | ✓ | ✓ | ○ | |
| Remove a member | ✓ | ✓ | | |
| Promote member → manager | ✓ | ✓ | | |
| Demote a manager | ✓ | | | |
| Create an event | ✓ | ✓ | ○ | |
| Edit / cancel any event | ✓ | ✓ | | |
| Edit own event | ✓ | ✓ | ✓ | |
| Toggle event modules | ✓ | ✓ | ● | |
| Remove someone from an event | ✓ | ✓ | | |
| Add an expense | ✓ | ✓ | ✓ | ✓ |
| Edit / delete any expense | ✓ | ✓ | | |
| Edit own expense | ✓ | ✓ | ✓ | ✓ |
| Post to the feed | ✓ | ✓ | ✓ | ✓ |
| Share own location | ✓ | ✓ | ✓ | ✓ |
| Leave | ✓* | ✓ | ✓ | ✓ |

○ = group setting, off by default  ● = only on events they created  ✓* = Owner must transfer ownership first

**Invariants**, enforced in the database, not just the UI:
- Every group has exactly one Owner at all times.
- An Owner cannot leave or be removed without transferring ownership.
- A Manager cannot demote or remove another Manager — only the Owner can.
- Nobody can promote themselves.
- Every permission check happens server-side. The UI hides what you can't do; the API refuses it.

---

## 4. The module framework

"Anything group related" is unbounded, and unbounded scope is how this stalls. The framework that makes it tractable: **an event is a shell with modules attached.** Each module owns a tab, its own data, and its own notifications.

**Rule for what qualifies as a module:** it must be *about this specific gathering* and require *state shared between the people in it*. A restaurant recommendation engine fails the second test. A "who's bringing what" list passes both.

| Module | Status | What it is |
| --- | --- | --- |
| **Arrival** | v1, always on | Check-in, live location, ETAs, map |
| **Feed** | v1, default on | Messages interleaved with system events |
| **Bills** | v1, default on | Expenses, splits, balances, settle-up |
| Poll | later | Where and when — pick a place or a time together |
| Checklist | later | Who's bringing what |
| Photos | later | Shared album, expires with the event |
| Reservation | later | Booking reference, party size, contact |

Managers toggle modules per event. A one-off drink doesn't need Bills; a group holiday needs all of it.

---

## 5. The loop

1. **Ana creates a group** — "Dinner Crew" — and invites five friends. She's the Owner; she makes Marco a Manager so he can organize when she's away.
2. **Marco creates an event:** Kisa Izakaya, Thursday 7:30. Arrival, Feed and Bills are on.
3. **The link goes in the group chat.** Group members are already in; Ana's cousin Sam opens it as a guest, types a name, and is in without an account.
4. **Everyone RSVPs.**
5. **At dinner time each taps "I'm on my way"** and the group sees one live list — who's here, who's en route with an ETA, who hasn't left.
6. **Pushes as people get close:** *"Priya is 5 minutes away."*
7. **The feed carries the rest** — *"grabbing the table"* sits next to *"Marco arrived 7:24."*
8. **Marco pays the £96 bill** and adds it, split equally among the six who came.
9. **Sam gets prompted to claim their account** so their £16 follows them.
10. **Everyone settles up** through a Venmo or bank-transfer deep link. The app records that it happened; it never touches the money.
11. **Location data is deleted hours later.** The feed goes in a week. The bill stays until it's settled.

---

## 6. Product principles

| Principle | What it means in practice |
| --- | --- |
| **The link always works** | No install and no account to join one event. The app is an upgrade; the account is an upgrade. |
| **Identity is earned, not demanded** | Ask for an account at the moment it buys the user something — almost always the first bill. |
| **Location is temporary** | Sharing runs only while checked in, stops on arrival, retains nothing. |
| **Money is permanent** | A settled bill is a record. Different data, different retention, different care. |
| **Honest about staleness** | Never a confident ETA from a 12-minute-old position. Show the age. |
| **Chat is a feed, not a messenger** | It wins only by sitting next to arrivals, ETAs and the bill. |
| **We never touch the money** | A ledger and a deep link, not a payment processor. See §16. |
| **Permissions are server-side** | The UI hides; the API refuses. |

---

## 7. Scope

### In scope for v1 (all three releases)
- **Identity:** guest participation, account sign-in (Apple / Google / phone), guest→account claiming
- **Groups:** create, edit, invite, remove, roles, ownership transfer
- **Events:** create under a group or standalone, invite link, RSVP, module toggles
- **Arrival:** check-in, background location, ETA list, map, arrival detection, auto-stop
- **Feed:** one thread per event, system events interleaved, quick replies
- **Bills:** expenses, equal and exact splits, balances, debt simplification, settle-up with two-sided confirmation, receipt photos
- **Notifications:** proximity, arrival, nudges, new message, new expense, settle-up request
- **Lifecycle:** tiered retention (§13)

### Explicitly out of scope
- **Processing payments in-app** — see §16. Ledger and deep links only.
- Itemized / per-dish bill splitting, multi-currency events, recurring expenses
- Direct messages, threads, reactions, read receipts, media in the feed (receipts excepted)
- Friend graph, discovery, public profiles, anything social beyond the group
- Restaurant search, reservations, calendar sync, recurring events
- Widgets, watch apps, trip replay, location history

---

## 8. Functional requirements

### Identity

**FR-1 — Guest participation.** Opening an invite link and entering a name (1–24 chars) creates a guest participant bound to a device token — secure store on native, signed httpOnly cookie on web. No account, no email, no prompt. Guests can do everything in §3's matrix marked for Guest.

**FR-2 — Accounts.** Sign in with Apple, Google, or phone OTP. Apple sign-in is offered wherever the others are. An account carries a display name and optional avatar, nothing more — no bio, no username, no discovery. Accounts can be deleted; deletion is refused while the user holds an unsettled non-zero balance, with the balance shown.

**FR-3 — Claiming.** A guest is prompted to claim exactly once, at the first moment it buys them something. Claiming requires the joining device's valid participant token. On merge, participations, messages, and balances transfer to the account; the guest record is retired, never deleted, so the audit trail survives. An already-claimed participant cannot be re-claimed. Every claim is logged.

### Groups & roles

**FR-4 — Groups.** Any account holder creates a group with a name and optional avatar; they become Owner. A group holds members, a role per member, settings, and its events. Cap: 50 members.

**FR-5 — Membership.** Owners and Managers invite by link or by phone/email. Invitees join as Members. Removal is immediate and revokes access to the group's events, but **not** to their own historical balances. Ownership transfer requires the Owner to nominate a Member or Manager, who must accept.

**FR-6 — Permissions.** The §3 matrix, enforced by Postgres row-level security plus server-side checks. Every mutating endpoint asserts the caller's role. The invariants in §3 are database constraints. A role change takes effect on the next request, not the next session.

### Events

**FR-7 — Events.** Created under a group (inherits its members) or standalone (guests only). Fields: title, place with coordinates, date & time, timezone, optional 4-digit PIN, enabled modules. Editable and cancellable per the matrix; cancelling notifies everyone and stops all location sharing immediately.

**FR-8 — Invite & join.** iOS Universal Links and Android App Links open the app when installed; otherwise the web join page offers "Continue in browser" (primary) and "Get the app" (secondary) — never a blocking interstitial. Installing from that page carries the token through to the app (deferred deep link). Group members joining a group event skip the name prompt.

### Arrival

**FR-9 — Check-in & sharing.** From 2 hours before start to 3 hours after, the primary action is "I'm on my way." Native requests *When In Use*, then escalates to *Always* behind an in-app pre-prompt (PS-11); granted only *When In Use*, it degrades to foreground and says so. Web is foreground-only. Updates throttle to 1 per 15s and only after moving > 25m. Travel mode — driving, walking, transit, cycling — is changeable mid-trip. Sharing stops with one tap. Permission denied → manual status plus an optional self-reported ETA.

**FR-10 — Background location (native).** Three tiers: beyond 5km, significant-location-change at balanced accuracy with a 500m filter; inside 5km, high accuracy with a 50m filter and updates deferred to ~30s; arrival, a 150m geofence that fires while suspended. Built on `expo-location` + `expo-task-manager`, an Android foreground service, and `UIBackgroundModes: location`. Stops on arrival, on expiry, and on a hard 4-hour timeout. Targets: under 6%/hr in tier 2, under 1%/hr in tier 1.

**FR-11 — ETA.** Mapbox routing, respecting mode and live traffic. Recompute at most once per 45s per participant, or on moving > 300m, batched into one Matrix call per cycle. Shown as an arrival clock time with minutes secondary. Older than 2 min → greyed stale; older than 10 min → hidden, replaced by "last seen 14 min ago". Each row shows how the person is tracked, so a gap reads as expected rather than broken.

**FR-12 — Live view.** Header with event, place, time, group summary, and the headline figure: the latest ETA among people going. Sorted Arrived → En route (soonest first) → Not started → Maybe → Can't. Rows carry name, avatar, status chip, ETA or last-seen age, travel mode, tracking source, and a late indicator.

**FR-13 — Map.** Venue pin, a labelled dot per sharing participant, auto-fit bounds. Tapping a dot selects the row and vice versa. Dots fade at 2 minutes and drop at 10. No route lines in v1.

**FR-14 — Arrival.** Geofence entry at 150m sustained 60s → `ARRIVED`, sharing stops, the app says so. A manual "I'm here" is always available. Arrival is sticky.

### Feed

**FR-15 — Event feed.** One thread per event, messages and system events interleaved — joins, RSVP changes, check-ins, arrivals, late notices, **and expenses added or settled**. Text only, 1–500 characters; no editing, no deletion, no media. Quick replies for the three things people actually send — "On my way", "Running 10 late", "Grab a table" — where "Running 10 late" also updates the sender's self-reported ETA, so the feed and the list can't contradict each other. Unread count on the tab. Rate limit 20/participant/minute.

### Bills

**FR-16 — Expenses.** Any participant adds an expense to an event with: amount, description, who paid (one payer per expense in v1), which participants it splits across, and a split method — **equal** or **exact amounts** in v1. One currency per event, fixed at creation.

- Amounts are stored as **integer minor units**. Never floats, anywhere in the stack.
- Equal splits distribute the rounding remainder deterministically — the first *n* participants by stable sort each take one extra minor unit — so the parts always sum exactly to the total.
- An optional **receipt photo**, stored in Supabase Storage with the retention in §13.
- Edits and deletes are permitted per the matrix and **always leave an audit row**. Money disputes are resolved by history.

**FR-17 — Balances & settle-up.**
- A running net balance per participant per group, and per event.
- **Debt simplification:** show the minimum set of transfers that clears the group, alongside the raw ledger. Both views; simplified by default; the raw ledger is always one tap away, because simplification is confusing until you can check it.
- **Settle-up is two-sided.** The payer marks a transfer made; the recipient confirms. Unconfirmed settlements show as pending to both, and the balance doesn't move until confirmed. This is the single most important anti-dispute mechanism in the module.
- **Payment happens outside the app** — a deep link to Venmo, PayPal.me, UPI, or a copyable bank reference, prefilled with amount and note. We record that a payment was claimed and confirmed. We never move money. See §16.
- Balances against unclaimed guests are visible but not settleable, and say so.

### Notifications

**FR-18 — Push.** Proximity ("Priya is 5 minutes away", once per participant per event), all-here, nudge (once per participant per event), late (to yourself), new message (collapsed — a 60-second burst is one notification), new expense involving you, and settle-up requested / confirmed. Permission requested at first check-in, never at launch. Per-event mute and per-category preferences. Expo Push on native, Web Push with VAPID on the web surface.

### Lifecycle

**FR-19 — Retention.** Not everything expires at the same rate — see §13.

---

## 9. Non-functional requirements

| Area | Requirement |
| --- | --- |
| **Latency** | Position updates visible to others in < 3s (p95); feed messages in < 1s (p95). |
| **Battery** | < 6%/hr in tier-2 tracking, < 1%/hr in tier 1. Measured on real devices, not estimated. |
| **Cold start** | App launch to live view in < 2s on a mid-range device. |
| **Money correctness** | Splits always sum to the total, to the minor unit. Balances are derived from the ledger, never stored as a mutable running total. Every expense mutation is an append-only audit row. This is a correctness requirement, not a quality goal. |
| **Permission correctness** | Every mutating endpoint asserts role server-side. A test exists for every ✓ and every blank in §3's matrix. |
| **Availability** | Best-effort. The list degrades to "last known" when realtime drops and reconnects on its own. |
| **Offline** | 30 minutes of queued positions on native, 5 on web. Expenses queue offline and reconcile on reconnect; conflicting edits resolve last-write-wins with both versions in the audit trail. |
| **Accessibility** | WCAG 2.1 AA on web, platform equivalents on native. Status never by colour alone; 44px targets; every row, map annotation, and currency figure labelled. |
| **Devices** | iOS 16+, Android 10+. Web on iOS Safari 16+, Chrome Android 110+. |
| **Cost** | Under $25/month at small scale, plus $99/yr Apple and $25 one-off Google Play. |

---

## 10. Privacy & security

- **PS-1** — Location is shared only while explicitly en route, and only with participants of that one event.
- **PS-2** — Sharing stops automatically on arrival and expiry. A persistent in-app indicator, plus Android's non-dismissible foreground-service notification.
- **PS-3** — No location history: latest position plus at most a 10-minute rolling trail.
- **PS-4** — Invite tokens are bearer credentials: 128+ bits, URL-safe, non-sequential. Web pages carry `noindex` and `Referrer-Policy: no-referrer`.
- **PS-5** — Optional 4-digit event PIN, server-verified, 5 attempts per device per hour.
- **PS-6** — Identity tokens live in the platform secure store or an httpOnly SameSite=Lax cookie. Never client-controlled.
- **PS-7** — Rate limits: join 10/hr/IP, positions 6/min/participant, messages 20/min/participant, expenses 30/hr/participant, creation 20/hr/IP.
- **PS-8** — Coordinates rounded server-side to ~5 decimals. No reverse-geocoded addresses stored or shown.
- **PS-9** — Plain-language disclosure at every permission prompt.
- **PS-10** — No third-party analytics or ad SDKs anywhere in the product.
- **PS-11** — Background location disclosure shown in-app *before* the system prompt. Apple wants it justified in review notes; Google Play wants a declaration form plus a demo video. Common rejection cause; budget for it.
- **PS-12** — Push tokens are per-device, revoked on leave, deleted with the event.
- **PS-13** — Feed messages are event-scoped, never indexed, never used to build a profile. Bodies escaped on render, length-capped, links rendered as plain text.
- **PS-14** — **Financial records are the most sensitive data here.** Expenses, balances, and settlements are visible only to the event's participants. Receipt images are served from short-lived signed URLs, never public buckets. No amount ever appears in a push notification preview beyond a rounded figure the recipient already knows.
- **PS-15** — **Claiming is an attack surface.** A guest→account merge requires the joining device's token, is single-use, is logged with device and IP, and is rate-limited. A failed claim never reveals whether the participant exists.
- **PS-16** — **Role escalation is audited.** Every promotion, demotion, removal, and ownership transfer writes an immutable audit row visible to the group's Owner.
- **PS-17** — Payment deep links are constructed client-side from user-entered handles and never stored server-side beyond the handle itself. No card, bank, or account numbers are ever collected. See §16.

---

## 11. Architecture

pnpm monorepo: `apps/mobile` (Expo), `apps/web` (Next.js), `packages/core` (types, permission matrix, split maths, ETA and staleness rules — written once, imported by both).

| Layer | Choice | Why |
| --- | --- | --- |
| Native client | React Native + Expo, TypeScript, Expo Router | One codebase both platforms; EAS builds and submits |
| Web surface | Next.js 15 on Vercel | Invite target, browser participation, desktop creation |
| Shared logic | `packages/core` | Permission checks and split maths must not exist twice |
| Auth | Supabase Auth (Apple, Google, phone OTP) | Ships the hard parts; integrates with row-level security |
| Database | Supabase Postgres | RLS is how §3's matrix gets enforced at the data layer |
| Realtime | Supabase Realtime | Positions, feed, and balance changes on one channel per event |
| File storage | Supabase Storage | Receipt images behind signed URLs |
| Background location | `expo-location` + `expo-task-manager` | The reason for D-1 |
| Push | `expo-notifications` + Expo Push | Avoids raw APNs / FCM credentials |
| Maps | `@rnmapbox/maps` / Mapbox GL JS | One style URL for both surfaces |
| Routing / places | Mapbox Directions, Matrix, Search | Traffic-aware, generous free tier |
| Money maths | Integer minor units in `packages/core` | No float arithmetic anywhere |
| Builds | EAS Build + EAS Submit | Store pipeline without a Mac in the loop |
| Scheduled jobs | Vercel Cron → authenticated routes | Tiered retention (§13), ETA cycles, settle-up reminders |

---

## 12. Data model

```
accounts                               -- FR-2
  id                uuid pk            -- Supabase auth user id
  display_name      text
  avatar_url        text null
  created_at        timestamptz

groups                                 -- FR-4
  id                uuid pk
  name              text
  avatar_url        text null
  owner_account_id  uuid fk -> accounts        -- exactly one, enforced
  members_can_invite      bool default false   -- the ○ in §3
  members_can_create_event bool default false
  default_currency  char(3)
  created_at        timestamptz

group_members                          -- FR-5
  group_id          uuid fk -> groups
  account_id        uuid fk -> accounts
  role              enum(owner, manager, member)
  joined_at         timestamptz
  pk (group_id, account_id)
  -- constraint: exactly one role=owner per group

events                                 -- FR-7
  id                uuid pk
  group_id          uuid fk null       -- null = standalone event
  created_by        uuid fk -> accounts
  token             text unique        -- 128-bit invite credential
  pin_hash          text null
  title             text
  place_name / place_address           text
  place_lat / place_lng                double precision
  starts_at         timestamptz
  timezone          text
  currency          char(3)            -- fixed at creation, FR-16
  status            enum(active, cancelled)
  location_purge_at / feed_purge_at / expires_at   timestamptz

event_modules                          -- §4
  event_id          uuid fk
  module            enum(arrival, feed, bills)
  enabled           bool
  pk (event_id, module)

participants                           -- FR-1: a person *in one event*
  id                uuid pk
  event_id          uuid fk
  account_id        uuid fk null       -- null while still a guest
  claimed_at        timestamptz null   -- FR-3
  display_name      text
  color             text
  rsvp              enum(pending, going, maybe, cant)
  status            enum(not_started, en_route, arrived)
  travel_mode       enum(driving, walking, transit, cycling)
  tracking_source   enum(app_background, app_foreground, web, manual)
  sharing           bool
  self_reported_eta timestamptz null
  arrived_at        timestamptz null
  device_token_hash text
  push_token        text null
  muted             bool

positions / etas                       -- as before; latest + 10-min trail only

messages                               -- FR-15
  id                bigserial pk
  event_id          uuid fk
  participant_id    uuid fk null       -- null for system events
  kind              enum(text, joined, rsvp, checked_in, arrived, late,
                         expense_added, settled)
  body              text null          -- 1..500 chars for kind=text
  meta              jsonb null
  created_at        timestamptz
  index (event_id, created_at)

expenses                               -- FR-16
  id                uuid pk
  event_id          uuid fk
  created_by        uuid fk -> participants
  paid_by           uuid fk -> participants
  amount_minor      bigint             -- integer minor units, never float
  currency          char(3)
  description       text
  split_method      enum(equal, exact)
  receipt_path      text null          -- Supabase Storage, signed URLs only
  created_at        timestamptz
  deleted_at        timestamptz null   -- soft delete; history survives

expense_shares
  expense_id        uuid fk
  participant_id    uuid fk
  amount_minor      bigint             -- parts always sum to expenses.amount_minor
  pk (expense_id, participant_id)

settlements                            -- FR-17, two-sided
  id                uuid pk
  event_id          uuid fk
  from_participant  uuid fk
  to_participant    uuid fk
  amount_minor      bigint
  method            enum(venmo, paypal, bank, cash, other)
  claimed_at        timestamptz        -- payer says they paid
  confirmed_at      timestamptz null   -- recipient agrees; balance moves here
  created_at        timestamptz

audit_log                              -- PS-16, FR-16
  id                bigserial pk
  actor_account_id  uuid fk null
  scope             enum(group, event, expense, role, claim)
  scope_id          uuid
  action            text
  before / after    jsonb null
  ip / user_agent   text null
  created_at        timestamptz
```

**Balances are never stored.** They are derived from `expense_shares` minus confirmed `settlements`, in a database view. A stored running total is a bug waiting for a race condition.

**Row-level security** implements §3: membership and role are joined into every policy. A participant may write only their own row, their own positions, and expenses they're permitted to touch.

---

## 13. Tiered retention

Different data, different clocks. This is a design decision, not an oversight.

| Data | Retained | Why |
| --- | --- | --- |
| Positions | Deleted 3h after last arrival, or 6h after start | The most sensitive, least durable data in the product |
| Live ETAs | With positions | Derived, meaningless afterwards |
| Feed messages | 30 days after the event | Long enough to settle an argument, short enough not to be an archive |
| Receipt images | Until settled + 90 days | Someone will need to check the bill |
| Expenses, shares, settlements | Until settled + 12 months | Financial records people expect to be able to look back at |
| Audit log | 24 months | Disputes and role questions surface late |
| Groups, accounts | Until deleted by the user | Account deletion blocked while an unsettled balance exists |

Enforced by scheduled jobs, not query filters. Device-side location tasks and geofences are unregistered on expiry, on the device.

---

## 14. Build plan — three releases

Building all of this before anyone uses any of it is the main way this fails. Ship it in three.

### Release 1 — "Who's coming, and when?" *(~4–5 weeks)*
The original product, complete and standalone. Guests only, no accounts, no groups, no bills.

- **R1.0 Foundations** *(~1 day)* — monorepo, Expo dev client, Next.js, Supabase, EAS.
- **R1.1 Events, invite, RSVP** *(~3–4 days)* — both surfaces, universal links, deferred deep link, PIN. **Done when:** five people join from a chat link, some in-app, some in-browser.
- **R1.2 Check-in, foreground location, ETA** *(~3 days)* — **Done when:** two phones across town show plausible, updating ETAs.
- **R1.3 Background tracking** *(~3–4 days)* — tiered accuracy, foreground service, *Always* flow, geofenced arrival, measured battery. The hardest phase. **Done when:** a pocketed phone on a 30-minute drive produces a continuous ETA and auto-arrives.
- **R1.4 Map** *(~2 days)*
- **R1.5 Feed** *(~2–3 days)*
- **R1.6 Push** *(~2–3 days)*
- **R1.7 Robustness & privacy** *(~2 days)*
- **R1.8 Store submission** *(~2 days + 1–7 waiting)* — start the Play background-location declaration back at R1.3; it gates release and reviews slowly.

**Ship it to the actual friend group and use it for real dinners before starting R2.**

### Release 2 — "Our group" *(~2–3 weeks)*
- **R2.1 Accounts** *(~4 days)* — Apple, Google, phone OTP; account settings; deletion.
- **R2.2 Claiming** *(~2 days)* — the guest→account merge, with the security work in PS-15 and tests before anything depends on it.
- **R2.3 Groups & membership** *(~4 days)* — create, edit, invite, remove, ownership transfer.
- **R2.4 Roles & permissions** *(~4 days)* — the §3 matrix in RLS and in `packages/core`, with a test per cell.
- **R2.5 Events under groups** *(~2 days)* — module toggles, members skip the name prompt.

### Release 3 — "Who owes what" *(~3–4 weeks)*
- **R3.1 Expenses** *(~4 days)* — add, edit, delete, equal and exact splits, integer-minor-unit maths with the rounding rule, audit rows.
- **R3.2 Receipts** *(~2 days)* — capture, upload, signed URLs, retention.
- **R3.3 Balances** *(~3 days)* — derived view, per-event and per-group, debt simplification with the raw ledger one tap away.
- **R3.4 Settle-up** *(~4 days)* — two-sided confirmation, payment deep links, unclaimed-guest handling, reminders.
- **R3.5 Bills notifications & feed integration** *(~2 days)*
- **R3.6 Hardening** *(~3 days)* — the money-correctness NFRs, dispute paths, a full pass on PS-14 through PS-17.

**Total: ~9–12 weeks**, plus store review latency.

### Later, module by module
Poll, Checklist, Photos, Reservation — each is a module against the §4 framework, roughly a week apiece, and each should be justified by a group actually asking for it.

---

## 15. Definition of done

**Release 1** — the six friends use it for a real dinner: everyone joined from the link including whoever didn't install, ETAs landed within ±5 minutes with phones in pockets, the group answered "should we order?" in the feed, and nobody's location was still shared the next morning.

**Release 2** — the group exists a month later without anyone re-sending a link, a Manager organized a dinner while the Owner was away, and no one could do anything the §3 matrix says they can't.

**Release 3** — a real bill was split, settled, and confirmed by both sides; the balances came to zero; nobody opened Splitwise; and the arithmetic was right to the penny.

---

## 16. The one open decision: how money works

**Recommendation: a ledger, not a wallet.** The app records who owes what and hands off to Venmo, PayPal, UPI, or a bank transfer via a prefilled deep link. It never holds, moves, or touches funds.

This is not a technical shortcut — it is the difference between an app and a regulated financial business. Moving money on users' behalf means money-transmitter licensing in most US states, e-money authorisation in the UK and EU, KYC obligations, PCI scope, fraud and chargeback handling, and a support burden that dwarfs the rest of the product. Splitwise, which is the direct comparison, spent a decade as a pure ledger for exactly this reason.

**If you eventually want in-app payment**, the realistic path is an integration where a licensed provider is the merchant of record and you never take custody. That is a company-level decision with legal review, not a sprint. It should not gate Release 3.

**Open question:** confirm ledger-only for v1, or is in-app payment a requirement you want scoped?

---

## 17. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **Scope has tripled** — a 1-week idea is now a 3-month product, and nothing ships | **High** | The three-release plan in §14. R1 is a complete, useful product on its own. Do not start R2 before R1 has survived real dinners |
| **Money correctness bugs** destroy trust permanently — a wrong balance is unforgivable in a way a wrong ETA isn't | **High** | Integer minor units, deterministic rounding, derived-never-stored balances, an audit row per mutation, a test suite that asserts splits sum exactly |
| **Regulatory exposure** if the product drifts toward holding funds | **High** | §16's ledger-only line, held explicitly |
| **Claiming hijack** — a stolen merge is a stolen debt | **High** | PS-15: device-token requirement, single use, logged, rate-limited, tested before bills ship |
| **Install friction kills adoption** | **High** | The hybrid web surface. Guests never need an account or an app |
| **Store review of background location** — Play needs a declaration and a demo video | **High** | Start at R1.3; make the PS-11 disclosure unmissable |
| **Permission bugs** — a Member doing a Manager's job, or worse | Medium | §3's invariants as database constraints; a test per matrix cell |
| **The feed loses to the group chat** | Medium | System events give it content from the start; quick replies that change state. Empty after two real dinners → cut it |
| **Competing with Splitwise and Life360 at once** | Medium | Arrival is the wedge; bills are retention. Neither is the whole pitch |
| **Battery drain** turns into uninstalls | Medium | Tiered accuracy, deferred updates, geofenced arrival, measured on real hardware |
| **Two surfaces drift apart** | Medium | `packages/core` holds every shared rule, permission checks and split maths included |
