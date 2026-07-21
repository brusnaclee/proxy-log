// Idempotent migration for token input accounting mode.
import { pool } from './index.js';

export async function migrateTokenInputModeColumn() {
  try {
    await pool.query(
      `ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_input_mode text NOT NULL DEFAULT 'per_turn_peak'`,
    );
    // Prefer peak mode going forward (fair agent accounting)
    await pool.query(
      `UPDATE admin_config SET token_input_mode = 'per_turn_peak' WHERE id = 1`,
    );
    console.log('✅ Applied idempotent token_input_mode migration');
  } catch (err: any) {
    console.warn('⚠️ token_input_mode migration warning:', err?.message || err);
  }
}
