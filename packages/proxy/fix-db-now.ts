import { db } from './src/db/index.js';
import { adminConfig } from './src/db/schema.js';
import { eq } from 'drizzle-orm';

async function fix() {
  const admin = await db.select().from(adminConfig).get();
  if (admin) {
    await db.update(adminConfig)
      .set({
        upstreamEndpoint: 'https://api3.tokito.xyz/v1',
        upstreamApiKey: 'REDACTED_UPSTREAM_KEY'
      })
      .where(eq(adminConfig.id, admin.id))
      .run();
    console.log('Fixed admin config in DB!');
  }
  process.exit(0);
}
fix();
