#!/bin/bash
set -e
DB=/root/proxy-log/packages/proxy/data/gateway.db
ENV=/root/proxy-log/.env

echo "=== API key check ==="
sqlite3 "$DB" "SELECT id, key_prefix, is_active FROM api_keys WHERE key='REDACTED_PROXY_KEY';"

echo "=== Providers before ==="
sqlite3 "$DB" "SELECT id, name, endpoint, substr(api_key,1,20), priority FROM providers;"

UPSTREAM_KEY=$(grep '^UPSTREAM_API_KEY=' "$ENV" | cut -d= -f2-)

# Fix tokito provider: was pointing to proxy itself (loop). Use 9router on localhost.
TOKITO_ENDPOINT="http://127.0.0.1:20128/v1"
TOKIOMNI_ENDPOINT="http://127.0.0.1:3060/v1"
TOKIOMNI_KEY="REDACTED_TOKIOMNI_KEY"

echo "=== Updating providers ==="
sqlite3 "$DB" "UPDATE providers SET endpoint='$TOKITO_ENDPOINT', api_key='$UPSTREAM_KEY', is_active=1, priority=100 WHERE name='tokito';"

# Remove duplicate api3 provider
sqlite3 "$DB" "DELETE FROM providers WHERE name='api3';"

# Upsert tokiomni provider (omni-server on localhost :3060)
HAS_TOKIOMNI=$(sqlite3 "$DB" "SELECT COUNT(*) FROM providers WHERE name='tokiomni';")
if [ "$HAS_TOKIOMNI" = "0" ]; then
  sqlite3 "$DB" "INSERT INTO providers (name, endpoint, api_key, is_active, priority, created_at, updated_at) VALUES ('tokiomni', '$TOKIOMNI_ENDPOINT', '$TOKIOMNI_KEY', 1, 95, datetime('now'), datetime('now'));"
else
  sqlite3 "$DB" "UPDATE providers SET endpoint='$TOKIOMNI_ENDPOINT', api_key='$TOKIOMNI_KEY', is_active=1, priority=95 WHERE name='tokiomni';"
fi

echo "=== Providers after ==="
sqlite3 "$DB" "SELECT id, name, endpoint, substr(api_key,1,20), priority FROM providers;"

echo "=== Tokiomni health check ==="
TOKIOMNI_HTTP=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKIOMNI_KEY" http://127.0.0.1:3060/v1/models)
echo "GET /v1/models HTTP $TOKIOMNI_HTTP"

echo "=== Fix .env DATABASE_URL ==="
if grep -q '^DATABASE_URL=\./data/gateway.db' "$ENV"; then
  sed -i 's|^DATABASE_URL=./data/gateway.db|DATABASE_URL=/root/proxy-log/packages/proxy/data/gateway.db|' "$ENV"
  echo "Updated DATABASE_URL to absolute path"
fi

echo "=== Test proxy key ==="
HTTP=$(curl -s -o /tmp/proxy-test.json -w '%{http_code}' \
  -H "Authorization: Bearer REDACTED_PROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"ag/claude-sonnet-4-6","messages":[{"role":"user","content":"hi"}],"max_tokens":1}' \
  http://127.0.0.1:3000/v1/chat/completions)
echo "HTTP $HTTP"
head -c 400 /tmp/proxy-test.json
echo
