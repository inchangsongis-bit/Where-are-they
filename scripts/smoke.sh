#!/usr/bin/env bash
# End-to-end smoke test: boots the built app against a real database and walks
# the R1.1 flow over HTTP — create an event, open the invite page, join, RSVP.
# Run via: pnpm smoke
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

: "${DATABASE_URL:?DATABASE_URL must be set (use scripts/with-postgres.sh)}"

for migration in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$migration"
done

port="${SMOKE_PORT:-3123}"
export NEXT_PUBLIC_APP_URL="http://127.0.0.1:$port"
export CRON_SECRET="smoke-secret"

pnpm --filter @wat/web exec next start -p "$port" >"$repo_root/.tmp/next.log" 2>&1 &
server_pid=$!
trap 'kill $server_pid 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$port/" >/dev/null 2>&1 && break
  sleep 0.5
done

fail() { echo "SMOKE FAILED: $1"; exit 1; }

# Inside the check-in window (FR-9 opens it two hours before the start), so the
# smoke can exercise the whole flow rather than stopping at a correct refusal.
starts_at=$(date -u -d '+45 minutes' +%Y-%m-%dT%H:%M:%SZ)

echo "==> create an event (starts $starts_at)"
created=$(curl -fsS -X POST "http://127.0.0.1:$port/api/events" \
  -H 'content-type: application/json' \
  -d '{"title":"Dinner at Kisa","placeName":"Kisa Izakaya","placeAddress":"118 Bowery",
       "lat":40.7188,"lng":-73.9938,"startsAt":"'"$starts_at"'",
       "timezone":"America/New_York","organizerName":"Ana"}')
token=$(printf '%s' "$created" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[[ -n "$token" ]] || fail "no token in $created"
echo "    token: $token"

echo "==> the invite page renders the venue server-side"
page=$(curl -fsS "http://127.0.0.1:$port/e/$token")
grep -q "Kisa Izakaya" <<<"$page" || fail "invite page did not render the venue"
grep -q "What&#x27;s your name?\|What’s your name?\|name?" <<<"$page" \
  || fail "invite page did not ask a newcomer for their name"

echo "==> the invite page is not indexable (PS-4)"
headers=$(curl -fsSI "http://127.0.0.1:$port/e/$token")
grep -qi 'x-robots-tag: *noindex' <<<"$headers" || fail "missing noindex on the invite page"
grep -qi 'referrer-policy: *no-referrer' <<<"$headers" || fail "missing no-referrer"

echo "==> join as a second person"
jar="$repo_root/.tmp/smoke-cookies.txt"; rm -f "$jar"
joined=$(curl -fsS -c "$jar" -X POST "http://127.0.0.1:$port/api/events/$token/join" \
  -H 'content-type: application/json' -d '{"displayName":"Marco"}')
grep -q '"displayName":"Marco"' <<<"$joined" || fail "join did not return Marco"
grep -q 'HttpOnly' "$jar" 2>/dev/null || grep -q 'wat_p_' "$jar" || fail "no session cookie stored"

echo "==> RSVP with that cookie"
rsvp=$(curl -fsS -b "$jar" -X PATCH "http://127.0.0.1:$port/api/events/$token/me" \
  -H 'content-type: application/json' -d '{"rsvp":"going"}')
grep -q '"rsvp":"going"' <<<"$rsvp" || fail "RSVP did not stick: $rsvp"

echo "==> RSVP without a cookie is refused"
code=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
  "http://127.0.0.1:$port/api/events/$token/me" \
  -H 'content-type: application/json' -d '{"rsvp":"cant"}')
[[ "$code" == "401" ]] || fail "expected 401 without a cookie, got $code"

echo "==> the roster shows both people, organizer first"
snapshot=$(curl -fsS "http://127.0.0.1:$port/api/events/$token")
grep -q '"displayName":"Ana"' <<<"$snapshot" || fail "Ana missing from roster"
grep -q '"displayName":"Marco"' <<<"$snapshot" || fail "Marco missing from roster"
grep -q '"here":0' <<<"$snapshot" || fail "unexpected summary: $snapshot"

echo "==> an unknown token is a 404, not a hint"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/events/AAAAAAAAAAAAAAAAAAAAAA")
[[ "$code" == "404" ]] || fail "expected 404 for an unknown token, got $code"

echo "==> check in and share a position"
curl -fsS -b "$jar" -X PATCH "http://127.0.0.1:$port/api/events/$token/me" \
  -H 'content-type: application/json' -d '{"status":"en_route","sharing":true}' >/dev/null
pos=$(curl -fsS -b "$jar" -X POST "http://127.0.0.1:$port/api/events/$token/me/position" \
  -H 'content-type: application/json' \
  -d "{\"lat\":40.7538,\"lng\":-73.9838,\"accuracyM\":12,\"recordedAt\":$(date +%s000),\"source\":\"web\"}")
grep -q '"accepted":1' <<<"$pos" || fail "position not accepted: $pos"
grep -q '"etaComputed":true' <<<"$pos" || fail "no ETA computed: $pos"

echo "==> the roster now carries a labelled ETA"
snapshot=$(curl -fsS "http://127.0.0.1:$port/api/events/$token")
grep -q '"source":"straight_line"' <<<"$snapshot" \
  || fail "ETA is not labelled as an estimate: $snapshot"
grep -q '"onTheWay":1' <<<"$snapshot" || fail "summary did not count anyone en route"

echo "==> positions without a cookie are refused"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:$port/api/events/$token/me/position" \
  -H 'content-type: application/json' \
  -d '{"lat":40.75,"lng":-73.98,"recordedAt":1}')
[[ "$code" == "401" ]] || fail "expected 401 posting a position with no cookie, got $code"

echo "==> arriving stops sharing on its own (PS-2)"
curl -fsS -b "$jar" -X PATCH "http://127.0.0.1:$port/api/events/$token/me" \
  -H 'content-type: application/json' -d '{"status":"arrived"}' >/dev/null
snapshot=$(curl -fsS "http://127.0.0.1:$port/api/events/$token")
python3 - "$snapshot" <<'PYEOF' || fail "arrival did not stop sharing"
import json, sys
data = json.loads(sys.argv[1])
marco = next(p for p in data["participants"] if p["displayName"] == "Marco")
assert marco["status"] == "arrived", marco
assert marco["sharing"] is False, marco
assert marco["eta"] is None, marco
PYEOF

echo "==> the feed interleaves messages with what happened"
curl -fsS -b "$jar" -X POST "http://127.0.0.1:$port/api/events/$token/messages" \
  -H 'content-type: application/json' -d '{"body":"grabbing the table"}' >/dev/null
thread=$(curl -fsS "http://127.0.0.1:$port/api/events/$token/messages")
grep -q '"kind":"joined"' <<<"$thread" || fail "no joined events in the thread"
grep -q '"kind":"arrived"' <<<"$thread" || fail "arrival did not reach the thread"
grep -q 'grabbing the table' <<<"$thread" || fail "message not in the thread"

echo "==> a quick reply changes state, not just the thread"
jar3="$repo_root/.tmp/smoke-quick.txt"; rm -f "$jar3"
curl -fsS -c "$jar3" -X POST "http://127.0.0.1:$port/api/events/$token/join" \
  -H 'content-type: application/json' -d '{"displayName":"Priya"}' >/dev/null
curl -fsS -b "$jar3" -X POST "http://127.0.0.1:$port/api/events/$token/messages" \
  -H 'content-type: application/json' -d '{"quickReply":"late10"}' >/dev/null
snapshot=$(curl -fsS "http://127.0.0.1:$port/api/events/$token")
python3 - "$snapshot" <<'PYEOF' || fail "quick reply did not move the ETA"
import json, sys
data = json.loads(sys.argv[1])
priya = next(p for p in data["participants"] if p["displayName"] == "Priya")
assert priya["status"] == "en_route", priya
assert priya["selfReportedEta"] is not None, priya
PYEOF

echo "==> posting without joining is refused"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:$port/api/events/$token/messages" \
  -H 'content-type: application/json' -d '{"body":"hello"}')
[[ "$code" == "401" ]] || fail "expected 401 posting with no cookie, got $code"

echo "==> push token registration and the notify tick"
curl -fsS -b "$jar" -X POST "http://127.0.0.1:$port/api/events/$token/me/push-token" \
  -H 'content-type: application/json' \
  -d '{"pushToken":"ExponentPushToken[smoke]"}' | grep -q '"registered":true' \
  || fail "push token was not registered"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$port/api/cron/notify")
[[ "$code" == "401" ]] || fail "notify tick ran without its secret ($code)"

notified=$(curl -fsS -X POST "http://127.0.0.1:$port/api/cron/notify" \
  -H "authorization: Bearer smoke-secret")
grep -q '"events"' <<<"$notified" || fail "notify tick returned nothing: $notified"

echo "==> purge requires its secret"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$port/api/cron/purge")
[[ "$code" == "401" ]] || fail "purge allowed without a secret ($code)"
purged=$(curl -fsS -X POST "http://127.0.0.1:$port/api/cron/purge" \
  -H "authorization: Bearer smoke-secret")
grep -q '"eventsDeleted":0' <<<"$purged" || fail "purge deleted a live event: $purged"

echo
echo "--- smoke passed: create -> invite -> join -> RSVP -> check in -> ETA -> arrive -> feed ---"
