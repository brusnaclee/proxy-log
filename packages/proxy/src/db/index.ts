import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { migrateTokenSaverColumns } from './migrate-token-saver.js';
import { migrateModelIdentityColumns } from './migrate-model-identity.js';
import { migrateMonitorAutoModeColumn } from './migrate-monitor-auto-mode.js';

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
		await pool.query(`ALTER TABLE model_limits ADD COLUMN IF NOT EXISTS dedicated_quota boolean NOT NULL DEFAULT false`);
		await pool.query(`ALTER TABLE model_limits ADD COLUMN IF NOT EXISTS dedicated_pool_group text`);
		await pool.query(`CREATE INDEX IF NOT EXISTS idx_model_limits_dedicated_pool_group ON model_limits (dedicated_pool_group) WHERE dedicated_pool_group IS NOT NULL`);
		// Shared dedicated pool: gcli grok-4.5 + grok-4.6 → 30M total (group: gcli-grok)
		await pool.query(
			`DELETE FROM model_limits
			 WHERE scope = 'global' AND scope_id = 0 AND model = 'grok-4.5'
			   AND is_pattern = true AND dedicated_quota = true`,
		);
		await pool.query(
			`UPDATE model_limits SET model = 'tokitoV2/gcli/grok-4.5'
			 WHERE scope = 'global' AND scope_id = 0 AND model = 'tokito/gcli/grok-4.5'
			   AND is_pattern = true`,
		);
		// Drop legacy single-model pattern rows — shared pool below
		await pool.query(
			`DELETE FROM model_limits
			 WHERE scope = 'global' AND scope_id = 0
			   AND model IN ('tokitoV2/gcli/grok-4.5', 'tokitoV2/gcli/grok-4.6')
			   AND is_pattern = false`,
		);
		for (const gcliModel of ["tokitoV2/gcli/grok-4.5", "tokitoV2/gcli/grok-4.6"]) {
			const existingGcli = await pool.query(
				`SELECT id FROM model_limits
				 WHERE scope = 'global' AND scope_id = 0 AND model = $1 AND is_pattern = false
				 LIMIT 1`,
				[gcliModel],
			);
			if (existingGcli.rows[0]?.id) {
				await pool.query(
					`UPDATE model_limits SET
					   dedicated_quota = true,
					   dedicated_pool_group = 'gcli-grok',
					   daily_token_limit = 30000000,
					   prompt_limit = 0,
					   monthly_token_limit = 0,
					   daily_input_token_limit = 0,
					   daily_output_token_limit = 0
					 WHERE id = $1`,
					[existingGcli.rows[0].id],
				);
			} else {
				await pool.query(
					`INSERT INTO model_limits (
					   scope, scope_id, model, is_pattern, dedicated_quota, dedicated_pool_group,
					   prompt_limit, daily_token_limit, monthly_token_limit,
					   daily_input_token_limit, daily_output_token_limit
					 ) VALUES ('global', 0, $1, false, true, 'gcli-grok', 0, 30000000, 0, 0, 0)`,
					[gcliModel],
				);
			}
		}
		console.log('✅ Applied idempotent model_limits migrations (+ gcli grok-4.5/4.6 shared dedicated pool 30M)');
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
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_model_selection_mode text NOT NULL DEFAULT 'all'`);
		await pool.query(`UPDATE admin_config SET trial_model_selection_mode = 'all' WHERE trial_model_selection_mode = 'all_gpy'`);
		await pool.query(`ALTER TABLE admin_config ALTER COLUMN trial_model_selection_mode SET DEFAULT 'all'`).catch(() => undefined);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_model_whitelist text NOT NULL DEFAULT '[]'`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_upstreams text NOT NULL DEFAULT ''`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_panel_message_id text`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_embed_config text NOT NULL DEFAULT '{}'`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS trial_dm_templates text NOT NULL DEFAULT '{}'`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS pro_role_id text DEFAULT '1354682701453725857'`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS contributor_role_id text DEFAULT '1354642624895778866'`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS troubleshooter_role_id text DEFAULT '1354683007427936366'`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS moderator_role_id text DEFAULT '1354683043478110309'`);
		await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS role_limit_modes text NOT NULL DEFAULT '{}'`);
		await pool.query(`UPDATE admin_config SET required_role_id = '1354646304042651728' WHERE required_role_id IS NULL OR required_role_id = ''`);
		await pool.query(`UPDATE admin_config SET trial_required_role_id = '1354682641961582632' WHERE trial_required_role_id IS NULL OR trial_required_role_id = ''`);
		await pool.query(`UPDATE admin_config SET pro_role_id = '1354682701453725857' WHERE pro_role_id IS NULL OR pro_role_id = ''`);
		await pool.query(`UPDATE admin_config SET contributor_role_id = '1354642624895778866' WHERE contributor_role_id IS NULL OR contributor_role_id = ''`);
		await pool.query(`UPDATE admin_config SET troubleshooter_role_id = '1354683007427936366' WHERE troubleshooter_role_id IS NULL OR troubleshooter_role_id = ''`);
		await pool.query(`UPDATE admin_config SET moderator_role_id = '1354683043478110309' WHERE moderator_role_id IS NULL OR moderator_role_id = ''`);
		await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false`);
		await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_window_start text`);
		await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS role_limit_mode text`);
		await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS account_badges text NOT NULL DEFAULT '[]'`);
		await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS account_tier text NOT NULL DEFAULT ''`);
		await pool.query(`ALTER TABLE addon_assignments ADD COLUMN IF NOT EXISTS role_sync_action text`);
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

	// Token Saver columns (admin_config + user_portal_settings)
	await migrateTokenSaverColumns();

	// Model identity profile columns (model_metadata)
	await migrateModelIdentityColumns();

	// Monitor auto mode (off | notif_only | auto)
	await migrateMonitorAutoModeColumn();

	// Token input mode (full = prompt+cache, billable = context_delta)
	const { migrateTokenInputModeColumn } = await import('./migrate-token-input-mode.js');
	await migrateTokenInputModeColumn();
	try {
		await pool.query(
			`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_limit_weight_percent integer NOT NULL DEFAULT 100`,
		);
		await pool.query(
			`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_limit_weight_mode text NOT NULL DEFAULT 'first_rest_flat'`,
		);
		await pool.query(
			`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_limit_weight_custom text NOT NULL DEFAULT '[]'`,
		);
	} catch (_) {}
	try {
		await pool.query(
			`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS addon_required_models text NOT NULL DEFAULT '[]'`,
		);
	} catch (_) {}
	try {
		const { refreshTeaseLimitsCacheFromDb } = await import("../utils/tease-limits-cache.js");
		await refreshTeaseLimitsCacheFromDb();
	} catch (_) {}
	try {
		const { refreshUpstreamScrubSecretsFromDb } = await import(
			"../utils/upstream-leak-scrub.js"
		);
		await refreshUpstreamScrubSecretsFromDb();
	} catch (_) {}
	try {
		await pool.query(
			`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS token_multiplier_rules text NOT NULL DEFAULT '[]'`,
		);
	} catch (_) {}
	try {
		const { setTokenInputModeCache, setTokenLimitWeightConfigCache } = await import('../utils/counting.js');
		const { setTokenMultiplierRulesCache } = await import('../utils/token-multiplier.js');
		const modeRow = await pool.query(
			`SELECT token_input_mode, token_limit_weight_percent, token_limit_weight_mode, token_limit_weight_custom, token_multiplier_rules FROM admin_config LIMIT 1`,
		);
		setTokenInputModeCache(modeRow.rows[0]?.token_input_mode);
		setTokenLimitWeightConfigCache({
			mode: modeRow.rows[0]?.token_limit_weight_mode,
			percent: modeRow.rows[0]?.token_limit_weight_percent,
			custom: modeRow.rows[0]?.token_limit_weight_custom,
		});
		setTokenMultiplierRulesCache(modeRow.rows[0]?.token_multiplier_rules);
	} catch (_) {}

	// Add-ons (assignable model access + quota packs)
	try {
		await pool.query(`
			CREATE TABLE IF NOT EXISTS addons (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				description TEXT NOT NULL DEFAULT '',
				model_allowlist TEXT NOT NULL DEFAULT '[]',
				access_mode TEXT NOT NULL DEFAULT 'allowlist',
				model_denylist TEXT NOT NULL DEFAULT '[]',
				model_daily_limits TEXT NOT NULL DEFAULT '{}',
				daily_token_limit INTEGER NOT NULL DEFAULT 0,
				monthly_token_limit INTEGER NOT NULL DEFAULT 0,
				daily_input_token_limit INTEGER NOT NULL DEFAULT 0,
				daily_output_token_limit INTEGER NOT NULL DEFAULT 0,
				prompt_limit INTEGER NOT NULL DEFAULT 0,
				prompt_limit_window TEXT NOT NULL DEFAULT '1d',
				max_devices INTEGER NOT NULL DEFAULT 0,
				default_duration_days INTEGER NOT NULL DEFAULT 0,
				discord_role_id TEXT,
				is_active BOOLEAN NOT NULL DEFAULT true,
				created_at TIMESTAMP NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMP NOT NULL DEFAULT NOW()
			)
		`);
		await pool.query(`ALTER TABLE addons ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'allowlist'`);
		await pool.query(`ALTER TABLE addons ADD COLUMN IF NOT EXISTS model_denylist TEXT NOT NULL DEFAULT '[]'`);
		await pool.query(`ALTER TABLE addons ADD COLUMN IF NOT EXISTS model_daily_limits TEXT NOT NULL DEFAULT '{}'`);
		await pool.query(`ALTER TABLE addons ADD COLUMN IF NOT EXISTS max_devices INTEGER NOT NULL DEFAULT 0`);
		await pool.query(`ALTER TABLE addons ADD COLUMN IF NOT EXISTS default_duration_days INTEGER NOT NULL DEFAULT 0`);
		await pool.query(`
			CREATE TABLE IF NOT EXISTS addon_assignments (
				id SERIAL PRIMARY KEY,
				addon_id INTEGER NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
				discord_user_id TEXT,
				api_key_id INTEGER REFERENCES api_keys(id) ON DELETE CASCADE,
				starts_at TIMESTAMP NOT NULL DEFAULT NOW(),
				expires_at TIMESTAMP,
				is_active BOOLEAN NOT NULL DEFAULT true,
				assigned_by TEXT NOT NULL DEFAULT 'dashboard',
				created_at TIMESTAMP NOT NULL DEFAULT NOW()
			)
		`);
		await pool.query(`CREATE INDEX IF NOT EXISTS idx_addon_assignments_addon ON addon_assignments (addon_id)`);
		await pool.query(`CREATE INDEX IF NOT EXISTS idx_addon_assignments_discord ON addon_assignments (discord_user_id)`);
		await pool.query(`CREATE INDEX IF NOT EXISTS idx_addon_assignments_key ON addon_assignments (api_key_id)`);
		console.log('✅ Applied idempotent addons migrations');
	} catch (err: any) {
		console.warn('⚠️ addons migration warning:', err?.message || err);
	}

	// Unique index on devices(api_key_id, fingerprint) — prevents duplicate device rows
	try {
		await pool.query(`DROP INDEX IF EXISTS idx_devices_api_key_fingerprint`);
		await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_api_key_fingerprint ON devices (api_key_id, fingerprint)`);
		console.log('✅ Applied idempotent devices unique index migration');
	} catch (err: any) {
		console.warn('⚠️ devices unique index migration warning (may have duplicate data):', err?.message || err);
	}

	// Device challenges + portal notifications + provisional flag
	try {
		await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_provisional BOOLEAN NOT NULL DEFAULT false`);
		await pool.query(`
			CREATE TABLE IF NOT EXISTS device_challenges (
				id SERIAL PRIMARY KEY,
				discord_user_id TEXT NOT NULL,
				api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
				fingerprint TEXT NOT NULL,
				ide_detected TEXT,
				user_agent_raw TEXT,
				ip_address TEXT,
				status TEXT NOT NULL DEFAULT 'pending',
				token TEXT NOT NULL,
				expires_at TIMESTAMP NOT NULL,
				created_at TIMESTAMP NOT NULL DEFAULT NOW(),
				resolved_at TIMESTAMP
			)
		`);
		await pool.query(`CREATE INDEX IF NOT EXISTS idx_device_challenges_discord ON device_challenges (discord_user_id)`);
		await pool.query(`CREATE INDEX IF NOT EXISTS idx_device_challenges_fp ON device_challenges (fingerprint)`);
		await pool.query(`CREATE INDEX IF NOT EXISTS idx_device_challenges_status ON device_challenges (status)`);
		await pool.query(`
			CREATE TABLE IF NOT EXISTS user_notifications (
				id SERIAL PRIMARY KEY,
				discord_user_id TEXT NOT NULL,
				type TEXT NOT NULL,
				title TEXT NOT NULL DEFAULT '',
				message TEXT NOT NULL DEFAULT '',
				payload TEXT NOT NULL DEFAULT '{}',
				created_at TIMESTAMP NOT NULL DEFAULT NOW(),
				read_at TIMESTAMP,
				actionable_until TIMESTAMP
			)
		`);
		await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_notifications_discord ON user_notifications (discord_user_id)`);
		await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_notifications_created ON user_notifications (created_at)`);
		// Default max devices 2 for Discord/trial keys that were still at 1
		await pool.query(`
			UPDATE api_keys SET max_devices = 2, updated_at = NOW()
			WHERE max_devices = 1
			  AND is_active = true
			  AND (
			    provisioned_by IN ('discord-bot', 'trial-bot', 'admin-override')
			    OR is_trial = true
			  )
		`);
		await pool.query(`
			UPDATE admin_config SET global_max_devices = 2
			WHERE global_max_devices IS NULL OR global_max_devices = 0 OR global_max_devices = 1
		`);
		console.log('✅ Applied device_challenges / user_notifications / max_devices=2 migration');
	} catch (err: any) {
		console.warn('⚠️ device challenge migration warning:', err?.message || err);
	}

	// Provider compat_profile (default | amanai) — Amanai credit cache shaping
	try {
		await pool.query(`
			ALTER TABLE providers
			ADD COLUMN IF NOT EXISTS compat_profile TEXT NOT NULL DEFAULT 'default'
		`);
		await pool.query(`
			UPDATE providers
			SET compat_profile = 'amanai'
			WHERE compat_profile = 'default'
			  AND (
			    lower(endpoint) LIKE '%amanai.dev%'
			    OR lower(name) LIKE '%amanai%'
			  )
		`);
		console.log('✅ Applied providers.compat_profile migration');
	} catch (err: any) {
		console.warn('⚠️ providers.compat_profile migration warning:', err?.message || err);
	}

	// Provider vendor_aliases — public vendor rename (amanai → vibecode, etc.)
	try {
		await pool.query(`
			ALTER TABLE providers
			ADD COLUMN IF NOT EXISTS vendor_aliases TEXT NOT NULL DEFAULT '{}'
		`);
		await pool.query(`
			UPDATE providers
			SET vendor_aliases = '{"amanai":"vibecode"}'
			WHERE (vendor_aliases IS NULL OR vendor_aliases = '' OR vendor_aliases = '{}')
			  AND (
			    compat_profile = 'amanai'
			    OR lower(endpoint) LIKE '%amanai.dev%'
			    OR EXISTS (
			      SELECT 1 FROM model_monitor m
			      WHERE m.provider = providers.name
			        AND m.model_id LIKE 'amanai/%'
			    )
			  )
		`);
		console.log('✅ Applied providers.vendor_aliases migration (+ amanai→vibecode seed)');
	} catch (err: any) {
		console.warn('⚠️ providers.vendor_aliases migration warning:', err?.message || err);
	}

	// request_logs.upstream_credits — Compat Pricing v3 meter
	try {
		await pool.query(`
			ALTER TABLE request_logs
			ADD COLUMN IF NOT EXISTS upstream_credits INTEGER NOT NULL DEFAULT 0
		`);
		console.log('✅ Applied request_logs.upstream_credits migration');
	} catch (err: any) {
		console.warn('⚠️ request_logs.upstream_credits migration warning:', err?.message || err);
	}

	// request_logs.upstream_credits_out — output share of upstream_credits (Total = In + Out)
	try {
		await pool.query(`
			ALTER TABLE request_logs
			ADD COLUMN IF NOT EXISTS upstream_credits_out INTEGER NOT NULL DEFAULT 0
		`);
		console.log('✅ Applied request_logs.upstream_credits_out migration');
	} catch (err: any) {
		console.warn('⚠️ request_logs.upstream_credits_out migration warning:', err?.message || err);
	}

	// Backfill out-part for recent credit hops (legacy rows had uc_out=0 → Total looked == Input)
	try {
		const { computeUpstreamCreditPartsForHop } = await import('../utils/amanai-credits.js');
		const pending = await pool.query(`
			SELECT id, model, prompt_tokens, cached_tokens, completion_tokens, upstream_credits
			FROM request_logs
			WHERE upstream_credits > 0 AND COALESCE(upstream_credits_out, 0) = 0
			ORDER BY id DESC
			LIMIT 12000
		`);
		let updated = 0;
		for (const row of pending.rows as any[]) {
			const parts = computeUpstreamCreditPartsForHop({
				model: String(row.model || ''),
				promptTokens: Number(row.prompt_tokens) || 0,
				cachedTokens: Number(row.cached_tokens) || 0,
				completionTokens: Number(row.completion_tokens) || 0,
				amanaiCompat: true,
			});
			const total = Number(row.upstream_credits) || parts.total;
			const outCredits = Math.min(total, parts.outCredits);
			if (outCredits <= 0) continue;
			await pool.query(
				`UPDATE request_logs SET upstream_credits_out = $1 WHERE id = $2 AND COALESCE(upstream_credits_out, 0) = 0`,
				[outCredits, row.id],
			);
			updated++;
		}
		if (updated > 0) console.log(`✅ Backfilled upstream_credits_out on ${updated} log rows`);
	} catch (err: any) {
		console.warn('⚠️ upstream_credits_out backfill warning:', err?.message || err);
	}

	// model_monitor: one row per (model_id, provider) — concurrent sweeps used to insert twins
	try {
		await pool.query(`
			DELETE FROM model_monitor a
			USING model_monitor b
			WHERE a.model_id = b.model_id
			  AND COALESCE(a.provider, '') = COALESCE(b.provider, '')
			  AND a.id < b.id
		`);
		await pool.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_model_monitor_model_provider
			ON model_monitor (model_id, COALESCE(provider, ''))
		`);
		console.log('✅ Applied model_monitor unique (model_id, provider) index');
	} catch (err: any) {
		console.warn('⚠️ model_monitor unique index migration warning:', err?.message || err);
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

	// provider_api_keys health columns (invalid key / last check)
	try {
		await pool.query(`
			ALTER TABLE provider_api_keys ADD COLUMN IF NOT EXISTS last_error TEXT;
			ALTER TABLE provider_api_keys ADD COLUMN IF NOT EXISTS last_checked_at TEXT;
			ALTER TABLE provider_api_keys ADD COLUMN IF NOT EXISTS last_model_count INTEGER DEFAULT 0;
		`);
		console.log('✅ provider_api_keys health columns ensured');
	} catch (err) {
		console.warn('⚠️  Could not ensure provider_api_keys health columns:', err);
	}

	// Auth sessions (admin dashboard + portal client) — survive PM2 restart
	try {
		const { ensureAuthSessionsTable, startAuthSessionPurgeJob } = await import('../utils/auth-sessions.js');
		await ensureAuthSessionsTable();
		startAuthSessionPurgeJob();
		console.log('✅ auth_sessions table ensured');
	} catch (err) {
		console.warn('⚠️  Could not ensure auth_sessions table:', err);
	}

	try {
		const { ensureAdminAuditLogsTable } = await import('../utils/admin-audit.js');
		await ensureAdminAuditLogsTable();
		console.log('✅ admin_audit_logs table ensured');
	} catch (err) {
		console.warn('⚠️  Could not ensure admin_audit_logs table:', err);
	}

	try {
		const { ensureVibecodeCatalog } = await import('../utils/addons.js');
		await ensureVibecodeCatalog();
		console.log('✅ Vibecode add-on catalog ensured');
	} catch (err) {
		console.warn('⚠️  Could not ensure Vibecode catalog:', err);
	}

	// Per-key calendar-day overrides (WIB)
	try {
		await pool.query(`
			CREATE TABLE IF NOT EXISTS key_day_overrides (
				id SERIAL PRIMARY KEY,
				api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
				day_wib TEXT NOT NULL,
				extra_daily_input INTEGER NOT NULL DEFAULT 0,
				extra_daily_output INTEGER NOT NULL DEFAULT 0,
				extra_daily_total INTEGER NOT NULL DEFAULT 0,
				extra_prompt_limit INTEGER NOT NULL DEFAULT 0,
				extra_rate_limit INTEGER NOT NULL DEFAULT 0,
				note TEXT,
				created_at TIMESTAMP NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMP NOT NULL DEFAULT NOW()
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_key_day_overrides_key_day ON key_day_overrides (api_key_id, day_wib);
			CREATE INDEX IF NOT EXISTS idx_key_day_overrides_day ON key_day_overrides (day_wib);
		`);
		console.log('✅ key_day_overrides table ensured');
	} catch (err) {
		console.warn('⚠️  Could not ensure key_day_overrides table:', err);
	}

	console.log('✅ Database initialized successfully');
}

export { pool };
