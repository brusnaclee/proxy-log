import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const DATABASE_URL =
	process.env.DATABASE_URL ||
	'postgresql://monit_api:rendang123pg@localhost:5432/monit_api';

// Create pg Pool
const pool = new pg.Pool({
	connectionString: DATABASE_URL,
	max: 20,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 5000,
});

// Create Drizzle instance with schema
export const db = drizzle(pool, { schema });

/**
 * Initialize the database — push schema via Drizzle and seed defaults.
 * All table creation / column migration is handled by drizzle-orm push or
 * the pgTable definitions in schema.ts. No manual CREATE TABLE needed.
 */
export async function initializeDatabase() {
	// Verify connection
	try {
		await pool.query('SELECT 1');
		console.log('✅ PostgreSQL connection established');
	} catch (err) {
		console.error('❌ Failed to connect to PostgreSQL:', err);
		throw err;
	}

	// Idempotent column migrations (in case drizzle-kit push hasn't been re-run
	// against this DB). Each statement uses IF NOT EXISTS where supported.
	try {
		await pool.query(`ALTER TABLE model_limits ADD COLUMN IF NOT EXISTS is_pattern boolean NOT NULL DEFAULT false`);
		await pool.query(`CREATE INDEX IF NOT EXISTS idx_model_limits_pattern ON model_limits (is_pattern)`);
		console.log('✅ Applied idempotent model_limits migrations');
	} catch (err: any) {
		console.warn('⚠️ model_limits idempotent migration warning:', err?.message || err);
	}

	// Trial mode schema (idempotent)
	try {
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_enabled boolean NOT NULL DEFAULT false`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_access_mode text NOT NULL DEFAULT 'groupy_members'`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_required_role_id text DEFAULT '1354682641961582632'`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_default_duration_days integer NOT NULL DEFAULT 1`);
		await pool.query(`ALTER COLUMN admin_config.trial_default_duration_days SET DEFAULT 1`).catch(() => undefined);
		await pool.query(`UPDATE admin_config SET trial_default_duration_days=1 WHERE trial_default_duration_days=30 AND id=1`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_max_per_account integer NOT NULL DEFAULT 1`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_daily_token_limit integer NOT NULL DEFAULT 1000000`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_prompt_limit integer NOT NULL DEFAULT 50`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_prompt_limit_window text NOT NULL DEFAULT '5h'`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_model_selection_mode text NOT NULL DEFAULT 'all_gpy'`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_model_whitelist text NOT NULL DEFAULT '[]'`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_upstreams text NOT NULL DEFAULT ''`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_panel_message_id text`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_embed_config text NOT NULL DEFAULT '{}'`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_dm_templates text NOT NULL DEFAULT '{}'`);
		await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false`);
		await pool.query(`
			CREATE TABLE IF NOT EXISTS trial_users (
				id SERIAL PRIMARY KEY,
				discord_user_id TEXT NOT NULL,
				discord_username TEXT,
				api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
				claimed_at TIMESTAMP NOT NULL DEFAULT NOW(),
				expires_at TIMESTAMP NOT NULL,
				ended_at TIMESTAMP,
				end_reason TEXT,
				override_days INTEGER,
				override_max_trials INTEGER,
				override_daily_token_limit INTEGER,
				override_prompt_limit INTEGER,
				override_prompt_limit_window TEXT,
				suspended BOOLEAN NOT NULL DEFAULT false,
				last_notified_at TIMESTAMP,
				created_at TIMESTAMP NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMP NOT NULL DEFAULT NOW()
			)
		`);
		await pool.query(`CREATE INDEX IF NOT EXISTS idx_trial_users_discord ON trial_users (discord_user_id)`);
		await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_users_api_key ON trial_users (api_key_id)`);
		console.log('✅ Applied idempotent trial migrations');
	} catch (err: any) {
		console.warn('⚠️ trial idempotent migration warning:', err?.message || err);
	}

	// User portal settings (password for portal login)
	try {
		await pool.query(`
			CREATE TABLE IF NOT EXISTS user_portal_settings (
				discord_user_id TEXT PRIMARY KEY,
				password_hash TEXT,
				password_set_at TIMESTAMP,
				created_at TIMESTAMP NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMP NOT NULL DEFAULT NOW()
			)
		`);
		await pool.query(`GRANT ALL PRIVILEGES ON TABLE user_portal_settings TO CURRENT_USER`).catch(() => undefined);
		// New portal settings columns (idempotent)
		await pool.query(`ALTER TABLE user_portal_settings ADD COLUMN IF NOT EXISTS webhook_url TEXT`);
		await pool.query(`ALTER TABLE user_portal_settings ADD COLUMN IF NOT EXISTS webhook_secret TEXT`);
		await pool.query(`ALTER TABLE user_portal_settings ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`);
		console.log('✅ Applied idempotent user_portal_settings migrations');
	} catch (err: any) {
		console.warn('⚠️ user_portal_settings migration warning:', err?.message || err);
	}

	// Unique index on devices(api_key_id, fingerprint) — prevents duplicate device rows
	try {
		await pool.query(`DROP INDEX IF EXISTS idx_devices_api_key_fingerprint`);
		await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_api_key_fingerprint ON devices (api_key_id, fingerprint)`);
		console.log('✅ Applied idempotent devices unique index migration');
	} catch (err: any) {
		console.warn('⚠️ devices unique index migration warning (may have duplicate data):', err?.message || err);
	}

	// Push schema using drizzle-kit push equivalent at runtime:
	// We rely on drizzle-kit push:pg being run before first start.
	// But we still seed defaults below.

	const envUpstreamEndpoint = (process.env.UPSTREAM_ENDPOINT || '')
		.trim()
		.replace(/\/$/, '');
	const envUpstreamApiKey = (process.env.UPSTREAM_API_KEY || '').trim();

	// Seed default admin if none exists
	const existingAdminRows = await db.select().from(schema.adminConfig);
	const existingAdmin = existingAdminRows[0] ?? null;
	if (!existingAdmin) {
		const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin';
		// Use argon2 for password hashing
		const { hash } = await import('@node-rs/argon2');
		const passwordHash = await hash(defaultPassword);

		await db
			.insert(schema.adminConfig)
			.values({
				passwordHash,
				upstreamEndpoint: envUpstreamEndpoint || 'https://api.openai.com',
				upstreamApiKey: envUpstreamApiKey || '',
			});

		console.log(`✅ Default admin created with password: "${defaultPassword}"`);
		console.log('⚠️  Please change the default password via the dashboard!');
	} else {
		// Optional env bootstrap for existing DB (only fill if currently empty/default)
		const updates: Record<string, string> = {};
		if (envUpstreamApiKey && !existingAdmin.upstreamApiKey) {
			updates.upstreamApiKey = envUpstreamApiKey;
		}
		if (
			envUpstreamEndpoint &&
			(!existingAdmin.upstreamEndpoint ||
				existingAdmin.upstreamEndpoint === 'https://api.openai.com')
		) {
			updates.upstreamEndpoint = envUpstreamEndpoint;
		}
		if (Object.keys(updates).length > 0) {
			await db
				.update(schema.adminConfig)
				.set({
					...updates,
					updatedAt: new Date(),
				})
				.where(eq(schema.adminConfig.id, existingAdmin.id));
			console.log('✅ Applied UPSTREAM_* env bootstrap into admin_config');
		}

		// Also bootstrap bot settings if empty
		const envBotToken = process.env.BOT_TOKEN || '';
		const envAgVerifChannelId = process.env.AGVERIF_CHANNEL_ID || '';
		const envTokitoChannelId =
			process.env.TOKITO_CHANNEL_ID || '1470313934752972993';
		const envRequiredRole = process.env.REQUIRED_ROLE_ID || '';
		const envOwnerRole = process.env.OWNER_GROUPY_ROLE_ID || '';
		const envVerifiedRole = process.env.VERIFIED_ROLE_ID || '';
		const envGemini = process.env.GOOGLE_API_KEY || '';
		const envVerifAuto =
			String(process.env.VERIF_AUTO || 'false').toLowerCase() === 'true';
		const envTokitoKey = process.env.TOKITO_API_KEY || '';

		// We update them even if they exist if the user has hardcoded them in .env so .env takes precedence on boot
		const botUpdates: Record<string, any> = {};
		if (envBotToken) botUpdates.discordBotToken = envBotToken;
		if (envAgVerifChannelId) botUpdates.agverifChannelId = envAgVerifChannelId;
		if (envTokitoChannelId) botUpdates.tokitoChannelId = envTokitoChannelId;
		if (envRequiredRole) botUpdates.requiredRoleId = envRequiredRole;
		if (envOwnerRole) botUpdates.ownerGroupyRoleId = envOwnerRole;
		if (envVerifiedRole) botUpdates.verifiedRoleId = envVerifiedRole;
		if (envGemini) botUpdates.geminiApiKey = envGemini;
		botUpdates.verifAutoEnabled = envVerifAuto;
		if (envTokitoKey) botUpdates.tokitoApiKey = envTokitoKey;

		if (Object.keys(botUpdates).length > 0) {
			await db
				.update(schema.adminConfig)
				.set({
					...botUpdates,
					updatedAt: new Date(),
				})
				.where(eq(schema.adminConfig.id, existingAdmin.id));
			console.log('✅ Synced .env bot variables to admin_config database');
		}
	}

	// Seed default cleanup states if not exists
	try {
		await pool.query(
			`INSERT INTO cleanup_state (cleanup_type, cleaned_months, cleaned_days, created_at, updated_at)
			 VALUES ('transcripts', '[]', '[]', NOW(), NOW())
			 ON CONFLICT (cleanup_type) DO NOTHING`
		);
		await pool.query(
			`INSERT INTO cleanup_state (cleanup_type, cleaned_months, cleaned_days, created_at, updated_at)
			 VALUES ('3month', '[]', '[]', NOW(), NOW())
			 ON CONFLICT (cleanup_type) DO NOTHING`
		);
	} catch {
		// cleanup_state may not have unique constraint on cleanup_type yet
		// Check if rows exist first
		const existing = await db.select().from(schema.cleanupState);
		if (existing.length === 0) {
			await db.insert(schema.cleanupState).values([
				{ cleanupType: 'transcripts', cleanedMonths: '[]', cleanedDays: '[]' },
				{ cleanupType: '3month', cleanedMonths: '[]', cleanedDays: '[]' },
			]);
		}
	}

	// Migrate existing upstream to providers table if empty
	const providerCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(schema.providers);
	if (!providerCount[0] || Number(providerCount[0].count) === 0) {
		const defaultEndpoint =
			existingAdmin?.upstreamEndpoint ||
			envUpstreamEndpoint ||
			'https://api.openai.com';
		const defaultApiKey =
			existingAdmin?.upstreamApiKey || envUpstreamApiKey || '';
		if (defaultEndpoint && defaultApiKey) {
			await db
				.insert(schema.providers)
				.values({
					name: 'Default Provider',
					endpoint: defaultEndpoint,
					apiKey: defaultApiKey,
					isActive: true,
					priority: 100,
				});
			console.log('✅ Migrated legacy upstream config to providers table');
		}
	}

	// Migrate existing provider api_key values into provider_api_keys table (one-time)
	// Ensure custom_models table exists (new table for custom model support)
	try {
		const existingKeys = await db
			.select({ count: sql<number>`count(*)` })
			.from(schema.providerApiKeys);
		const keyCount = Number(existingKeys[0]?.count || 0);
		if (keyCount === 0) {
			// No keys in the new table yet — migrate from providers.api_key
			await pool.query(`
        INSERT INTO provider_api_keys (provider_id, api_key, request_count, created_at)
				SELECT id, api_key, 0, NOW() FROM providers WHERE api_key IS NOT NULL AND api_key != ''
      `);
			console.log(
				'✅ Migrated existing provider API keys to provider_api_keys table',
			);
		}
	} catch (err) {
		console.warn(
			'⚠️  Could not migrate provider API keys (table may not exist yet):',
			err,
		);
	}

	// Ensure custom_models table exists
	try {
		await pool.query(`
			CREATE TABLE IF NOT EXISTS custom_models (
				id SERIAL PRIMARY KEY,
				provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
				model_id TEXT NOT NULL,
				display_name TEXT,
				description TEXT,
				context_length INTEGER,
				max_output_tokens INTEGER,
				input_price_per_mtok INTEGER DEFAULT 0,
				output_price_per_mtok INTEGER DEFAULT 0,
				input_modalities TEXT,
				output_modalities TEXT,
				supported_features TEXT,
				is_active BOOLEAN NOT NULL DEFAULT true,
				created_at TIMESTAMP NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMP NOT NULL DEFAULT NOW()
			);
			CREATE INDEX IF NOT EXISTS idx_custom_models_provider_id ON custom_models(provider_id);
			CREATE INDEX IF NOT EXISTS idx_custom_models_model_id ON custom_models(model_id);
		`);
		console.log('✅ custom_models table ensured');
	} catch (err) {
		console.warn('⚠️  Could not ensure custom_models table:', err);
	}

	console.log('✅ Database initialized successfully');
}

export { pool };
