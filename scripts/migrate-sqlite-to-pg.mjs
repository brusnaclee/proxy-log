#!/usr/bin/env node
/**
 * SQLite → PostgreSQL Data Migration Script (STREAMING)
 * 
 * Uses better-sqlite3's .iterate() to stream rows without loading all into memory.
 * Designed for large databases (4GB+).
 */

import Database from 'better-sqlite3';
import pg from 'pg';

const SQLITE_PATH = process.env.SQLITE_PATH || 'packages/proxy/data/gateway.db';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://monit_api:rendang123pg@localhost:5432/monit_api';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '200');

function toBool(val) {
  if (val === null || val === undefined) return null;
  return val === 1 || val === true || val === '1';
}

// Sanitize a value for PG — clamp integers that overflow 32-bit
function sanitizeVal(val, col) {
  if (val === null || val === undefined) return null;
  // For integer columns that might overflow (e.g. estimated_cost stored as huge numbers)
  if (typeof val === 'number' && !Number.isFinite(val)) return 0;
  if (typeof val === 'number' && (val > 2147483647 || val < -2147483648)) {
    // Clamp to max int32
    return val > 0 ? 2147483647 : -2147483648;
  }
  return val;
}

async function migrate() {
  console.log('🚀 Starting SQLite → PostgreSQL migration (streaming)...');
  console.log(`   SQLite: ${SQLITE_PATH}`);
  console.log(`   PG:     ${DATABASE_URL}`);

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

  try {
    sqlite.pragma('journal_mode = WAL');
    await pool.query('SELECT 1');
    console.log('✅ Both connections established\n');

    const tables = [
      { name: 'admin_config', bool: ['realtime_enabled', 'verif_auto_enabled'], ts: ['created_at', 'updated_at'] },
      { name: 'api_keys', bool: ['is_active'], ts: ['created_at', 'updated_at'] },
      { name: 'allowed_devices', bool: [], ts: ['created_at'] },
      { name: 'allowed_ides', bool: [], ts: ['created_at'] },
      { name: 'providers', bool: ['is_active'], ts: ['created_at', 'updated_at'] },
      { name: 'provider_api_keys', bool: ['is_active', 'is_limited'], ts: ['created_at'] },
      { name: 'devices', bool: ['is_blocked'], ts: ['first_seen', 'last_seen'] },
      { name: 'request_logs', bool: ['has_tool_calls', 'actual_tool_calls_in_response', 'is_counted_request', 'is_billable_token'], ts: ['created_at'] },
      { name: 'chat_sessions', bool: ['last_tool_calls_active'], ts: ['first_seen_at', 'last_seen_at'] },
      { name: 'model_monitor', bool: ['is_online'], ts: ['checked_at'] },
      { name: 'model_test_state', bool: [], ts: [] },
      { name: 'model_limits', bool: [], ts: ['created_at'] },
      { name: 'cleanup_state', bool: [], ts: ['created_at', 'updated_at'] },
      { name: 'monthly_stats', bool: [], ts: ['created_at', 'updated_at'] },
      { name: 'model_metadata', bool: [], ts: ['updated_at'] },
    ];

    for (const t of tables) {
      await migrateTable(sqlite, pool, t.name, { boolCols: t.bool, tsCols: t.ts });
    }

    await resetSequences(pool);
    console.log('\n🎉 Migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    sqlite.close();
    await pool.end();
  }
}

async function migrateTable(sqlite, pool, tableName, opts = {}) {
  const { boolCols = [], tsCols = [] } = opts;

  const tableExists = sqlite.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(tableName);

  if (!tableExists) {
    console.log(`⏭️  ${tableName}: does not exist`);
    return;
  }

  // Get total count
  const countRow = sqlite.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get();
  const totalRows = countRow.cnt;
  if (totalRows === 0) {
    console.log(`⏭️  ${tableName}: 0 rows`);
    return;
  }

  // Get column names from first row
  const firstRow = sqlite.prepare(`SELECT * FROM ${tableName} LIMIT 1`).get();
  const columns = Object.keys(firstRow);
  const pgColumns = columns.map(c => `"${c}"`).join(', ');

  console.log(`📥 ${tableName}: ${totalRows} rows, ${columns.length} cols...`);

  let inserted = 0;
  let skipped = 0;
  let batch = [];

  // Use iterate() to stream rows without loading all into memory
  const stmt = sqlite.prepare(`SELECT * FROM ${tableName}`);
  for (const row of stmt.iterate()) {
    const processedRow = {};
    for (const col of columns) {
      let val = row[col];
      if (boolCols.includes(col)) val = toBool(val);
      val = sanitizeVal(val, col);
      processedRow[col] = val;
    }
    batch.push(processedRow);

    if (batch.length >= BATCH_SIZE) {
      const result = await insertBatch(pool, tableName, pgColumns, columns, boolCols, batch);
      inserted += result.inserted;
      skipped += result.skipped;
      batch = [];
      if (inserted % 10000 === 0 || inserted === totalRows) {
        process.stdout.write(`\r   ${inserted}/${totalRows} inserted, ${skipped} skipped`);
      }
    }
  }

  // Insert remaining batch
  if (batch.length > 0) {
    const result = await insertBatch(pool, tableName, pgColumns, columns, boolCols, batch);
    inserted += result.inserted;
    skipped += result.skipped;
  }

  console.log(`\r✅ ${tableName}: ${inserted}/${totalRows} inserted, ${skipped} skipped`);
}

async function insertBatch(pool, tableName, pgColumns, columns, boolCols, batch) {
  const values = [];
  const placeholders = [];

  for (let r = 0; r < batch.length; r++) {
    const row = batch[r];
    const rowPlaceholders = [];
    for (const col of columns) {
      values.push(row[col]);
      rowPlaceholders.push(`$${values.length}`);
    }
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  }

  const sql = `INSERT INTO "${tableName}" (${pgColumns}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`;

  try {
    await pool.query(sql, values);
    return { inserted: batch.length, skipped: 0 };
  } catch (err) {
    // Batch failed — try row-by-row
    let inserted = 0;
    let skipped = 0;
    for (const row of batch) {
      try {
        const rowValues = [];
        const rowPlaceholders = [];
        for (const col of columns) {
          rowValues.push(row[col]);
          rowPlaceholders.push(`$${rowValues.length}`);
        }
        await pool.query(
          `INSERT INTO "${tableName}" (${pgColumns}) VALUES (${rowPlaceholders.join(', ')}) ON CONFLICT DO NOTHING`,
          rowValues
        );
        inserted++;
      } catch (rowErr) {
        skipped++;
      }
    }
    return { inserted, skipped };
  }
}

async function resetSequences(pool) {
  console.log('\n🔧 Resetting sequences...');
  const tables = [
    'admin_config', 'api_keys', 'allowed_devices', 'allowed_ides',
    'providers', 'provider_api_keys', 'devices', 'request_logs',
    'chat_sessions', 'model_monitor', 'model_test_state',
    'model_limits', 'cleanup_state', 'monthly_stats', 'model_metadata',
  ];
  for (const table of tables) {
    try {
      const result = await pool.query(`SELECT COALESCE(MAX(id), 0) as max_id FROM "${table}"`);
      const maxId = result.rows[0]?.max_id;
      if (maxId > 0) {
        await pool.query(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), $1)`, [maxId]);
        console.log(`  ✅ ${table}: → ${maxId}`);
      }
    } catch (err) {
      // skip
    }
  }
}

migrate();
