# Per-Account Usage Overrides (Kyra Mode)

Lets admin apply per-Discord-account tweaks without adding columns to `api_keys`
(adding columns caused drizzle 500s in earlier deploys — overrides must be JSON).

Stored in `admin_config.account_usage_overrides` (text JSON).

## Shape

```json
{
  "1354723954891292745": {
    "turnsPerPrompt": 100,
    "noLogKeepIde": true
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `turnsPerPrompt` | int > 0 | Meter this account as turns. Only every Nth **counted** hop counts as a prompt (Kyra 100:1). Without it the account is metered normally. |
| `noLogKeepIde` | bool | For `is_no_log` keys: retain `ideDetected` on `request_logs`. All other PII (UA / IP / OS / fingerprint / session / previews / transcript) stays stripped. No “Anonymous” labels. |

## How the meter works

A no-log account normally breaks turn grouping (synthetic session id, no chat_sessions row),
so every hop gets counted as a fresh prompt — for a tool-loop agent this explodes.

With `turnsPerPrompt = N`:

- Each billable hop that was going to be `is_counted_request` still becomes `+1 turn`.
- Only every Nth turn gets `is_counted_request = true`.
- `checkPromptLimit` and `checkModelPromptLimit` return the **counted-prompt** value
  (`SUM(CASE WHEN is_counted_request THEN 1 ELSE 0 END)`), not `COUNT(DISTINCT turn_id)`.
- API-call count, token math, amanai dual-path — unchanged.

So 1000 hops at 100:1 = 10 prompts; API-call count still 1000.

## IDE preservation

For no-log keys with `noLogKeepIde`:

- `request_logs.ide_detected` keeps the detected IDE (Cursor / Antigravity / Roo Code / etc.).
- `client_name` is derived from the IDE.
- `chat_sessions` / `devices` are still skipped for no-log keys (only `request_logs` gets IDE).

## Files

- Config: [`packages/proxy/src/utils/account-usage-overrides.ts`](packages/proxy/src/utils/account-usage-overrides.ts)
- Schema column: `admin_config.account_usage_overrides` in [`packages/proxy/src/db/schema.ts`](packages/proxy/src/db/schema.ts)
- Bootstrap migration + Kyra seed: [`packages/proxy/src/db/index.ts`](packages/proxy/src/db/index.ts) (ALTER TABLE + UPDATE)
- Write-side gate: [`packages/proxy/src/routes/proxy.ts`](packages/proxy/src/routes/proxy.ts) (`noLogKeepIde`, `turnsPerPrompt`)
- Read-side gate: [`packages/proxy/src/utils/rate-limit.ts`](packages/proxy/src/utils/rate-limit.ts) (`checkPromptLimit` / `checkModelPromptLimit` / `countAccountTurnHitsInWindow`)
- Portal / Discord display: [`packages/proxy/src/utils/live-usage.ts`](packages/proxy/src/utils/live-usage.ts)
- Strip helper: [`packages/proxy/src/utils/edge-key.ts`](packages/proxy/src/utils/edge-key.ts) (`applyNoLogFields(entry, noLogKeepIde)`)

## Bootstrapping / inspecting (manual SQL)

```sql
-- add column (idempotent)
ALTER TABLE admin_config
  ADD COLUMN IF NOT EXISTS account_usage_overrides text NOT NULL DEFAULT '{}';

-- seed Kyra (idempotent)
UPDATE admin_config
SET account_usage_overrides = COALESCE(account_usage_overrides, '{}'::text) ||
  jsonb_build_object('1354723954891292745',
    jsonb_build_object('turnsPerPrompt', 100, 'noLogKeepIde', true))::text
WHERE id = 1;

-- inspect
SELECT account_usage_overrides FROM admin_config WHERE id = 1;

-- verify Kyra log IDE is kept + UA / IP null
SELECT api_key_id, ide_detected, user_agent_raw, ip_address, is_counted_request
FROM request_logs
WHERE api_key_id IN (479, 2)
ORDER BY created_at DESC LIMIT 10;
```

## Tuning

- Lower `turnsPerPrompt` (e.g. 50) → stricter prompt quota.
- Add more account ids to the JSON map.
- Cache TTL is 30 s in `account-usage-overrides.ts`; admin-save routes should call
  `refreshAccountUsageOverridesCache()` after updates.