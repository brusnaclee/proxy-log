import { db } from './src/db/index.js';
import { adminConfig } from './src/db/schema.js';

async function check() {
  const config = await db.select().from(adminConfig).get();
  console.log('Upstream URL:', config.upstreamEndpoint);
  console.log('Upstream Key:', config.upstreamApiKey);
  process.exit(0);
}
check();
