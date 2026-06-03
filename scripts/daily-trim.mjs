#!/usr/bin/env node
/**
 * Daily Auto-Trim Cron Job
 * 
 * Runs at 03:00 WIB daily to NULL-ify heavy text fields from request_logs
 * that are older than 1 day. Preserves ALL counting/billing data.
 * 
 * Fields cleared: transcript_snapshot, request_preview, response_preview
 * Fields KEPT: tokens, cost, turn_id, model, status_code, is_counted_request, etc.
 * 
 * Setup (on server):
 *   crontab -e
 *   0 20 * * * cd /root/proxy-log && DATABASE_URL=postgresql://monit_api:rendang123pg@localhost:5432/monit_api node scripts/daily-trim.mjs >> /var/log/monit-trim.log 2>&1
 *   (20:00 UTC = 03:00 WIB)
 */

import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://monit_api:rendang123pg@localhost:5432/monit_api';

async function dailyTrim() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });

  try {
    const now = new Date().toISOString();
    console.log(`[${now}] Starting daily auto-trim...`);

    // NULL-ify heavy text fields from request_logs older than 1 day
    // KEEP: all counting data (tokens, cost, turn_id, model, is_counted_request, etc.)
    const result = await pool.query(`
      UPDATE request_logs
      SET transcript_snapshot = NULL,
          request_preview = NULL,
          response_preview = NULL
      WHERE created_at < NOW() - INTERVAL '1 day'
        AND (
          transcript_snapshot IS NOT NULL
          OR request_preview IS NOT NULL
          OR response_preview IS NOT NULL
        )
    `);

    console.log(`[${now}] Trimmed ${result.rowCount} rows in request_logs`);

    // Also clear last_request_preview from old chat_sessions
    const sessionResult = await pool.query(`
      UPDATE chat_sessions
      SET last_request_preview = NULL
      WHERE last_seen_at < NOW() - INTERVAL '1 day'
        AND last_request_preview IS NOT NULL
    `);

    console.log(`[${now}] Trimmed ${sessionResult.rowCount} session previews`);
    console.log(`[${now}] Daily trim completed successfully`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Daily trim failed:`, err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

dailyTrim();
