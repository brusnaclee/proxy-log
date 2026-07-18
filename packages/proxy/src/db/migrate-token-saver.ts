// Idempotent migration for Token Saver columns.
// Adds tokenSaver* fields to admin_config and user_portal_settings.
// Safe to run repeatedly (ADD COLUMN IF NOT EXISTS).

import { pool } from './index.js';

export async function migrateTokenSaverColumns() {
  try {
    await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_saver_rtk_enabled boolean NOT NULL DEFAULT true`);
    await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_saver_rtk_max_chars integer NOT NULL DEFAULT 2000`);
    await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_saver_headroom_enabled boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_saver_headroom_url text NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_saver_caveman_enabled boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_saver_caveman_level integer NOT NULL DEFAULT 2`);
    await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_saver_ponytail_enabled boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_saver_ponytail_level text NOT NULL DEFAULT 'lite'`);

    await pool.query(`ALTER TABLE user_portal_settings ADD COLUMN IF NOT EXISTS token_saver_rtk_override boolean`);
    await pool.query(`ALTER TABLE user_portal_settings ADD COLUMN IF NOT EXISTS token_saver_headroom_override boolean`);
    await pool.query(`ALTER TABLE user_portal_settings ADD COLUMN IF NOT EXISTS token_saver_caveman_override boolean`);
    await pool.query(`ALTER TABLE user_portal_settings ADD COLUMN IF NOT EXISTS token_saver_ponytail_override boolean`);
    console.log('✅ Applied idempotent token_saver migrations');
  } catch (err: any) {
    console.warn('⚠️ token_saver idempotent migration warning:', err?.message || err);
  }
}
