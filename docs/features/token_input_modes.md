# Token input accounting modes

Source of truth: `admin_config.token_input_mode` (Settings → Input token mode).  
Read path: `packages/proxy/src/utils/counting.ts` (`groupedInputSumSql`, `turnPromptTokensSql`, …).  
Storage is unchanged: each `request_logs` row keeps `prompt_tokens` (non-cache / billable), `cached_tokens`, `context_delta_tokens`, `turn_id`.

Changing the mode recalculates **all** aggregates at read time (Discord, admin dashboard, portal, limits). No need to rewrite historical rows.

## Modes

| Mode | What one “input” unit means | SQL idea |
|------|-----------------------------|----------|
| **`per_turn_peak`** (default) | Once per user prompt (`turn_id`): `MAX(prompt + cache)` across tool hops | Fair for agents; cache/context still included |
| **`full`** | Every upstream hop: `SUM(prompt + cache)` | Matches amanai / provider “In” per API call; explodes on tool loops |
| **`billable`** | Per turn: `GREATEST(0, SUM(context_delta))` | Legacy soft quota; mostly growth only |

### Worked example (1 user prompt, 5 hops)

Hops full-In: `10k → 11k → 12k → 14k → 15k`

| Mode | Counted input |
|------|----------------|
| `full` | 10+11+12+14+15 = **62k** |
| `per_turn_peak` | **15k** |
| `billable` | net growth ≈ **~5k** (depends on deltas) |

10 prompts in one session → **sum of each prompt’s peak** (not one session-wide max).

## Display labels (p / c)

Everywhere (Discord compact, admin/portal tables):

```text
100K (10K p + 90K c)
```

Long form (cards/tooltips):

```text
100K (10K prompt + 90K cache)
```

| Token | Meaning |
|-------|---------|
| **p / prompt** | Non-cache billable input (`prompt_tokens`) at the chosen hop(s) |
| **c / cache** | Cache-read tokens (`cached_tokens`) — context history served from cache |
| Headline number | Mode-aware total input (peak / full / delta) |

In `per_turn_peak`, **p** and **c** are taken from the **peak hop** of each turn (the hop with max `prompt+cache`), then summed across turns. So `p + c` should equal the headline input.

Spaces are required between the number and `p`/`c` so Discord does not render `606.2Kp`.

## Prompt limit vs API calls vs input tokens (do not confuse)

| Metric | Meaning | Storage / count | Window |
|--------|---------|-----------------|--------|
| **Prompts** | 1 per user turn (`turn_id`) | `prompt_limit`; gate on new turn only; display `COUNT(DISTINCT turn_id)` in window | e.g. 50 / 5h |
| **API calls** | Every successful upstream hop | `rate_limit` / `global_rate_limit`; count all 2xx rows | e.g. 1000 / 5h |
| **Prompts** (stats field `requests`) | Distinct turns in a period (UI label: Prompts) | `COUNT(DISTINCT turn_id)` | Today / week / … |
| **API calls / hops** (Logs table) | Every upstream API row | One `request_logs` row per hop | Same period |
| **Input tokens (display)** | Mode-aware sum (default: peak) | See modes above | Cards / Discord |
| **Daily/monthly token limit** | **Input** by hop in turn: hop1 100%; hops 2–5 0%; then 10% +10%/5 hops; hop ≥50 = 100%. **Output always 100%.** | `weightedHopTotalTokensSql` | WIB day / month |
| **Full input (amanai)** | `SUM(prompt+cache)` every hop | Informational on Key Detail | — |
| **Output tokens** | `SUM(completion)` | Per turn aggregation | Daily output limit |

Defaults (global): **50 prompts / 5h** and **1000 API calls / 5h**.

Tool follow-ups do **not** burn prompt quota (same `turn_id`) but **do** burn API-call quota. Token **limit** charges input on a graduated hop schedule and output at 100%; logs still store full 100%.

### Hop input schedule (limit only)

| Hop in turn | Input (+cache) | Output |
|-------------|----------------|--------|
| 1 | 100% | 100% |
| 2–5 | 0% | 100% |
| 6–10 | 10% | 100% |
| 11–15 | 20% | 100% |
| … | +10% every 5 hops | 100% |
| ≥50 | 100% | 100% |

### Real example (ZCode agent, imam77, one WIB day)

| Metric | Value |
|--------|------:|
| Hops in Logs | ~150 |
| Turns / prompts | **3** |
| Peak input (credit) | **~180K** |
| Full input (amanai-style) | **~8.6M** |

One user prompt can spawn 50–100+ tool hops. Amanai bills every hop; our default `per_turn_peak` bills once per prompt at the largest context snapshot. This is **not** the orphan-turn undercount bug.

A user can show **0 prompts** in the rolling prompt window and still have large **input today** if:

1. Counted prompts fell outside the prompt window but hops still occurred today, or  
2. **Bug / edge case:** a turn was created via the turn_id safety net without `is_counted_request` (orphan turn start). Proxy should mark that first hop counted — see `persistLogAndSession` in `proxy.ts`.

Tool follow-ups are **not** prompts (`is_counted_request = false`) but **do** bill tokens.

## Switching modes

1. Dashboard → Settings → **Input token mode**  
2. Or SQL: `UPDATE admin_config SET token_input_mode = 'per_turn_peak' WHERE id = 1;`  
3. Stats cache is cleared on settings PUT; Discord ranking refreshes on its interval.

Valid values: `per_turn_peak` | `full` | `billable`.

## Related code

- Counting: `packages/proxy/src/utils/counting.ts`
- Settings API: `packages/proxy/src/routes/admin/settings.ts`
- Format helpers: `packages/dashboard/src/lib/utils.ts` `formatInputBreakdown`, portal twin, `packages/bot/src/index.js`
- Live usage bars: `packages/proxy/src/utils/live-usage.ts`
- Rate limits overview: `docs/features/rate_limiting_and_tokens.md`
