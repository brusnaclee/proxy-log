// Idempotent migration for monitor auto mode.
// Safe to run repeatedly (ADD COLUMN IF NOT EXISTS).

import { pool } from './index.js';

export async function migrateMonitorAutoModeColumn() {
  try {
    await pool.query(
      `ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS monitor_auto_mode text NOT NULL DEFAULT 'notif_only'`,
    );
    console.log('✅ Applied idempotent monitor_auto_mode migration');
  } catch (err: any) {
    console.warn('⚠️ monitor_auto_mode migration warning:', err?.message || err);
  }
}
