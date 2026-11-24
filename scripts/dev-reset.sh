#!/usr/bin/env bash
# Rebuild the LOCAL development database from scratch: drop, migrate, seed dev users, sync the catalogue.
# Refuses to run against anything but a local PostgreSQL instance.
set -euo pipefail
cd "$(dirname "$0")/.."
DB_URL="${DATABASE_URL:-postgresql://planb:planb@127.0.0.1:5432/planb_dev}"
case "$DB_URL" in
  *@127.0.0.1:*|*@localhost:*) ;;
  *) echo "refusing: DATABASE_URL is not a local database" >&2; exit 2 ;;
esac
DB_NAME="${DB_URL##*/}"
ADMIN_URL="${DB_URL%/*}/postgres"
psql -q "$ADMIN_URL" -c "drop database if exists \"$DB_NAME\" with (force)" -c "create database \"$DB_NAME\""
export DATABASE_URL="$DB_URL"
research/.venv/bin/planb db migrate | tail -1
research/.venv/bin/planb dev seed-users
research/.venv/bin/planb catalog sync
