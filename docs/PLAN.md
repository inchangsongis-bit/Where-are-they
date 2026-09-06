# Where Are They — Product Plan & Requirements

**Status:** Draft v2 — decisions made, one open conflict
**Shareable version:** https://claude.ai/code/artifact/14b8865a-b0a2-4d23-8c9e-fb0f16f2570a
**One-line pitch:** Send one link to your dinner group; everyone checks in, shares location, and sees who's arriving when.

---

## 0. Decisions log

| # | Decision | Chosen | Consequence |
| --- | --- | --- | --- |
| D-1 | Platform | **Native from the start** (React Native + Expo) | Real background tracking. Adds App Store + Play Store review, and see §1.1 |
| D-2 | Stack | **Supabase + Mapbox** | Managed Postgres, Realtime, routing. Unchanged by going native |
| D-3 | Map view | **In v1** | `@rnmapbox/maps`, ~2 days |
| D-4 | Event PIN | **In v1** | 4-digit code, one prompt per device |
| D-5 | Push notifications | **In v1** | Much cheaper on native than web — Expo Push Service |

**Timeline effect:** the web-first plan was ~1 week to v1. This one is **~3.5–5 weeks of build**, plus 1–7 days of store review latency that can't be compressed. That is the honest cost of the choices above, and it is a reasonable trade if background tracking is the point of the product.

### 1.1 The conflict these decisions create — needs a call

The founding premise is **"send one link, no install."** Native breaks that: every friend must install an app from a store before dinner, which for a six-person one-off dinner is the difference between five people participating and two.

**Recommended resolution — the hybrid:** keep a thin web page as the invite target. Anyone opening the link can RSVP, check in, and share foreground location in the browser immediately. The native app is the *upgrade* for people who want reliable background tracking and push. The link works for everyone; the app is opt-in.

This costs one extra surface to build (~3 days) but preserves the thing that makes the product work at all. The alternative — native-only, everyone installs — is cheaper to build and much more expensive to adopt.

**This plan assumes the hybrid.** If you'd rather go native-only, §5 and §9 shrink and the adoption risk in §12 gets much larger.

---

## 2. The loop

Six friends are meeting for dinner at 7:30pm.

1. **Ana** creates an event: place, date, time.
2. She gets a link and drops it in the group chat.
3. Each friend opens the link — in the app if they have it, in the browser if they don't — types their name, and RSVPs.
4. Around dinner time each taps **"I'm on my way"** and grants location access.
5. Everyone sees one live list: who's still home, who's en route with an ETA, who has arrived. App users keep updating in the background; browser users update while the page is open.
6. As each person gets close, the group gets a push: *"Priya is 5 minutes away."*
7. When the last person arrives, sharing stops automatically and the data is deleted.

---

## 3. Product principles

| Principle | What it means in practice |
| --- | --- |
| **The link always works** | No install required to participate. The app is an upgrade, never a gate. |
| **No accounts** | A link and a first name is the entire onboarding, on both surfaces. |
| **Location is temporary** | Sharing runs only while you're checked in, stops on arrival, and retains nothing afterward. |
| **Honest about staleness** | Never show a confident ETA computed from a 12-minute-old position. Show the age. |
| **Background is a feature, not a promise** | App users get continuous tracking. Browser users get honest gaps. The UI shows which. |
| **One screen** | The live view is the product. Everything else is setup. |

---

## 4. Scope

### In scope for v1
- Create an event (title, place, time)
- Shareable invite link that opens the app if installed, the web page if not
- Join by name, RSVP — on either surface
- Check in, share location, mark arrived
- **Background location tracking** (native app)
- Live participant list with ETA, sorted by arrival order
- **Map view** with venue pin and live participant dots
- **Push notifications** — arrival proximity, nudges
- **Optional 4-digit event PIN**
- Automatic arrival detection and auto-stop
- Automatic data expiry

### Explicitly out of scope for v1
- User accounts, friends lists, contacts, event history
- Chat / messaging (the group already has a group chat)
- Bill splitting, restaurant search, reservations
- Recurring events, calendar sync
- Android/iOS widgets, watch apps
- Live location *history* playback or trip replay

---

## 5. Functional requirements

### FR-1 — Create event
- Fields: **title** (optional, defaults to "Dinner"), **place** (required), **date & time** (required), **organizer name** (required).
- Place is entered via autocomplete and resolves to `{name, address, lat, lng}`. A place with no coordinates is rejected — coordinates are what make ETAs possible.
- Optional **4-digit PIN** (D-4), set at creation, off by default.
- On submit, returns an invite link containing an unguessable event token.
- The creator is added automatically with RSVP = Going.
- Available on both surfaces; the web page is the more likely creation surface since the organizer often plans on a laptop.

### FR-2 — Invite, install, and join
- The invite link is the only credential. Anyone holding it (plus the PIN, if set) can view and join.
- **Link routing:** iOS Universal Links and Android App Links open the native app when installed. Otherwise the link lands on the web join page, which offers "Continue in browser" (primary) and "Get the app" (secondary). Never an interstitial that blocks browser users.
- **Deferred deep link:** if someone installs the app from that page, the app opens directly into the right event — carry the token through install.
- New device shows event details + "What's your name?" Free text, 1–24 characters; duplicates get a disambiguating suffix.
- PIN, if set, is requested once per device and cached.
- Each joined device gets a long-lived participant token so returning restores identity. On native this lives in the secure store; on web, a signed httpOnly cookie.
- Participants can rename or leave. Soft cap of **20**; the design targets 4–10.

### FR-3 — RSVP
- Three states: **Going**, **Maybe**, **Can't make it**. Default **Pending** until answered.
- Visible to all, changeable any time before the event.

### FR-4 — Check-in & location sharing
- From ~2 hours before start until 3 hours after, the primary action is **"I'm on my way."**
- Tapping it requests location permission and sets status to `EN_ROUTE`.
- **Native:** requests *When In Use* first, then escalates to *Always* with an in-app pre-prompt explaining exactly why (see PS-11). If the user grants only *When In Use*, the app degrades to foreground-only and says so — it never nags.
- **Web:** browser geolocation, foreground only, with the staleness handling from FR-5.
- Client sends `{lat, lng, accuracy, timestamp}` throttled: at most 1 update per 15s, and only after moving > 25m.
- Travel mode — driving (default), walking, transit, cycling — affects ETA and is changeable mid-trip.
- Stop sharing at any time with one tap; status stays `EN_ROUTE` with no live position.
- If permission is denied on either surface, status is still settable manually with an optional self-reported ETA.

### FR-5 — Background location (native)
Continuous background GPS is the reason for going native, and also the fastest way to drain a battery and get rejected from a store. The tiered approach:

- **Tier 1 — far away (> 5km):** significant-location-change / `Balanced` accuracy with a 500m distance filter. Cheap, coarse, enough for a "still 40 minutes out" ETA.
- **Tier 2 — approaching (< 5km):** `HighAccuracy` with a 50m distance filter and deferred updates batched to ~30s.
- **Tier 3 — arrival:** a **geofence** at 150m around the venue triggers arrival detection even if the app is fully suspended.
- Implemented with `expo-location`'s `startLocationUpdatesAsync` + `TaskManager`, an Android foreground service with a persistent notification, and `UIBackgroundModes: location` on iOS.
- Tracking **stops itself** on arrival, on event expiry, and on a hard 4-hour safety timeout. A location task that outlives its event is a bug with real-world consequences.
- Target: under 6% battery per hour in Tier 2, under 1% per hour in Tier 1.

### FR-6 — ETA
- Travel time from current position to the venue via Mapbox, respecting travel mode and live traffic.
- Recompute at most **once per 45 seconds per participant**, or immediately after moving > 300m. All participants batch into a single Matrix call per cycle.
- Display as an **arrival clock time** ("arrives 7:34") with minutes secondary. Clock times coordinate a group better than durations.
- Position older than **2 min** → ETA greyed as stale. Older than **10 min** → ETA hidden, show "last seen 14 min ago".
- Each row shows *how* the person is tracked (app / browser) so a gap reads as expected rather than broken.
- If routing is unavailable, fall back to straight-line distance ÷ mode speed, clearly labelled.

### FR-7 — Live view
- Header: event, place, time, and a group summary — *"3 here · 2 on the way · 1 pending"*.
- Headline figure: the latest ETA among people going — when the group is actually complete.
- List sorted **Arrived → En route** (soonest first) **→ Not started → Maybe → Can't make it**.
- Each row: name, avatar, status chip, ETA or last-seen age, travel mode, tracking source, and a late indicator when the ETA falls after start time.
- Real-time updates, no manual refresh.

### FR-8 — Map view (D-3)
- Second tab. Venue pin, a labelled dot per sharing participant, auto-fit bounds on all active participants.
- Tapping a dot selects that person's row; tapping a row centres their dot.
- Dots carry the same staleness treatment as the list — faded at 2 minutes, dropped at 10.
- No route lines in v1: six overlapping polylines is noise, not information.
- `@rnmapbox/maps` on native, Mapbox GL JS on web, one shared style URL.

### FR-9 — Push notifications (D-5)
- **Arrival proximity:** when a participant crosses 5 minutes' ETA, notify everyone else once — *"Priya is 5 minutes away."* One notification per participant per event.
- **All here:** when the last Going participant arrives.
- **Nudge:** a Going participant who hasn't checked in by start time can be nudged once by any other participant, rate-limited to one per participant per event.
- **Late:** if your own ETA slips past the start time, you get told — you're the one who can act on it.
- Permission requested at first check-in, not at app launch. Declining is remembered and never re-prompted in the same event.
- Per-event mute toggle. Quiet by default after the event ends.
- Delivered via **Expo Push Service** (native) and Web Push with VAPID keys (web surface, best-effort).

### FR-10 — Arrival
- **Automatic:** geofence entry at 150m sustained for 60 seconds → `ARRIVED`, sharing stops, the app says so.
- **Manual:** an "I'm here" button is always available, covering GPS drift indoors and large venues.
- Arrival is sticky — it does not revert if the person steps outside.

### FR-11 — Lifecycle & expiry
- Location data deleted **3 hours after** the last arrival, or **6 hours after** start — whichever comes first.
- Event record deleted **7 days** after start.
- Background location tasks and geofences are unregistered on expiry, on the device, not just server-side.
- Enforced by a scheduled job, not merely a query filter.

---

## 6. Non-functional requirements

| Area | Requirement |
| --- | --- |
| **Latency** | A position update is visible to others in < 3s (p95). |
| **Battery** | < 6%/hr in Tier 2 tracking, < 1%/hr in Tier 1. Measured on a real mid-range Android and an iPhone, not estimated. |
| **Data** | < 500KB per participant for a 45-minute trip. |
| **Cold start** | Native app to live view in < 2s on a mid-range device. |
| **Availability** | Best-effort. The list degrades to "last known" when realtime drops, and reconnects on its own. |
| **Offline** | Queue up to 30 minutes of positions on native (a tunnel, a dead zone) and 5 minutes on web; flush on reconnect. Positions timestamped by the *client*. |
| **Accessibility** | WCAG 2.1 AA on web, equivalent platform standards on native. Status never conveyed by colour alone, 44px targets, screen-reader labels on every row and map annotation. |
| **Devices** | iOS 16+, Android 10+. Web fallback: iOS Safari 16+, Chrome Android 110+. |
| **Cost** | Under $10/month at hobby scale, plus $99/yr Apple Developer and $25 one-off Google Play. |

---

## 7. Privacy & security

This app shares people's real-time physical location, and now does so in the background. That raises the bar.

- **PS-1** — Location is shared only while a participant is explicitly `EN_ROUTE`, and only with participants of that one event.
- **PS-2** — Sharing stops automatically on arrival and on expiry. A persistent, always-visible indicator shows when you are sharing — plus the Android foreground-service notification, which is not dismissible by design.
- **PS-3** — No location history. Store the latest position per participant plus at most a 10-minute rolling trail for the map. Purge per FR-11.
- **PS-4** — The invite token is a bearer credential: **≥128 bits of entropy**, URL-safe, non-sequential. Web pages carry `noindex` and `Referrer-Policy: no-referrer`.
- **PS-5** — Optional 4-digit event PIN (D-4), rate-limited to 5 attempts per device per hour, verified server-side.
- **PS-6** — Participant identity is a signed token in the platform secure store (native) or an httpOnly SameSite=Lax cookie (web). Never a client-controlled ID.
- **PS-7** — Rate limits: join 10/hr/IP, positions 6/min/participant, event creation 20/hr/IP, nudges 1/participant/event.
- **PS-8** — Coordinates rounded server-side to ~5 decimal places. No reverse-geocoded street addresses stored or shown.
- **PS-9** — Plain-language disclosure at the permission prompt: who sees your location, for how long, and when it stops.
- **PS-10** — No third-party analytics or ad SDKs in the app or on any page that handles location.
- **PS-11** — **Background location disclosure.** Both stores require an in-app explanation shown *before* the system prompt, stating what background access is used for and that it stops on arrival. Apple requires the justification in App Review notes; Google Play requires a declaration form plus a **demo video** showing the in-app disclosure and the feature in use. Budget for this — it is a common rejection cause and the Play review can take over a week.
- **PS-12** — Push tokens are per-device, revoked on leave, and deleted with the event.

---

## 8. Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| **Native client** | React Native + Expo (managed), TypeScript, Expo Router | One codebase for iOS and Android; EAS handles builds and submission |
| **Background location** | `expo-location` + `expo-task-manager` | The reason for D-1 |
| **Geofencing** | `expo-location` region monitoring | Arrival detection while suspended |
| **Push** | `expo-notifications` + Expo Push Service | Avoids handling raw APNs/FCM credentials |
| **Native maps** | `@rnmapbox/maps` | Same vendor and style as web |
| **Web surface** | Next.js 15 on Vercel | Invite target, browser participation, event creation on desktop |
| **Shared logic** | A `packages/core` workspace — types, ETA formatting, staleness rules, API client | Keeps the two surfaces from drifting |
| **Database** | Supabase Postgres | Managed, free tier, real SQL, row-level security |
| **Realtime** | Supabase Realtime | Works from both React Native and the browser |
| **Routing / places** | Mapbox Directions, Matrix, Search | 100k req/mo free, traffic-aware |
| **Builds & submission** | EAS Build + EAS Submit | Store pipeline without a Mac in the loop |
| **Cleanup** | Vercel Cron → authenticated purge route | Enforces FR-11 |

Monorepo: `apps/mobile` (Expo), `apps/web` (Next.js), `packages/core` (shared). pnpm workspaces.

---

## 9. Data model

```
events
  id                uuid pk
  token             text unique        -- 128-bit, URL-safe, the invite credential
  pin_hash          text null          -- PS-5
  title             text
  place_name        text
  place_address     text
  place_lat         double precision
  place_lng         double precision
  starts_at         timestamptz
  timezone          text
  location_purge_at timestamptz        -- FR-11
  expires_at        timestamptz        -- FR-11

participants
  id                uuid pk
  event_id          uuid fk -> events
  display_name      text
  color             text
  is_organizer      bool
  rsvp              enum(pending, going, maybe, cant)
  status            enum(not_started, en_route, arrived)
  travel_mode       enum(driving, walking, transit, cycling)
  tracking_source   enum(app_background, app_foreground, web, manual)   -- FR-6
  sharing           bool
  self_reported_eta timestamptz null
  arrived_at        timestamptz null
  device_token_hash text
  push_token        text null          -- PS-12
  muted             bool
  created_at        timestamptz

positions                              -- latest + short trail only, PS-3
  id                bigserial pk
  participant_id    uuid fk
  lat               double precision
  lng               double precision
  accuracy_m        real
  recorded_at       timestamptz        -- client clock (offline queue)
  received_at       timestamptz

etas
  participant_id    uuid pk fk
  eta_at            timestamptz
  distance_m        integer
  duration_s        integer
  source            enum(routed, straight_line)
  computed_at       timestamptz

notifications_sent                     -- dedupe, FR-9
  participant_id    uuid fk
  kind              enum(proximity, all_here, nudge, late)
  sent_at           timestamptz
  pk (participant_id, kind)
```

**Row-level security:** every read is scoped by event token → event id. A participant may write only their own row and their own positions.

---

## 10. API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/events` | Create event, returns `{token, inviteUrl}` |
| `GET` | `/api/events/:token` | Full state snapshot |
| `POST` | `/api/events/:token/verify-pin` | PS-5 |
| `POST` | `/api/events/:token/join` | `{displayName}` → participant token |
| `PATCH` | `/api/events/:token/me` | RSVP, status, travel mode, sharing, self-reported ETA, name, mute |
| `POST` | `/api/events/:token/me/position` | Single or batched positions (offline flush) |
| `POST` | `/api/events/:token/me/push-token` | Register/revoke a push token |
| `POST` | `/api/events/:token/nudge` | `{participantId}`, rate-limited |
| `DELETE` | `/api/events/:token/me` | Leave |
| `GET` | `/api/events/:token/stream` | Realtime subscription |
| `POST` | `/api/cron/purge` | Scheduled cleanup, secret-header auth |

ETAs and proximity notifications are computed server-side on a timer per active event — one Matrix call covers every participant and caps the routing bill.

---

## 11. Build plan

### Phase 0 — Foundations *(~1 day)*
pnpm monorepo, Expo app with dev client, Next.js web app, Supabase project, schema migration, EAS configured, both surfaces deployed/installable. **Done when:** a "hello" build runs on a real phone and a real URL.

### Phase 1 — Event, invite, RSVP, both surfaces *(~3–4 days)*
FR-1, FR-2, FR-3. No location. Universal Links / App Links, deferred deep link, web join page, PIN. **Done when:** five people join one event from a chat link — some in the app, some in the browser — and everyone sees the RSVP list update live.

### Phase 2 — Check-in, foreground location, ETA *(~3 days)*
FR-4 foreground path, FR-6, FR-7, FR-10 manual. **Done when:** two phones across town show plausible, updating ETAs with the app open.

### Phase 3 — Background tracking *(~3–4 days)*
FR-5 in full: tiered accuracy, TaskManager, Android foreground service, iOS Always permission flow, geofenced arrival, safety timeouts, battery measurement. The hardest phase and the one that justifies D-1. **Done when:** a phone in a pocket, screen off, for a 30-minute drive produces a continuous ETA and auto-arrives.

### Phase 4 — Map view *(~2 days)*
FR-8 on both surfaces.

### Phase 5 — Push notifications *(~2–3 days)*
FR-9, PS-12, dedupe table, permission flow, mute.

### Phase 6 — Robustness & privacy *(~2 days)*
Staleness, offline queue, purge cron, rate limits, PS-11 disclosure screens, privacy copy, accessibility pass.

### Phase 7 — Store submission *(~2 days work, 1–7 days waiting)*
Icons, screenshots, privacy nutrition labels, Play background-location declaration and demo video, App Review notes, TestFlight and internal testing track. **Start the Play declaration during Phase 3, not here** — it gates release and reviews slowly.

**Total: ~3.5–5 weeks of build, plus store review latency.**

### Later, if it earns it
Calendar export, place suggestions, recurring groups, widgets, trip replay.

---

## 12. Definition of done for v1

The six friends use it for a real dinner, and:
- Everyone could join from the link — including whoever didn't install the app.
- Everyone who tapped "on my way" showed an ETA within ±5 minutes of reality, with their phone in a pocket.
- The group got a useful "5 minutes away" push, not a stream of noise.
- The group answered "should we order?" from the app instead of the group chat.
- Nobody's location was still being shared the next morning, and no location task survived the event.

---

## 13. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **Install friction kills adoption** — a one-off dinner doesn't justify an app store trip | **High** | The hybrid web surface (§1.1). This is the single most important mitigation in the plan |
| **Play Store background-location review** — declaration form plus demo video, slow and a common rejection | **High** | Start the declaration during Phase 3; make the PS-11 disclosure screen unmissable |
| **App Review rejects "Always" location** as not justified | **High** | Clear in-app pre-prompt, reviewer notes, and a build that degrades gracefully to When In Use |
| **Battery drain** turns into uninstalls | Medium | Tiered accuracy (FR-5), deferred updates, geofence-based arrival, measured not estimated |
| **Two surfaces drift apart** | Medium | `packages/core` holds every shared rule; ETA and staleness logic exists once |
| **Scope creep into a social network** | Medium | §4's out-of-scope list is the contract |
| **ETA accuracy in dense cities / transit** | Medium | Traffic-aware driving profile; label transit ETAs approximate |
| **Link leaks → strangers see live locations** | Medium | High-entropy tokens, noindex, no-referrer, PIN now in v1, auto-expiry |
| **Routing cost overrun** | Low | Server-side computation on a fixed timer, hard per-event cap |

---

## 14. Open questions

1. **Confirm the hybrid (§1.1)** — native app plus a web join page, or native-only?
2. **"Something else" in v1 extras** — you flagged one alongside map, PIN, and push. What was it?
