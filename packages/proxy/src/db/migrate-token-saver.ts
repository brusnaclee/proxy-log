// Idempotent migration for Token Saver columns (incl. Anti-Waste + intensity).
// Safe to run repeatedly (ADD COLUMN IF NOT EXISTS).

import { pool } from './index.js';

const ADMIN_COLS: Array<[string, string]> = [
  ['token_saver_rtk_enabled', 'boolean NOT NULL DEFAULT true'],
  ['token_saver_rtk_max_chars', 'integer NOT NULL DEFAULT 2000'],
  ['token_saver_rtk_mode', "text NOT NULL DEFAULT 'preset'"],
  ['token_saver_rtk_level', "text NOT NULL DEFAULT 'balanced'"],
  ['token_saver_rtk_custom', "text NOT NULL DEFAULT '{}'"],
  ['token_saver_headroom_enabled', 'boolean NOT NULL DEFAULT false'],
  ['token_saver_headroom_url', "text NOT NULL DEFAULT ''"],
  ['token_saver_headroom_mode', "text NOT NULL DEFAULT 'preset'"],
  ['token_saver_headroom_level', "text NOT NULL DEFAULT 'balanced'"],
  ['token_saver_headroom_custom', "text NOT NULL DEFAULT '{}'"],
  ['token_saver_caveman_enabled', 'boolean NOT NULL DEFAULT false'],
  ['token_saver_caveman_level', 'integer NOT NULL DEFAULT 2'],
  ['token_saver_caveman_mode', "text NOT NULL DEFAULT 'preset'"],
  ['token_saver_caveman_custom', "text NOT NULL DEFAULT '{}'"],
  ['token_saver_ponytail_enabled', 'boolean NOT NULL DEFAULT false'],
  ['token_saver_ponytail_level', "text NOT NULL DEFAULT 'lite'"],
  ['token_saver_ponytail_mode', "text NOT NULL DEFAULT 'preset'"],
  ['token_saver_ponytail_custom', "text NOT NULL DEFAULT '{}'"],
  ['token_saver_groupy_compact_enabled', 'boolean NOT NULL DEFAULT true'],
  ['token_saver_groupy_compact_level', "text NOT NULL DEFAULT 'balanced'"],
  ['token_saver_groupy_compact_mode', "text NOT NULL DEFAULT 'preset'"],
  ['token_saver_groupy_compact_custom', "text NOT NULL DEFAULT '{}'"],
  ['token_saver_batch_enabled', 'boolean NOT NULL DEFAULT true'],
  ['token_saver_batch_mode', "text NOT NULL DEFAULT 'preset'"],
  ['token_saver_batch_level', "text NOT NULL DEFAULT 'balanced'"],
  ['token_saver_batch_custom', "text NOT NULL DEFAULT '{}'"],
  ['token_saver_anti_waste_enabled', 'boolean NOT NULL DEFAULT true'],
  ['token_saver_anti_waste_mode', "text NOT NULL DEFAULT 'preset'"],
  ['token_saver_anti_waste_level', "text NOT NULL DEFAULT 'balanced'"],
  ['token_saver_anti_waste_custom', "text NOT NULL DEFAULT '{}'"],
];

const USER_COLS: Array<[string, string]> = [
  ['token_saver_rtk_override', 'boolean'],
  ['token_saver_headroom_override', 'boolean'],
  ['token_saver_caveman_override', 'boolean'],
  ['token_saver_ponytail_override', 'boolean'],
  ['token_saver_groupy_compact_override', 'boolean'],
  ['token_saver_batch_override', 'boolean'],
  ['token_saver_anti_waste_override', 'boolean'],
  ['token_saver_rtk_mode_override', 'text'],
  ['token_saver_rtk_level_override', 'text'],
  ['token_saver_rtk_custom_override', 'text'],
  ['token_saver_headroom_mode_override', 'text'],
  ['token_saver_headroom_level_override', 'text'],
  ['token_saver_headroom_custom_override', 'text'],
  ['token_saver_caveman_mode_override', 'text'],
  ['token_saver_caveman_level_override', 'integer'],
  ['token_saver_caveman_custom_override', 'text'],
  ['token_saver_ponytail_mode_override', 'text'],
  ['token_saver_ponytail_level_override', 'text'],
  ['token_saver_ponytail_custom_override', 'text'],
  ['token_saver_groupy_compact_mode_override', 'text'],
  ['token_saver_groupy_compact_level_override', 'text'],
  ['token_saver_groupy_compact_custom_override', 'text'],
  ['token_saver_batch_mode_override', 'text'],
  ['token_saver_batch_level_override', 'text'],
  ['token_saver_batch_custom_override', 'text'],
  ['token_saver_anti_waste_mode_override', 'text'],
  ['token_saver_anti_waste_level_override', 'text'],
  ['token_saver_anti_waste_custom_override', 'text'],
  ['preferred_lang', "text NOT NULL DEFAULT 'en'"],
];

export async function migrateTokenSaverColumns() {
  try {
    for (const [col, def] of ADMIN_COLS) {
      await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    }
    for (const [col, def] of USER_COLS) {
      await pool.query(`ALTER TABLE user_portal_settings ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    }
    console.log('✅ Applied idempotent token_saver migrations (incl. anti-waste + intensity)');
  } catch (err: any) {
    console.warn('⚠️ token_saver idempotent migration warning:', err?.message || err);
  }
}
