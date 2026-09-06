#!/usr/bin/env bash
# Apply the migrations to a throwaway Postgres and run the schema assertions.
#
# Uses $DATABASE_URL if set (point it at a scratch database, never a real one).
# Otherwise starts a local cluster under .tmp/pgdata, runs, and stops it.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

run_sql() { psql "$@" -q -v ON_ERROR_STOP=1; }

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "==> using DATABASE_URL"
  for migration in supabase/migrations/*.sql; do
    echo "--> $migration"
    run_sql "$DATABASE_URL" -f "$migration"
  done
  run_sql "$DATABASE_URL" -f supabase/tests/schema_test.sql
  exit 0
fi

# Local throwaway cluster.
export PATH="${PG_BIN:-/usr/lib/postgresql/16/bin}:$PATH"
pgdata="$repo_root/.tmp/pgdata"
port="${PGTEST_PORT:-55432}"
sock=/tmp

cleanup() { pg_ctl -D "$pgdata" stop -s >/dev/null 2>&1 || true; }
trap cleanup EXIT

rm -rf "$pgdata"; mkdir -p "$pgdata"
initdb -D "$pgdata" -U postgres --auth=trust >/dev/null
pg_ctl -D "$pgdata" -o "-k $sock -p $port -c listen_addresses=''" -l "$pgdata/log" start >/dev/null
sleep 1

conn="-h $sock -p $port -U postgres"
# shellcheck disable=SC2086
psql $conn -q -c "drop database if exists wat_test"
# shellcheck disable=SC2086
psql $conn -q -c "create database wat_test"

for migration in supabase/migrations/*.sql; do
  echo "==> $migration"
  # shellcheck disable=SC2086
  run_sql $conn -d wat_test -f "$migration"
done

echo "==> schema assertions"
# shellcheck disable=SC2086
run_sql $conn -d wat_test -f supabase/tests/schema_test.sql
