#!/bin/bash
set -e
ENV="${ENV:-/root/proxy-log/.env}"
source "$ENV" 2>/dev/null || true

SECRET="${INTERNAL_API_SECRET:-}"
BASE="${PROXY_INTERNAL_BASE_URL:-http://127.0.0.1:3000}"

if [ -z "$SECRET" ]; then
  echo "ERROR: INTERNAL_API_SECRET not set in $ENV"
  exit 1
fi

echo "=== Rotating all active API keys ==="
RESP=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $SECRET" \
  "$BASE/admin/internal/rotate-all-keys")

echo "$RESP"
echo ""
echo "Bot will send DM + thread notifications within ~30 seconds."
echo "Check: pm2 logs discord-bot --lines 30"
