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

- Each billable hop that was going to be a prompt still becomes `+1 turn` (≈ +1 API call for Kyra no-log).
- Write path sets `is_counted_request = true` only when `floor((turns+1)/N) > floor(turns/N)`.
- **Read path (gate / portal / Discord):** `prompt_used = floor(turn_count / N)` — never `SUM(is_counted_request)`
  (historical pre-fix rows were all counted=true and made Prompt bar rise 1:1 with API calls).
- API-call count, token math, amanai dual-path — unchanged.

So **46 API calls → 0 prompts**; **100 API calls → 1 prompt**; **1000 → 10**.

## Leaderboards (Discord / admin Top Users & Top Models by Prompts)

Prompt rankings go through [`account-usage-stats.ts`](packages/proxy/src/utils/account-usage-stats.ts):

- **Top Users — By Prompts:** `getAccountUsageAggregates` → `requests = floor(turns / N)` for diluted accounts
- **Top Models — By Prompts:** `getTopModelsByPromptRequests` → each account contributes `floor(turns_on_model / N)` toward the model total

Token rankings are **not** diluted (real hop-weighted usage).

So Kyra with 504 raw turns today shows **5** prompts on the user board; her minimax turns contribute `floor(N/100)` to that model’s prompt rank.

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

-- ALWAYS set a clean single JSON object (do NOT string-concat — that breaks JSON.parse)
UPDATE admin_config
SET account_usage_overrides = jsonb_build_object(
  '1354723954891292745',
  jsonb_build_object('turnsPerPrompt', 100, 'noLogKeepIde', true)
)::text
WHERE id = 1;

-- inspect (must be ONE object, not pasted duplicates)
SELECT account_usage_overrides FROM admin_config WHERE id = 1;

-- verify Kyra log IDE is kept + UA / IP null
SELECT api_key_id, ide_detected, user_agent_raw, ip_address, is_counted_request
FROM request_logs
WHERE api_key_id IN (479, 2)
ORDER BY created_at DESC LIMIT 10;
```

> **Note:** an early seed used text `||` which pasted multiple JSON objects into one cell.
> That makes `JSON.parse` fail and silently disables overrides. The parser now takes the
> first object if it sees `}{`, and the bootstrap SQL above rewrites a clean value.

## Tuning

- Lower `turnsPerPrompt` (e.g. 50) → stricter prompt quota.
- Add more account ids to the JSON map.
- Cache TTL is 30 s in `account-usage-overrides.ts`; admin-save routes should call
  `refreshAccountUsageOverridesCache()` after updates.