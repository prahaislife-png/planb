#!/usr/bin/env bash
# Dashboard end-to-end test: isolated database → production build → real browser → real worker.
# Usage: web/e2e/run.sh        (from the repository root; needs local PostgreSQL, the research venv and Playwright)
set -euo pipefail
cd "$(dirname "$0")/../.."
export E2E_DATABASE_URL="${E2E_DATABASE_URL:-postgresql://planb:planb@127.0.0.1:5432/planb_e2e}"
export E2E_EVIDENCE_DIR="${E2E_EVIDENCE_DIR:-/tmp/planb-e2e-evidence}"
PORT="${E2E_PORT:-3100}"

pnpm --filter @planb/finance build >/dev/null
SLUG="$(cd research && .venv/bin/python ../scripts/e2e_seed.py | tail -1)"
echo "seeded test record: $SLUG"

export DATABASE_URL="$E2E_DATABASE_URL" PLANB_AUTH_MODE=dev PLANB_ALLOW_DEV_AUTH_IN_PRODUCTION_BUILD=local-only
export PLANB_EVIDENCE_BACKEND=local PLANB_EVIDENCE_DIR="$E2E_EVIDENCE_DIR"
( cd web && pnpm exec next build >/dev/null )
( cd web && exec pnpm exec next start -p "$PORT" >/tmp/planb-e2e-web.log 2>&1 ) &
WEB_PID=$!
trap 'kill $WEB_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -fs -o /dev/null "http://localhost:$PORT/no-access" && break; sleep 1; done

BASE_URL="http://localhost:$PORT" SLUG="$SLUG" \
WORKER_CMD="env DATABASE_URL=$E2E_DATABASE_URL PLANB_DB_ROLE=planb_worker PLANB_EVIDENCE_DIR=$E2E_EVIDENCE_DIR research/.venv/bin/planb worker --until-empty" \
node web/e2e/workflow.mjs
