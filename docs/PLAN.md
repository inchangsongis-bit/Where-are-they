# Where Are They — Product Plan & Requirements

**Status:** Draft v1 for review
**One-line pitch:** Send one link to your dinner group; everyone checks in, shares location, and sees who's arriving when.

---

## 1. The use case

Six friends are meeting for dinner at 7:30pm.

1. **Ana** creates an event: place, date, time.
2. She gets a link and drops it in the group chat.
3. Each friend opens the link, types their name, and RSVPs (Going / Maybe / Can't).
4. Around dinner time each person taps **"I'm on my way"** and grants location access.
5. Everyone sees one live list: who's still home, who's en route with an ETA, who has arrived.
6. When the last person arrives, sharing stops automatically and the data is deleted.

That is the whole product. Everything below serves that loop.

---

## 2. Product principles

| Principle | What it means in practice |
| --- | --- |
| **No accounts** | A link + a first name is the entire onboarding. No signup, no app store, no password. |
| **Location is temporary** | Sharing only runs while you are checked in, and stops on arrival. Nothing is retained after the event. |
| **Honest about staleness** | Never show a confident ETA computed from a 12-minute-old position. Show the age. |
| **Works when location doesn't** | Denied permission, dead battery, subway. Manual status is always available as a fallback. |
| **One screen** | The live view is the product. Everything else is setup. |

---

## 3. Scope

### In scope for v1
- Create an event (title, place, time)
- Shareable invite link
- Join by name, RSVP
- Check in / share live location / mark arrived
- Live participant list with ETA, sorted by arrival order
- Automatic arrival detection and auto-stop
- Automatic data expiry

### Explicitly out of scope for v1
- User accounts, friends lists, contacts, event history
- Chat / messaging (the group already has a group chat)
- Bill splitting, restaurant search, reservations
- Recurring events, calendar sync
- Native iOS/Android apps
- Background location tracking (see §7 — this is a real constraint, not an omission)

---

## 4. Functional requirements

### FR-1 — Create event
- Fields: **title** (optional, defaults to "Dinner"), **place** (required), **date & time** (required), **organizer name** (required).
- Place is entered via an address autocomplete and resolves to `{name, address, lat, lng}`. A place with no coordinates is rejected — coordinates are what make ETAs possible.
- On submit, the app returns an invite link containing an unguessable event token.
- The creator is automatically added as a participant with RSVP = Going.

### FR-2 — Invite & join
- The invite link is the only credential. Anyone holding it can view and join the event.
- Opening the link as a new device shows: event details + "What's your name?"
- Name is free text, 1–24 characters. Duplicate names are allowed but get a disambiguating suffix in the UI.
- Each joined device receives a long-lived participant token (cookie) so returning to the link restores their identity.
- A participant can rename or leave the event.
- Soft cap of **20 participants** per event (the design targets 4–10).

### FR-3 — RSVP
- Three states: **Going**, **Maybe**, **Can't make it**. Default: **Pending** until they answer.
- Visible to all participants, changeable any time before the event.

### FR-4 — Check-in & location sharing
- From ~2 hours before the event start until 3 hours after, each participant sees a primary action: **"I'm on my way."**
- Tapping it requests browser geolocation permission and moves the participant to status `EN_ROUTE`.
- While `EN_ROUTE`, the client sends `{lat, lng, accuracy, timestamp}` to the server on movement (throttled: at most 1 update per 15s, and only when moved > 25m).
- Participant picks a **travel mode**: driving (default), walking, transit, cycling. Mode affects ETA and can be changed mid-trip.
- A participant may stop sharing at any time with one tap; they stay `EN_ROUTE` but with no live position.
- If permission is denied or unavailable, the participant can still set status manually and optionally enter a self-reported ETA ("~20 min").

### FR-5 — ETA
- For each `EN_ROUTE` participant with a fresh position, compute travel time from their position to the venue using a routing provider, respecting their travel mode and live traffic.
- Recompute at most **once per 45 seconds per participant**, or immediately when they've moved > 300m, whichever is less frequent. Batch all participants into a single request per cycle.
- Display as an **arrival clock time** ("arrives 7:34") with minutes as a secondary label ("in 12 min"). Clock times are more useful than durations when coordinating a group.
- If the last position is older than **2 minutes**, mark the ETA as stale and grey it out. Older than **10 minutes**, hide the ETA entirely and show "last seen 14 min ago".
- If routing is unavailable, fall back to straight-line distance ÷ mode speed, clearly labelled as a rough estimate.

### FR-6 — Live view (the main screen)
- Header: event title, place, start time, and a group-level summary — *"3 here · 2 on the way · 1 pending"*.
- The **headline number**: the estimated time everyone is present, i.e. the latest ETA among people going. This is the single most useful fact for the group.
- Participant list, sorted: **Arrived** → **En route** (soonest ETA first) → **Not started** → **Maybe** → **Can't make it**.
- Each row: name, avatar (initial + colour), status chip, ETA or last-seen age, travel mode icon, and a "late" indicator if the ETA is after the start time.
- Updates arrive in real time (no manual refresh).
- **Map view** as a secondary tab: venue pin + a dot per sharing participant. Nice to have; the list is the primary view.

### FR-7 — Arrival
- **Automatic:** within **120m** of the venue for **60 continuous seconds** → status becomes `ARRIVED`, location sharing stops, and the app tells the user it stopped.
- **Manual:** an "I'm here" button is always available (covers GPS drift indoors and large venues).
- Arrival is sticky — it does not revert if the person steps outside.

### FR-8 — Nudges (light touch)
- If a `Going` participant hasn't checked in by the start time, show a "not started" state to the group. One optional in-app nudge per participant, rate-limited.
- No push notifications in v1 (see §11 roadmap).

### FR-9 — Lifecycle & data expiry
- Location data is deleted **3 hours after** the last participant arrives, or **6 hours after** event start, whichever comes first.
- The whole event record is deleted **7 days** after the event start.
- Both are enforced by a scheduled cleanup job, not just by a query filter.

---

## 5. Non-functional requirements

| Area | Requirement |
| --- | --- |
| **Latency** | A position update is visible to other participants in < 3s (p95). |
| **Battery** | Continuous sharing should cost < 8%/hour on a mid-range phone. Achieved by throttled updates and a single `watchPosition` at balanced accuracy. |
| **Data** | < 500KB per participant for a 45-minute trip. |
| **Availability** | Best-effort; it's a dinner app. But the list must degrade gracefully to "last known" when the realtime channel drops, and reconnect automatically. |
| **Offline** | The client queues position updates while offline (max 5 minutes' worth) and flushes on reconnect. Stale positions are timestamped by the *client*, not by server receipt time. |
| **Accessibility** | WCAG 2.1 AA: status must never be conveyed by colour alone (chips carry text), 44px touch targets, screen-reader labels on every row. |
| **Devices** | Mobile-first. iOS Safari 16+, Chrome Android 110+. Desktop is a supported afterthought. |
| **Cost** | Should run under $10/month at hobby scale. |

---

## 6. Privacy & security requirements

This app shares people's real-time physical location. That deserves more than an afterthought.

- **PS-1** — Location is shared only while a participant is explicitly `EN_ROUTE`, and only with participants of that one event.
- **PS-2** — Sharing stops automatically on arrival and on event expiry. A visible, always-present indicator shows when you are sharing.
- **PS-3** — Location history is not retained. Store only the latest position per participant plus, at most, a 10-minute rolling trail for the map. Purge per §FR-9.
- **PS-4** — The invite token is a bearer credential: **≥128 bits of entropy**, URL-safe, not sequential. Pages carry `noindex` and `Referrer-Policy: no-referrer` so tokens don't leak via referrers.
- **PS-5** — Optional **4-digit event PIN** for the paranoid; required once per device before joining.
- **PS-6** — Participant identity is a signed, httpOnly, SameSite=Lax cookie. Never a client-controlled ID.
- **PS-7** — Rate limits on join (10/hour/IP), location updates (6/min/participant), and event creation (20/hour/IP).
- **PS-8** — Coordinates are rounded to ~5 decimal places server-side; no reverse-geocoded street addresses are ever stored or shown.
- **PS-9** — A plain-language privacy note on the permission prompt: *who* sees your location, *for how long*, and *when it stops*.
- **PS-10** — No third-party analytics or ad SDKs on pages that handle location.

---

## 7. The hard technical constraint (read this one)

**Browsers stop delivering geolocation when the tab is backgrounded or the phone is locked.**

This is the central engineering reality of a web-based version of this app. A user taps "I'm on my way", pockets their phone, and updates stop within seconds to a minute depending on the platform. iOS Safari is the strictest.

Mitigations, in order of value:

1. **Design for it.** Treat gaps as normal. Show "last seen 4 min ago" honestly rather than pretending to a live feed. The group mostly needs "roughly when", not a moving dot.
2. **Screen Wake Lock API** while sharing — keeps the screen on, keeps updates flowing. Offer it as a toggle ("keep screen awake"), since it costs battery.
3. **Install as a PWA** — modestly improves retention of the page in memory. Add a manifest and an install prompt.
4. **Ask for a foreground moment.** Prompt "open the app when you're close" — a single fresh fix near the end is worth more than a continuous trail.
5. **Self-reported ETA fallback** — always available, never worse than a group chat.

**If continuous background tracking turns out to be a hard requirement**, that forces a native app (React Native + Expo, using `expo-location` background updates, plus App Store review for the "Always" location permission). That is a materially larger project — recommend proving the concept on web first and only paying that cost if the gaps genuinely hurt.

---

## 8. Recommended architecture

**Recommendation: Next.js (App Router) on Vercel + Supabase (Postgres + Realtime) + Mapbox.**

| Layer | Choice | Why |
| --- | --- | --- |
| Client | Next.js 15 + React, TypeScript, Tailwind | One codebase, mobile-first, PWA-capable, trivial deploy |
| Server | Next.js route handlers | No separate service to run |
| Database | Supabase Postgres | Managed, free tier, SQL |
| Realtime | Supabase Realtime (Postgres changes over WebSocket) | Removes the need to build a socket layer |
| Routing / ETA | Mapbox Directions + Matrix API | Generous free tier (100k req/mo), traffic-aware driving profile |
| Maps | Mapbox GL JS | Same vendor, good mobile performance |
| Places autocomplete | Mapbox Search | Same key |
| Hosting | Vercel | Free tier, zero-config |
| Cleanup job | Vercel Cron → an authenticated purge route | §FR-9 |

**Alternative, zero-vendor:** Node + Fastify + SQLite + Server-Sent Events, Leaflet + OpenStreetMap tiles, self-hosted OSRM for routing. Cheaper and fully owned, but SSE, schema, and a routing container are all yours to run. Choose this only if avoiding SaaS matters more than shipping quickly.

**Why not Firebase:** works fine, but the realtime-to-relational mismatch shows up quickly once you want "sort by ETA and filter by RSVP", and vendor lock-in is stronger.

---

## 9. Data model

```
events
  id                uuid pk
  token             text unique        -- 128-bit, URL-safe, the invite credential
  pin_hash          text null          -- optional, PS-5
  title             text
  place_name        text
  place_address     text
  place_lat         double precision
  place_lng         double precision
  starts_at         timestamptz
  timezone          text
  created_at        timestamptz
  location_purge_at timestamptz        -- FR-9
  expires_at        timestamptz        -- FR-9

participants
  id                uuid pk
  event_id          uuid fk -> events
  display_name      text
  color             text               -- deterministic from id
  is_organizer      bool
  rsvp              enum(pending, going, maybe, cant)
  status            enum(not_started, en_route, arrived)
  travel_mode       enum(driving, walking, transit, cycling)
  sharing           bool
  self_reported_eta timestamptz null   -- manual fallback, FR-4
  arrived_at        timestamptz null
  device_token_hash text
  created_at        timestamptz

positions                              -- latest + short trail only
  id                bigserial pk
  participant_id    uuid fk
  lat               double precision
  lng               double precision
  accuracy_m        real
  recorded_at       timestamptz        -- client clock, FR/NFR offline
  received_at       timestamptz

etas
  participant_id    uuid pk fk
  eta_at            timestamptz
  distance_m        integer
  duration_s        integer
  source            enum(routed, straight_line)
  computed_at       timestamptz
```

**Row-level security:** every read is scoped by event token → event id. A participant may write only their own row and their own positions.

---

## 10. API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/events` | Create event, returns `{token, inviteUrl}` |
| `GET` | `/api/events/:token` | Event + participants + ETAs (full state snapshot) |
| `POST` | `/api/events/:token/join` | `{displayName}` → sets participant cookie |
| `PATCH` | `/api/events/:token/me` | `{rsvp?, status?, travelMode?, sharing?, selfReportedEta?, displayName?}` |
| `POST` | `/api/events/:token/me/position` | `{lat, lng, accuracyM, recordedAt}` |
| `DELETE` | `/api/events/:token/me` | Leave the event |
| `GET` | `/api/events/:token/stream` | Realtime subscription (Supabase channel, or SSE in the alt stack) |
| `POST` | `/api/cron/purge` | Scheduled cleanup, authenticated by secret header |

ETA computation runs server-side on a timer per active event, not per client request — one Matrix call covers all participants.

---

## 11. Build plan

### Phase 0 — Foundations *(~half a day)*
Next.js + TypeScript + Tailwind scaffold, Supabase project, schema migration, env config, deploy a "hello" build to Vercel. **Done when:** an empty app is live at a URL.

### Phase 1 — Event + invite + RSVP *(~1–2 days)*
FR-1, FR-2, FR-3. No location at all. Create an event, share the link, five people join and RSVP, everyone sees the list update live.
**Done when:** the app is already useful as a "who's coming to dinner" tool. Ship this to the actual friend group and get feedback before touching location.

### Phase 2 — Check-in + live location + ETA *(~2–3 days)*
FR-4, FR-5, FR-6 list view, FR-7. Geolocation, throttled updates, Mapbox Matrix, sorted live list, arrival detection, auto-stop.
**Done when:** two phones on opposite sides of town both show plausible, updating ETAs.

### Phase 3 — Robustness & privacy *(~1–2 days)*
Staleness handling, offline queue, wake lock, permission-denied fallback, PIN, rate limits, purge cron, privacy copy. This phase is what separates a demo from something you'd hand to friends.

### Phase 4 — Polish *(~1–2 days)*
Map tab, PWA manifest + install prompt, empty/error states, share-sheet integration, timezone handling, accessibility pass.

### Later, if it earns it
Push notifications ("Ana is 5 minutes away"), calendar export, place suggestions, recurring groups, native app for background tracking (§7).

---

## 12. Definition of done for v1

The six friends actually use it for a real dinner, and:
- Nobody had to install anything or create an account.
- Everyone who tapped "on my way" showed an ETA within ±5 minutes of reality.
- The group could answer "should we order?" from the app instead of the group chat.
- Nobody's location was still being shared the next morning.

---

## 13. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Background location gaps (§7) | High — core feature degrades | Design around staleness; wake lock; self-reported fallback; native only if proven necessary |
| iOS Safari geolocation quirks (requires HTTPS + user gesture, aggressive throttling) | Medium | Test on a real iPhone from Phase 2 day one, not at the end |
| ETA accuracy in dense cities / transit | Medium | Traffic-aware driving profile; label transit ETAs as approximate |
| Link leaks → strangers see live locations | Medium | High-entropy tokens, noindex, no-referrer, optional PIN, auto-expiry |
| Routing API cost overrun from a runaway client | Low | Server-side computation on a fixed timer, hard per-event cap |
| Scope creep into a social network | High to the timeline | §3 out-of-scope list is the contract |

---

## 14. Open decisions

1. **Web-only (recommended) or native from the start?** Native buys real background tracking and costs weeks plus app-store review.
2. **Managed stack (Supabase + Mapbox, recommended) or self-hosted zero-vendor?**
3. **Is the map view in v1, or is the sorted list enough?** Recommend list-only for v1.
4. **Does the group want a PIN**, or is an unguessable link sufficient? Recommend link-only, PIN optional.
5. **Push notifications** — worth the added complexity (web push, permission prompt, VAPID keys) for "X is 5 minutes away"?
