#!/bin/bash
set -e

DB="${DB:-/root/proxy-log/packages/proxy/data/gateway.db}"
PROXY_URL="${PROXY_URL:-http://127.0.0.1:3000/v1/models}"
FIX_HASH="${FIX_HASH:-1}"

echo "=== API Key Audit ==="
echo "Database: $DB"
echo "Proxy URL: $PROXY_URL"
echo ""

PASS=0
FAIL=0
FIXED=0
INACTIVE=0

while IFS='|' read -r id key_prefix key is_active key_hash; do
  hash_ok="no"
  http_status="skip"
  note=""

  if [ -z "$key" ] || [ "$key" = "NULL" ]; then
    note="empty key"
    FAIL=$((FAIL + 1))
    printf "id=%-4s prefix=%-12s active=%s hash_ok=%s http=%s %s\n" "$id" "$key_prefix" "$is_active" "$hash_ok" "$http_status" "$note"
    continue
  fi

  expected_hash=$(printf '%s' "$key" | sha256sum | awk '{print $1}')
  if [ "$key_hash" = "$expected_hash" ]; then
    hash_ok="yes"
  else
    note="hash mismatch"
    if [ "$FIX_HASH" = "1" ]; then
      sqlite3 "$DB" "UPDATE api_keys SET key_hash='$expected_hash' WHERE id=$id;"
      hash_ok="fixed"
      FIXED=$((FIXED + 1))
      note="hash fixed"
    fi
  fi

  if [ "$is_active" != "1" ]; then
    INACTIVE=$((INACTIVE + 1))
    http_status="n/a"
    note="${note:+$note, }inactive"
    printf "id=%-4s prefix=%-12s active=%s hash_ok=%s http=%s %s\n" "$id" "$key_prefix" "$is_active" "$hash_ok" "$http_status" "$note"
    continue
  fi

  http_status=$(curl -s -o /tmp/audit-key.json -w '%{http_code}' \
    -H "Authorization: Bearer $key" \
    "$PROXY_URL")

  body=$(head -c 120 /tmp/audit-key.json 2>/dev/null || true)
  if echo "$body" | grep -qi "Invalid API key"; then
    note="proxy rejected key"
    FAIL=$((FAIL + 1))
  elif [ "$http_status" = "200" ] || [ "$http_status" = "401" ] || [ "$http_status" = "403" ]; then
    note="ok"
    PASS=$((PASS + 1))
  else
    note="unexpected status"
    FAIL=$((FAIL + 1))
  fi

  printf "id=%-4s prefix=%-12s active=%s hash_ok=%s http=%s %s\n" "$id" "$key_prefix" "$is_active" "$hash_ok" "$http_status" "$note"
done < <(sqlite3 -separator '|' "$DB" "SELECT id, key_prefix, key, is_active, key_hash FROM api_keys ORDER BY id;")

echo ""
echo "=== Summary ==="
echo "Active keys passed: $PASS"
echo "Active keys failed: $FAIL"
echo "Inactive keys:      $INACTIVE"
echo "Hash fixes applied: $FIXED"
