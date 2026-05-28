#!/bin/bash
DB=/root/proxy-log/packages/proxy/data/gateway.db

echo "=== [A] Duplicate hash: 9f86d... (mrkasimoto 'test') — counted 7x ==="
echo "All 80 rows with time gap info:"
sqlite3 "$DB" -header -column <<SQL
SELECT id, created_at, context_event, is_counted_request, status_code,
       session_id
FROM request_logs
WHERE user_message_hash = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
  AND created_at >= '2026-05-27 17:00:00'
ORDER BY created_at ASC
LIMIT 25;
SQL

echo ""
echo "Only counted=1 rows for this hash:"
sqlite3 "$DB" -header -column <<SQL
SELECT id, created_at, context_event, is_counted_request, status_code,
       substr(session_id,6,20) AS session_short
FROM request_logs
WHERE user_message_hash = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
  AND created_at >= '2026-05-27 17:00:00'
  AND is_counted_request=1
ORDER BY created_at ASC;
SQL

echo ""
echo "=== [B] Duplicate hash: 8f434... (kyrahoshi 'hi') — counted 7x ==="
sqlite3 "$DB" -header -column <<SQL
SELECT id, created_at, context_event, is_counted_request, status_code,
       substr(session_id,6,20) AS session_short
FROM request_logs
WHERE user_message_hash = '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4'
  AND created_at >= '2026-05-27 17:00:00'
ORDER BY created_at ASC;
SQL

echo ""
echo "=== [C] Duplicate hash: 3f9c2f... (eizky) — counted 3x ==="
sqlite3 "$DB" -header -column <<SQL
SELECT id, created_at, context_event, is_counted_request, status_code,
       substr(session_id,6,20) AS session_short
FROM request_logs
WHERE user_message_hash = '3f9c2ffb7d524dddd2a2f0f6dc5cd418535100948d7fc509416ce99b2752df98'
  AND created_at >= '2026-05-27 17:00:00'
ORDER BY created_at ASC;
SQL

echo ""
echo "=== [D] neoocrates — 6 user msgs not counted ==="
sqlite3 "$DB" -header -column <<SQL
SELECT id, created_at, context_event, is_counted_request, status_code,
       user_message_hash, substr(request_preview,1,60) AS request
FROM request_logs
WHERE api_key_name LIKE '%neoocrates%'
  AND created_at >= '2026-05-27 17:00:00'
  AND message_role='user'
ORDER BY created_at ASC;
SQL

echo ""
echo "=== [E] stufis_51022 — ephemeral messages (Step Id:) not counted ==="
echo "Samples:"
sqlite3 "$DB" -header -column <<SQL
SELECT id, created_at, context_event, is_counted_request, status_code,
       substr(request_preview,1,80) AS request
FROM request_logs
WHERE api_key_name LIKE '%stufis_51022%'
  AND created_at >= '2026-05-27 17:00:00'
  AND message_role='user'
  AND request_preview LIKE '%Step Id:%EPHEMERAL%'
ORDER BY created_at ASC
LIMIT 10;
SQL

echo ""
echo "=== [F] completion_tokens=0 rows — full response preview ==="
sqlite3 "$DB" -header -column <<SQL
SELECT id, api_key_name, prompt_tokens, completion_tokens,
       substr(response_preview,1,150) AS response,
       transcript_snapshot IS NOT NULL AS has_transcript,
       substr(tools_used,1,60) AS tools
FROM request_logs
WHERE is_counted_request=1 AND status_code BETWEEN 200 AND 299
  AND (completion_tokens IS NULL OR completion_tokens=0)
  AND created_at >= '2026-05-27 17:00:00'
ORDER BY id ASC;
SQL

echo ""
echo "=== [G] stufis_51022 — all user msgs with counted status ==="
sqlite3 "$DB" -header -column <<SQL
SELECT id, created_at, context_event, is_counted_request, status_code,
       substr(request_preview,1,60) AS request
FROM request_logs
WHERE api_key_name LIKE '%stufis_51022%'
  AND created_at >= '2026-05-27 17:00:00'
  AND message_role='user'
ORDER BY created_at ASC
LIMIT 20;
SQL
