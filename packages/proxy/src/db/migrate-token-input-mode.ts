// Idempotent migration for token input accounting mode.
import { pool } from './index.js';

export async function migrateTokenInputModeColumn() {
  try {
    await pool.query(
      `ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_input_mode text NOT NULL DEFAULT 'full'`,
    );
    console.log('✅ Applied idempotent token_input_mode migration');
  } catch (err: any) {
    console.warn('⚠️ token_input_mode migration warning:', err?.message || err);
  }
}
