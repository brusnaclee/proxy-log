#!/bin/bash
set -e
cd /root/proxy-log

echo "=== Clean temp debug scripts ==="
rm -f /tmp/check-logs.sh /tmp/curl_test.sh /tmp/fix_proxy.sh /tmp/test-clean-key.sh \
  /tmp/test-pending.sh /tmp/test-tokiomni.sh /tmp/test-tokowa-models.sh \
  /root/proxy-log/scripts/quick-verify.sh 2>/dev/null || true

echo "=== Clean /root debug scripts ==="
rm -f /root/check-db.js /root/check-logs.js /root/patch.js /root/payload.json \
  /root/test-api3.js /root/test-exact.js /root/test-fetch-detailed.js \
  /root/test-headers-full.js /root/test-headers.js /root/test-local-proxy.js \
  /root/test-ps.js 2>/dev/null || true

echo "=== Git pull ==="
git fetch origin main
git reset --hard origin/main

echo "=== Chmod ops scripts ==="
chmod +x scripts/*.sh 2>/dev/null || true

echo "=== Build ==="
pnpm --filter proxy build
pnpm --filter dashboard build

echo "=== Restart PM2 ==="
pm2 restart proxy-api discord-bot dashboard --update-env
sleep 5

echo "=== PM2 status ==="
pm2 list

echo "=== Health check ==="
curl -sf http://127.0.0.1:3000/health | head -c 120
echo

echo "=== Providers (via psql) ==="
PGPASSWORD="${DB_PASSWORD:-}" psql -h "${DB_HOST:-localhost}" -U "${DB_USER:-monit}" -d "${DB_NAME:-monit_gateway}" -c "SELECT id, name, endpoint, priority FROM providers WHERE is_active=true;" 2>/dev/null || echo "(skipped — set DB env vars)"

echo "=== Bot monitor (last tokowa/tokito lines) ==="
pm2 logs discord-bot --lines 20 --nostream 2>&1 | grep -E 'tokito-monitor|error|Error' | tail -10 || true

echo "=== Proxy errors (recent) ==="
pm2 logs proxy-api --lines 15 --nostream 2>&1 | grep -iE 'error|fail' | tail -5 || echo none

echo "=== Done ==="
