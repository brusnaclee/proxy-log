// This migration file is no longer needed.
// PostgreSQL schema is managed via Drizzle pgTable definitions in schema.ts.
// Rate limit columns are defined directly in the schema.

export async function up() {
  console.log('[migrate-ratelimit] Skipped — PostgreSQL schema is managed via Drizzle push.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  up().catch(console.error);
}
