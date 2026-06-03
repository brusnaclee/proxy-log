// This migration file is no longer needed.
// PostgreSQL schema is managed via Drizzle pgTable definitions in schema.ts.
// The estimated_cost column is defined directly in the schema.

export async function up() {
  console.log('[migrate-cost] Skipped — PostgreSQL schema is managed via Drizzle push.');
}

// Auto-run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  up().catch(console.error);
}
