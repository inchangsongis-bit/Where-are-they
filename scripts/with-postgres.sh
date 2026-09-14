#!/usr/bin/env bash
# Run a command with a throwaway PostgreSQL cluster and DATABASE_URL set.
#
#   scripts/with-postgres.sh pnpm test
#
# If DATABASE_URL is already set, the command runs against that instead and no
# cluster is started. Point it only at a scratch database — the suites truncate.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ -n "${DATABASE_URL:-}" ]]; then
  exec "$@"
fi

export PATH="${PG_BIN:-/usr/lib/postgresql/16/bin}:$PATH"
pgdata="$repo_root/.tmp/pgdata"
port="${PGTEST_PORT:-55434}"
sock="$repo_root/.tmp/sock"
dbname="${PGTEST_DB:-wat_test}"

# initdb refuses to run as root, so when we are root the cluster runs as the
# postgres system user and needs the data directory to belong to it.
as_pg() {
  if [[ "$(id -u)" == "0" ]]; then
    su postgres -c "PATH=$PATH $*"
  else
    bash -c "$*"
  fi
}

cleanup() { as_pg "pg_ctl -D '$pgdata' stop -s" >/dev/null 2>&1 || true; }
trap cleanup EXIT

rm -rf "$pgdata" "$sock"; mkdir -p "$pgdata" "$sock"
if [[ "$(id -u)" == "0" ]]; then
  chmod o+x "$repo_root" "$repo_root/.tmp" 2>/dev/null || true
  chown postgres "$pgdata" "$sock"; chmod 700 "$pgdata"
fi

as_pg "initdb -D '$pgdata' -U postgres --auth=trust" >/dev/null
as_pg "pg_ctl -D '$pgdata' -o \"-k $sock -p $port -c listen_addresses=''\" -l '$pgdata/log' start" >/dev/null
for _ in $(seq 1 20); do
  psql -h "$sock" -p "$port" -U postgres -tAc 'select 1' >/dev/null 2>&1 && break
  sleep 0.5
done

psql -h "$sock" -p "$port" -U postgres -q -c "drop database if exists $dbname"
psql -h "$sock" -p "$port" -U postgres -q -c "create database $dbname"

export DATABASE_URL="postgresql://postgres@localhost:$port/$dbname?host=$sock"
export PGTEST_HOST="$sock" PGTEST_PORT="$port" PGTEST_DBNAME="$dbname"
"$@"
