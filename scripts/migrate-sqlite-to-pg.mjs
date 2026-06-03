#!/usr/bin/env node
/**
 * SQLite → PostgreSQL Data Migration Script
 * 
 * Copies all data from the existing SQLite gateway.db to the new PostgreSQL database.
 * Run this ONCE on the server before switching to PG.
 * 
 * Usage:
 *   SQLITE_PATH=/root/proxy-log/packages/proxy/data/gateway.db \
 *   DATABASE_URL=postgresql://monit_api:rendang123pg@localhost:5432/monit_api \
 *   node scripts/migrate-sqlite-to-pg.mjs
 */

import Database from 'better-sqlite3';
import pg from 'pg';

const SQLITE_PATH = process.env.SQLITE_PATH || '/root/proxy-log/packages/proxy/data/gateway.db';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://monit_api:rendang123pg@localhost:5432/monit_api';

const BATCH_SIZE = 500;

// Map SQLite boolean (0/1) to PostgreSQL boolean
function toBool(val) {
  if (val === null || val === undefined) return null;
  return val === 1 || val === true || val === '1';
}

// Map SQLite datetime string to PG timestamp string
function toTimestamp(val) {
  if (!val) return null;
  // SQLite stores as "YYYY-MM-DD HH:MM:SS"
  return val;
}

async function migrate() {
  console.log('🚀 Starting SQLite → PostgreSQL migration...');
  console.log(`   SQLite: ${SQLITE_PATH}`);
  console.log(`   PG:     ${DATABASE_URL}`);

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

  try {
    // Test connections
    sqlite.pragma('journal_mode = WAL');
    await pool.query('SELECT 1');
    console.log('✅ Both connections established\n');

    // 1. admin_config
    await migrateTable(sqlite, pool, 'admin_config', {
      boolCols: ['realtime_enabled', 'verif_auto_enabled'],
      tsCols: ['created_at', 'updated_at'],
    });

    // 2. api_keys (must come before tables that reference it)
    await migrateTable(sqlite, pool, 'api_keys', {
      boolCols: ['is_active'],
      tsCols: ['created_at', 'updated_at'],
    });

    // 3. allowed_devices
    await migrateTable(sqlite, pool, 'allowed_devices', {
      tsCols: ['created_at'],
    });

    // 4. allowed_ides
    await migrateTable(sqlite, pool, 'allowed_ides', {
      tsCols: ['created_at'],
    });

    // 5. providers
    await migrateTable(sqlite, pool, 'providers', {
      boolCols: ['is_active'],
      tsCols: ['created_at', 'updated_at'],
    });

    // 6. provider_api_keys
    await migrateTable(sqlite, pool, 'provider_api_keys', {
      boolCols: ['is_active', 'is_limited'],
      tsCols: ['created_at'],
    });

    // 7. devices
    await migrateTable(sqlite, pool, 'devices', {
      boolCols: ['is_blocked'],
      tsCols: ['first_seen', 'last_seen'],
    });

    // 8. request_logs (largest table — might take a while)
    await migrateTable(sqlite, pool, 'request_logs', {
      boolCols: ['has_tool_calls', 'actual_tool_calls_in_response', 'is_counted_request', 'is_billable_token'],
      tsCols: ['created_at'],
    });

    // 9. chat_sessions
    await migrateTable(sqlite, pool, 'chat_sessions', {
      boolCols: ['last_tool_calls_active'],
      tsCols: ['first_seen_at', 'last_seen_at'],
    });

    // 10. model_monitor
    await migrateTable(sqlite, pool, 'model_monitor', {
      boolCols: ['is_online'],
      tsCols: ['checked_at'],
    });

    // 11. model_test_state
    await migrateTable(sqlite, pool, 'model_test_state', {
      // no bool cols, no ts cols (last_test_at and suspended_until are TEXT in schema)
    });

    // 12. model_limits
    await migrateTable(sqlite, pool, 'model_limits', {
      tsCols: ['created_at'],
    });

    // 13. cleanup_state
    await migrateTable(sqlite, pool, 'cleanup_state', {
      tsCols: ['created_at', 'updated_at'],
    });

    // 14. monthly_stats
    await migrateTable(sqlite, pool, 'monthly_stats', {
      tsCols: ['created_at', 'updated_at'],
    });

    // 15. model_metadata
    await migrateTable(sqlite, pool, 'model_metadata', {
      tsCols: ['updated_at'],
    });

    // Reset sequences to max(id) + 1
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

  // Check if table exists in SQLite
  const tableExists = sqlite.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(tableName);

  if (!tableExists) {
    console.log(`⏭️  Skipping ${tableName} — table does not exist in SQLite`);
    return;
  }

  const rows = sqlite.prepare(`SELECT * FROM ${tableName}`).all();
  if (rows.length === 0) {
    console.log(`⏭️  ${tableName}: 0 rows (empty)`);
    return;
  }

  const columns = Object.keys(rows[0]);
  const pgColumns = columns.map(c => `"${c}"`).join(', ');

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = [];

    for (let r = 0; r < batch.length; r++) {
      const row = batch[r];
      const rowPlaceholders = [];
      for (const col of columns) {
        let val = row[col];
        if (boolCols.includes(col)) {
          val = toBool(val);
        }
        if (tsCols.includes(col)) {
          val = toTimestamp(val);
        }
        values.push(val);
        rowPlaceholders.push(`$${values.length}`);
      }
      placeholders.push(`(${rowPlaceholders.join(', ')})`);
    }

    const sql = `INSERT INTO "${tableName}" (${pgColumns}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`;

    try {
      await pool.query(sql, values);
      inserted += batch.length;
    } catch (err) {
      console.error(`❌ Error inserting into ${tableName} (batch ${Math.floor(i / BATCH_SIZE) + 1}):`, err.message);
      // Try row-by-row for this batch to find the problem
      for (const row of batch) {
        try {
          const rowValues = [];
          const rowPlaceholders = [];
          for (const col of columns) {
            let val = row[col];
            if (boolCols.includes(col)) val = toBool(val);
            if (tsCols.includes(col)) val = toTimestamp(val);
            rowValues.push(val);
            rowPlaceholders.push(`$${rowValues.length}`);
          }
          await pool.query(
            `INSERT INTO "${tableName}" (${pgColumns}) VALUES (${rowPlaceholders.join(', ')}) ON CONFLICT DO NOTHING`,
            rowValues
          );
          inserted++;
        } catch (rowErr) {
          console.error(`  ⚠️  Skipped row id=${row.id || '?'}: ${rowErr.message}`);
        }
      }
    }
  }

  console.log(`✅ ${tableName}: ${inserted}/${rows.length} rows migrated`);
}

async function resetSequences(pool) {
  console.log('\n🔧 Resetting PostgreSQL sequences...');
  const tables = [
    'admin_config', 'api_keys', 'allowed_devices', 'allowed_ides',
    'providers', 'provider_api_keys', 'devices', 'request_logs',
    'chat_sessions', 'model_monitor', 'model_test_state',
    'model_limits', 'cleanup_state', 'monthly_stats', 'model_metadata',
  ];

  for (const table of tables) {
    try {
      const result = await pool.query(`SELECT MAX(id) as max_id FROM "${table}"`);
      const maxId = result.rows[0]?.max_id;
      if (maxId) {
        await pool.query(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), $1)`, [maxId]);
        console.log(`  ✅ ${table}: sequence reset to ${maxId}`);
      }
    } catch (err) {
      console.warn(`  ⚠️  ${table}: ${err.message}`);
    }
  }
}

migrate();
