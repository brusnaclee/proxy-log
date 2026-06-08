import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

// DATABASE_URL: loaded by dotenv (may not be set at ES module import time)
// getPool()/getDb() defer creation so dotenv has time to load first
function getPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  return new pg.Pool({
    connectionString: url,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

let _db: ReturnType<typeof drizzle> | null = null;
function getDb() {
  if (!_db) _db = drizzle(getPool(), { schema });
  return _db;
}

// Lazy proxy: actual pg.Pool created only on first query (after dotenv loads)
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_, prop) {
    return (getDb() as any)[prop];
  },
});

export { getPool as pool };

/**
 * Initialize the database — push schema via Drizzle and seed defaults.
 */
export async function initializeDatabase() {
  try {
    await getPool().query('SELECT 1');
    console.log('✅ PostgreSQL connection established');
  } catch (err) {
    console.error('❌ Failed to connect to PostgreSQL:', err);
    throw err;
  }

  const envUpstreamEndpoint = (process.env.UPSTREAM_ENDPOINT || '')
    .trim()
    .replace(/\/$/, '');
  const envUpstreamApiKey = (process.env.UPSTREAM_API_KEY || '').trim();

  // Seed default admin if none exists
  const existingAdminRows = await db.select().from(schema.adminConfig);
  const existingAdmin = existingAdminRows[0] ?? null;
  if (!existingAdmin) {
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin';
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
    const updates: Record<string, any> = {};
    if (envUpstreamEndpoint && existingAdmin.upstreamEndpoint !== envUpstreamEndpoint) {
      updates.upstreamEndpoint = envUpstreamEndpoint;
    }
    if (envUpstreamApiKey && existingAdmin.upstreamApiKey !== envUpstreamApiKey) {
      updates.upstreamApiKey = envUpstreamApiKey;
    }
    if (Object.keys(updates).length > 0) {
      await db
        .update(schema.adminConfig)
        .set(updates)
        .where(eq(schema.adminConfig.id, existingAdmin.id));
      console.log('✅ Updated upstream config from environment');
    }
  }

  // Seed default bot config
  const adminConfig = existingAdmin ?? (await db.select().from(schema.adminConfig))[0];
  if (adminConfig && !adminConfig.agverif_channel_id) {
    await db
      .update(schema.adminConfig)
      .set({
        agverif_channel_id: process.env.AGVERIF_CHANNEL_ID || null,
        tokito_channel_id: process.env.TOKITO_CHANNEL_ID || null,
        required_role_id: process.env.REQUIRED_ROLE_ID || null,
        owner_groupy_role_id: process.env.OWNER_GROUPY_ROLE_ID || null,
        verified_role_id: process.env.VERIFIED_ROLE_ID || null,
      })
      .where(eq(schema.adminConfig.id, adminConfig.id));
    console.log('✅ Seeded bot config from environment');
  }

  // Ensure admin_config has all required columns
  try {
    await getPool().query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admin_config' AND column_name='agverif_channel_id') THEN ALTER TABLE admin_config ADD COLUMN agverif_channel_id TEXT; END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admin_config' AND column_name='tokito_channel_id') THEN ALTER TABLE admin_config ADD COLUMN tokito_channel_id TEXT; END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admin_config' AND column_name='required_role_id') THEN ALTER TABLE admin_config ADD COLUMN required_role_id TEXT; END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admin_config' AND column_name='owner_groupy_role_id') THEN ALTER TABLE admin_config ADD COLUMN owner_groupy_role_id TEXT; END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admin_config' AND column_name='verified_role_id') THEN ALTER TABLE admin_config ADD COLUMN verified_role_id TEXT; END IF;
      END $$;
    `);
  } catch (err: any) {
    if (err.code !== '42701' && err.code !== '42P07') {
      console.warn('⚠️  Could not ensure admin_config columns:', err.message);
    }
  }

  // Ensure provider_api_keys table
  try {
    const keyCountResult = await getPool().query(`SELECT COUNT(*)::int as count FROM provider_api_keys`);
    const keyCount = (keyCountResult.rows[0] as any)?.count ?? 0;
    if (keyCount === 0) {
      await getPool().query(`
        INSERT INTO provider_api_keys (provider_id, api_key, request_count, created_at)
            SELECT id, api_key, 0, NOW() FROM providers WHERE api_key IS NOT NULL AND api_key != ''
            ON CONFLICT DO NOTHING
      `);
      console.log('✅ Migrated API keys from providers to provider_api_keys');
    }
  } catch (err: any) {
    if (err.code !== '42P01') {
      console.warn('⚠️  provider_api_keys migration check:', err.message);
    }
  }

  // Ensure custom_models table
  try {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS custom_models (
        id SERIAL PRIMARY KEY,
        provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        display_name TEXT,
        context_length INTEGER,
        input_price_per_1k NUMERIC(10,6),
        output_price_per_1k NUMERIC(10,6),
        modality TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(provider_id, model_id)
      );
    `);
  } catch (err: any) {
    if (err.code !== '42710' && err.code !== '42P07') {
      console.warn('⚠️  Could not ensure custom_models table:', err.message);
    }
  }
}
