#!/bin/bash
DB=/root/proxy-log/packages/proxy/data/gateway.db

echo "=== itsmezyyn — all rows today ==="
sqlite3 "$DB" -header -column <<SQL
SELECT id, session_id, message_role, status_code, context_event,
       is_counted_request, substr(user_message_hash,1,20) AS hash_short,
       prompt_tokens, completion_tokens, total_tokens,
       created_at,
       substr(request_preview,1,80) AS request,
       substr(response_preview,1,80) AS response
FROM request_logs
WHERE api_key_name LIKE '%itsmezyyn%'
  AND created_at >= '2026-05-27 17:00:00'
ORDER BY id ASC;
SQL

echo ""
echo "=== Duplicate hash detail (2c4bd1113a...) — all 11 rows ==="
sqlite3 "$DB" -header -column <<SQL
SELECT id, api_key_name, context_event, is_counted_request,
       created_at, substr(request_preview,1,80) AS request
FROM request_logs
WHERE user_message_hash = '2c4bd1113a1308076e5015a9cf692d57ba9ef0e94f3badc919461b5f8c105572'
  AND created_at >= '2026-05-27 17:00:00'
ORDER BY id ASC;
SQL

echo ""
echo "=== smartspartacus — counted rows today ==="
sqlite3 "$DB" -header -column <<SQL
SELECT id, context_event, prompt_tokens, completion_tokens, total_tokens,
       substr(request_preview,1,80) AS request,
       substr(response_preview,1,80) AS response
FROM request_logs
WHERE api_key_name LIKE '%smartspartacus%'
  AND is_counted_request=1 AND status_code BETWEEN 200 AND 299
  AND created_at >= '2026-05-27 17:00:00'
ORDER BY id ASC;
SQL

echo ""
echo "=== Counted rows with completion_tokens=0 (today) ==="
sqlite3 "$DB" -header -column <<SQL
SELECT id, api_key_name, prompt_tokens, completion_tokens, total_tokens,
       substr(request_preview,1,80) AS request,
       substr(response_preview,1,40) AS response
FROM request_logs
WHERE is_counted_request=1 AND status_code BETWEEN 200 AND 299
  AND (completion_tokens IS NULL OR completion_tokens=0)
  AND created_at >= '2026-05-27 17:00:00'
ORDER BY id ASC;
SQL

echo ""
echo "=== itsmezyyn — all rows + session info ==="
sqlite3 "$DB" -header -column <<SQL
SELECT rl.id, rl.session_id, cs.last_user_message_hash AS sess_hash,
       rl.user_message_hash AS row_hash,
       rl.context_event, rl.is_counted_request,
       rl.prompt_tokens, rl.completion_tokens,
       substr(rl.request_preview,1,60)
FROM request_logs rl
LEFT JOIN chat_sessions cs ON cs.session_id = rl.session_id
WHERE rl.api_key_name LIKE '%itsmezyyn%'
  AND rl.created_at >= '2026-05-27 17:00:00'
ORDER BY rl.id ASC;
SQL
