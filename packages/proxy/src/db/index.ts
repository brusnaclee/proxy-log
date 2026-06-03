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

	console.log('✅ Database initialized successfully');
}

export { pool };
