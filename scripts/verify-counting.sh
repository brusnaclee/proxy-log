#!/bin/bash
DB=/root/proxy-log/packages/proxy/data/gateway.db
TODAY="2026-05-27 17:00:00"

echo "=== Top users by counted requests (today WIB) ==="
sqlite3 "$DB" <<SQL
.mode column
.headers on
SELECT ak.name,
  SUM(CASE WHEN rl.is_counted_request=1 AND rl.status_code BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS reqs,
  SUM(CASE WHEN rl.is_counted_request=1 AND rl.status_code BETWEEN 200 AND 299 THEN rl.total_tokens ELSE 0 END) AS tokens,
  SUM(CASE WHEN rl.is_counted_request=1 AND rl.status_code BETWEEN 200 AND 299 THEN rl.prompt_tokens ELSE 0 END) AS inp,
  SUM(CASE WHEN rl.is_counted_request=1 AND rl.status_code BETWEEN 200 AND 299 THEN rl.completion_tokens ELSE 0 END) AS out
FROM request_logs rl
JOIN api_keys ak ON ak.id = rl.api_key_id
WHERE rl.created_at >= '$TODAY'
GROUP BY rl.api_key_id
ORDER BY reqs DESC
LIMIT 10;
SQL

echo ""
echo "=== Suspicious counted rows ==="
sqlite3 "$DB" "SELECT COUNT(*) FROM request_logs WHERE is_counted_request=1 AND (message_role != 'user' OR status_code NOT BETWEEN 200 AND 299);"

echo ""
echo "=== smartspartacus counted rows ==="
sqlite3 "$DB" <<SQL
.mode column
.headers on
SELECT id, prompt_tokens, completion_tokens, total_tokens
FROM request_logs
WHERE api_key_name LIKE '%smartspartacus%'
  AND is_counted_request=1 AND status_code BETWEEN 200 AND 299
LIMIT 5;
SQL

echo ""
echo "=== Dashboard keys today (sample top 3) ==="
sqlite3 "$DB" <<SQL
.mode column
.headers on
SELECT ak.name,
  COALESCE(SUM(rl.total_tokens), 0) AS tokens_today,
  COALESCE(SUM(rl.estimated_cost), 0) AS cost_today
FROM api_keys ak
LEFT JOIN request_logs rl ON rl.api_key_id = ak.id
  AND rl.created_at >= '$TODAY'
  AND rl.is_counted_request IS NOT 0
  AND rl.status_code BETWEEN 200 AND 299
GROUP BY ak.id
ORDER BY tokens_today DESC
LIMIT 5;
SQL

echo ""
echo "=== Internal ranking API (top 5 by requests) ==="
SECRET=$(grep INTERNAL_API_SECRET /root/proxy-log/.env | cut -d= -f2-)
curl -sf -H "x-internal-secret: $SECRET" http://127.0.0.1:3000/admin/internal/stats/ranking \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('requests:', [(x['discordUsername'], x['requests'], x['tokens']) for x in d['today']['topUsersByRequests'][:5]]); print('tokens:', [(x['discordUsername'], x['requests'], x['tokens']) for x in d['today']['topUsersByTokens'][:5]])"
