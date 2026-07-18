// Idempotent migration for model identity profile columns on model_metadata.

import { pool } from './index.js';

export async function migrateModelIdentityColumns() {
	try {
		await pool.query(
			`ALTER TABLE model_metadata ADD COLUMN IF NOT EXISTS advertised_name text`,
		);
		await pool.query(`ALTER TABLE model_metadata ADD COLUMN IF NOT EXISTS developer text`);
		await pool.query(
			`ALTER TABLE model_metadata ADD COLUMN IF NOT EXISTS identity_prompt text`,
		);
		await pool.query(
			`ALTER TABLE model_metadata ADD COLUMN IF NOT EXISTS identity_locked boolean NOT NULL DEFAULT true`,
		);
		await pool.query(
			`ALTER TABLE model_metadata ADD COLUMN IF NOT EXISTS enrich_source text`,
		);
		await pool.query(
			`ALTER TABLE model_metadata ADD COLUMN IF NOT EXISTS enriched_at timestamp`,
		);
		console.log('✅ Applied idempotent model_identity migrations');
	} catch (err: any) {
		console.warn('⚠️ model_identity idempotent migration warning:', err?.message || err);
	}
}
