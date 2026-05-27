#!/bin/bash
set -e
DB=/root/proxy-log/packages/proxy/data/gateway.db
echo "=== Fix provider api_key prefixes ==="
sqlite3 "$DB" "UPDATE providers SET api_key = trim(replace(api_key, 'key: ', '')) WHERE api_key LIKE 'key:%';"
sqlite3 "$DB" "UPDATE providers SET api_key = trim(replace(api_key, 'Bearer ', '')) WHERE api_key LIKE 'Bearer %';"
sqlite3 "$DB" "SELECT id, name, endpoint, substr(api_key,1,30) FROM providers;"
