# Ops Scripts

Production and maintenance scripts live under `scripts/` (repo root). Do **not** leave one-off `temp_*.cjs` / probe dumps in the repo root.

## Keep / use these

| Script | Purpose |
|--------|---------|
| `scripts/deploy.mjs` | SSH deploy (git sync, build, pm2 restart). Needs `DEPLOY_SSH_PASSWORD`. |
| `scripts/probe-model-identity.mjs` | Example: list online models + ask each for self-reported identity via the proxy. |
| `scripts/daily-trim.mjs` | DB / log trim maintenance |
| `scripts/migrate-sqlite-to-pg.mjs` | One-time SQLite → Postgres migration |
| `scripts/wait-for-port.cjs` | Dev helper for waiting on a local port |

Proxy package also has typed maintenance under `packages/proxy/scripts/` (token backfills, counting audits).

## One-off diagnostics

If you need a throwaway SSH/psql check:

1. Run it locally or under `/tmp` on the server — **do not commit** `temp_*.cjs` to the repo root.
2. Prefer extending `scripts/probe-model-identity.mjs` or a small named script under `scripts/` if it will be reused.
3. Never commit API keys, Discord IDs with secrets, or raw `.env` dumps.

## Deploy

See [deploy_script.md](./deploy_script.md).
