#!/bin/bash
set -e

# Reads PROXY_KEY from env or .env in repo root.
ENV_FILE="${ENV_FILE:-/root/proxy-log/.env}"
if [ -z "${PROXY_KEY:-}" ] && [ -f "$ENV_FILE" ]; then
  PROXY_KEY=$(grep '^PROXY_TEST_KEY=' "$ENV_FILE" | cut -d= -f2-)
fi
if [ -z "${PROXY_KEY:-}" ]; then
  echo "ERROR: PROXY_KEY env var or PROXY_TEST_KEY in $ENV_FILE is required" >&2
  exit 1
fi

BASE="http://127.0.0.1:3000/v1/chat/completions"

test_model() {
  local model="$1"
  local code
  code=$(curl -s -o /tmp/t.json -w '%{http_code}' \
    -H "Authorization: Bearer $PROXY_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":1}" \
    "$BASE")
  echo "=== $model => HTTP $code ==="
  head -c 200 /tmp/t.json
  echo
}

test_model "ag/claude-sonnet-4-6"
test_model "minimax/MiniMax-M2.7"
test_model "tokito/minimax/MiniMax-M2.7"
test_model "tokiomni/ag/claude-sonnet-4-6"

echo "=== Providers ==="
sqlite3 /root/proxy-log/packages/proxy/data/gateway.db "SELECT id, name, endpoint, priority FROM providers;"
