/**
 * Environment bootstrap — MUST be imported before anything that reads
 * process.env at module-evaluation time (e.g. db/index.ts, which captures
 * DATABASE_URL in a top-level const).
 *
 * ESM hoists all imports, so a `loadEnv()` call in index.ts body runs AFTER
 * its imported modules have already been evaluated. That meant DATABASE_URL
 * was only ever picked up from the ambient environment, never from the
 * project .env file, and the proxy failed to boot with
 * "password authentication failed for user monit_api" on a fresh server.
 *
 * Importing this module first guarantees the .env is loaded before any
 * dependency captures the variables it needs.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));

// dist/db/../ -> package root; src/db/../ -> package root as well.
const envCandidates = [
	resolve(process.cwd(), '.env'),
	resolve(process.cwd(), '../.env'),
	resolve(process.cwd(), '../../.env'),
	resolve(here, '../../.env'),
	resolve(here, '../../../.env'),
];

for (const p of envCandidates) {
	if (existsSync(p)) {
		// override: true so a stale ambient DATABASE_URL cannot win over the
		// project's own .env.
		loadEnv({ path: p, override: true });
		break;
	}
}
