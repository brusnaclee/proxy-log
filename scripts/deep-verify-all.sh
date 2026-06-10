#!/bin/bash
DB=/root/proxy-log/packages/proxy/data/gateway.db
# WIB midnight = UTC-7. May 28 00:00 WIB = May 27 17:00 UTC
# Compute dynamically
TODAY=$(python3 -c "
from datetime import datetime, timedelta
now = datetime.utcnow()
wib_now = now + timedelta(hours=7)
wib_mid = wib_now.replace(hour=0, minute=0, second=0, microsecond=0)
utc_mid = wib_mid - timedelta(hours=7)
print(utc_mid.strftime('%Y-%m-%d %H:%M:%S'), end='')
")
echo "Today WIB midnight (UTC): $TODAY"
SECRET=$(grep INTERNAL_API_SECRET /root/proxy-log/.env 2>/dev/null | cut -d= -f2-)
SEPARATOR="============================================================"

sql() { sqlite3 "$DB" "$@"; }
declare -A counts

echo "$SEPARATOR"
echo "  DEEP VERIFY: Request Counting Accuracy (since $TODAY WIB)"
echo "$SEPARATOR"

# ── Query 1: Missing Counts ──
echo ""
echo "[1] Missing Counts — user msg + 200 tapi is_counted_request=0"
echo "-----------------------------------------------------------"
MISSING=$(sql "SELECT COUNT(*) FROM request_logs WHERE status_code BETWEEN 200 AND 299 AND message_role='user' AND is_counted_request=0 AND created_at >= '$TODAY';")
echo "  Total missing: $MISSING"
if [ "$MISSING" != "0" ]; then
  echo "  Samples:"
  sql -header -column <<SQL
SELECT id, api_key_name, context_event, user_message_hash, substr(request_preview,1,60) AS preview
FROM request_logs
WHERE status_code BETWEEN 200 AND 299 AND message_role='user' AND is_counted_request=0 AND created_at >= '$TODAY'
ORDER BY created_at ASC
LIMIT ${MISSING};
SQL
else
  echo "  ✅ No missing counts"
fi

# ── Query 2: Invalid Counted Rows ──
echo ""
echo "[2] Invalid Counted Rows — counted=1 tapi bukan user atau bukan 200"
echo "-----------------------------------------------------------"
INVALID=$(sql "SELECT COUNT(*) FROM request_logs WHERE is_counted_request=1 AND (message_role != 'user' OR status_code NOT BETWEEN 200 AND 299) AND created_at >= '$TODAY';")
echo "  Total invalid: $INVALID"
if [ "$INVALID" != "0" ]; then
  sql -header -column <<SQL
SELECT id, api_key_name, message_role, status_code, context_event, tool_count, has_tool_calls, substr(request_preview,1,80) AS preview
FROM request_logs
WHERE is_counted_request=1 AND (message_role != 'user' OR status_code NOT BETWEEN 200 AND 299) AND created_at >= '$TODAY'
LIMIT ${INVALID};
SQL
else
  echo "  ✅ No invalid counted rows"
fi

# ── Query 3: Duplicate Hash Detection ──
echo ""
echo "[3] Duplicate Hash Detection — hash sama dalam waktu dekat"
echo "-----------------------------------------------------------"
DUPES=$(sql "SELECT COUNT(*) FROM (SELECT user_message_hash FROM request_logs WHERE created_at >= '$TODAY' AND user_message_hash IS NOT NULL AND user_message_hash != '' GROUP BY user_message_hash HAVING COUNT(*)>1);")
echo "  Unique hash with duplicates: $DUPES"
if [ "$DUPES" != "0" ]; then
  sql -header -column <<SQL
SELECT user_message_hash, COUNT(*) AS cnt,
       MIN(created_at) AS first, MAX(created_at) AS last,
       SUM(CASE WHEN is_counted_request=1 THEN 1 ELSE 0 END) AS counted
FROM request_logs
WHERE created_at >= '$TODAY' AND user_message_hash IS NOT NULL AND user_message_hash != ''
GROUP BY user_message_hash
HAVING cnt > 1
ORDER BY cnt DESC
LIMIT 20;
SQL
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Explanation: hash sama = kemungkinan retry / IDE kirim ulang"
  echo "  counted>1 = ada duplicate yang terhitung (false positive)"
fi

# ── Query 4: Zero Tokens ──
echo ""
echo "[4] Zero Token pada Counted Row (counted=1 + 200)"
echo "-----------------------------------------------------------"
ZERO_INP=$(sql "SELECT COUNT(*) FROM request_logs WHERE is_counted_request=1 AND status_code BETWEEN 200 AND 299 AND (prompt_tokens IS NULL OR prompt_tokens=0) AND created_at >= '$TODAY';")
ZERO_OUT=$(sql "SELECT COUNT(*) FROM request_logs WHERE is_counted_request=1 AND status_code BETWEEN 200 AND 299 AND (completion_tokens IS NULL OR completion_tokens=0) AND created_at >= '$TODAY';")
echo "  prompt_tokens=0: $ZERO_INP"
echo "  completion_tokens=0: $ZERO_OUT"
if [ "$ZERO_INP" != "0" ]; then
  echo "  ── Samples dengan prompt_tokens=0 ──"
  sql -header -column <<SQL
SELECT id, api_key_name, prompt_tokens, completion_tokens, substr(request_preview,1,60) AS preview
FROM request_logs
WHERE is_counted_request=1 AND status_code BETWEEN 200 AND 299 AND (prompt_tokens IS NULL OR prompt_tokens=0) AND created_at >= '$TODAY'
LIMIT ${ZERO_INP};
SQL
fi
if [ "$ZERO_OUT" != "0" ]; then
  echo "  ── Samples dengan completion_tokens=0 ──"
  sql -header -column <<SQL
SELECT id, api_key_name, prompt_tokens, completion_tokens, total_tokens, substr(response_preview,1,60) AS resp_preview
FROM request_logs
WHERE is_counted_request=1 AND status_code BETWEEN 200 AND 299 AND (completion_tokens IS NULL OR completion_tokens=0) AND created_at >= '$TODAY'
LIMIT ${ZERO_OUT};
SQL
fi

# ── Query 5: Per-User Stats ──
echo ""
echo "[5] Per-User: all 200s vs counted vs missed user msgs"
echo "-----------------------------------------------------------"
sql -header -column <<SQL
SELECT ak.name,
  COUNT(*) AS all_200,
  SUM(CASE WHEN rl.is_counted_request=1 THEN 1 ELSE 0 END) AS counted,
  SUM(CASE WHEN rl.message_role='user' AND rl.is_counted_request=0 THEN 1 ELSE 0 END) AS NOT_counted_user,
  ROUND(AVG(CASE WHEN rl.is_counted_request=1 THEN rl.prompt_tokens END)) AS avg_inp,
  ROUND(AVG(CASE WHEN rl.is_counted_request=1 THEN rl.completion_tokens END)) AS avg_out
FROM request_logs rl
JOIN api_keys ak ON ak.id = rl.api_key_id
WHERE rl.created_at >= '$TODAY' AND rl.status_code BETWEEN 200 AND 299
GROUP BY rl.api_key_id
ORDER BY all_200 DESC
LIMIT 30;
SQL

# ── Query 5b: Any user with missed user messages ──
echo ""
echo "  ── Users with non-counted user messages (missed) ──"
MISSED_USERS=$(sql "SELECT COUNT(*) FROM (SELECT rl.api_key_id FROM request_logs rl WHERE rl.created_at >= '$TODAY' AND rl.status_code BETWEEN 200 AND 299 AND rl.message_role='user' AND rl.is_counted_request=0 GROUP BY rl.api_key_id);")
echo "  Users with missed: $MISSED_USERS"
if [ "$MISSED_USERS" != "0" ]; then
  sql -header -column <<SQL
SELECT ak.name,
  COUNT(*) AS NOT_counted_user_msgs,
  SUM(CASE WHEN rl.is_counted_request=1 THEN 1 ELSE 0 END) AS counted,
  COUNT(*) AS all_200
FROM request_logs rl
JOIN api_keys ak ON ak.id = rl.api_key_id
WHERE rl.created_at >= '$TODAY' AND rl.status_code BETWEEN 200 AND 299 AND rl.message_role='user' AND rl.is_counted_request=0
GROUP BY rl.api_key_id
ORDER BY NOT_counted_user_msgs DESC
LIMIT 10;
SQL
fi

# ── Query 6: Cross-Surface Consistency ──
echo ""
echo "[6] Cross-Surface Consistency (API vs SQL)"
echo "-----------------------------------------------------------"
if [ -z "$SECRET" ]; then
  echo "  ⚠️  INTERNAL_API_SECRET not found, skipping API check"
else
  echo "  Internal ranking API — topUsersByRequests:"
  curl -sf -H "x-internal-secret: $SECRET" http://127.0.0.1:3000/admin/internal/stats/ranking \
    | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('  RANKING BY REQUESTS (today):')
for x in d['today']['topUsersByRequests'][:5]:
    print(f'    {x[\"discordUsername\"]:20s} reqs={x[\"requests\"]:3d}  tokens={x[\"tokens\"]:7d}')
print('  RANKING BY TOKENS (today):')
for x in d['today']['topUsersByTokens'][:5]:
    print(f'    {x[\"discordUsername\"]:20s} reqs={x[\"requests\"]:3d}  tokens={x[\"tokens\"]:7d}  inp={x.get(\"promptTokens\",0):6d}  out={x.get(\"completionTokens\",0):6d}')
"
fi

# For comparison, same from SQL
echo ""
echo "  SQL — top counted (today WIB):"
sql -header -column <<SQL
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

# ── Query 7: Global Summary ──
echo ""
echo "$SEPARATOR"
echo "  GLOBAL SUMMARY (today WIB)"
echo "$SEPARATOR"
TOTAL_ALL_200=$(sql "SELECT COUNT(*) FROM request_logs WHERE status_code BETWEEN 200 AND 299 AND created_at >= '$TODAY';")
TOTAL_COUNTED=$(sql "SELECT COUNT(*) FROM request_logs WHERE is_counted_request=1 AND status_code BETWEEN 200 AND 299 AND created_at >= '$TODAY';")
TOTAL_USER_200=$(sql "SELECT COUNT(*) FROM request_logs WHERE status_code BETWEEN 200 AND 299 AND message_role='user' AND created_at >= '$TODAY';")
TOTAL_NOT_COUNTED=$(sql "SELECT COUNT(*) FROM request_logs WHERE status_code BETWEEN 200 AND 299 AND message_role='user' AND is_counted_request=0 AND created_at >= '$TODAY';")
echo "  All 200 responses:           $TOTAL_ALL_200"
echo "  User messages with 200:      $TOTAL_USER_200"
echo "  Counted (user+200):          $TOTAL_COUNTED"
echo "  User+200 NOT counted:       $TOTAL_NOT_COUNTED"
echo ""
if [ "$MISSING" = "0" ] && [ "$INVALID" = "0" ] && [ "$ZERO_INP" = "0" ] && [ "$ZERO_OUT" = "0" ]; then
  echo "  ✅ ALL CLEAN — no counting issues detected"
else
  echo "  ⚠️  Issues found — review details above"
  [ "$MISSING" != "0" ] && echo "     - $MISSING missing counts"
  [ "$INVALID" != "0" ] && echo "     - $INVALID invalid counted rows"
  [ "$ZERO_INP" != "0" ] && echo "     - $ZERO_INP rows with prompt_tokens=0"
  [ "$ZERO_OUT" != "0" ] && echo "     - $ZERO_OUT rows with completion_tokens=0"
fi
echo ""
