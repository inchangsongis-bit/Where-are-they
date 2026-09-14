#!/usr/bin/env bash
# Everything a contributor should run before pushing: types, unit tests,
# the migrations against a real Postgres, and the integration suites.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "==> typecheck"
pnpm typecheck

echo "==> schema: migrations + assertions"
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 \
  -c 'drop schema public cascade; create schema public;'
for migration in supabase/migrations/*.sql; do
  echo "    $migration"
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$migration"
done
psql "$DATABASE_URL" -q -t -v ON_ERROR_STOP=1 -f supabase/tests/schema_test.sql \
  | grep -E 'all schema|FAILED|ERROR'

echo "==> unit + integration tests"
pnpm test
