# Token input accounting modes

Two separate knobs:

1. **`token_input_mode`** (Settings → Input token mode) — stats tables / optional peak-view notes only.  
2. **`token_limit_weight_*`** (Settings → Token limit hop schedule) — **daily/monthly gates**, live usage bars, Discord leaderboard tokens, portal limit bars.

Source: `packages/proxy/src/utils/counting.ts` + `hop-weight.ts`.  
Storage unchanged: each `request_logs` row keeps full `prompt_tokens` / `cached_tokens` / `completion_tokens`.

## Limit hop schedule (`token_limit_weight_mode`)

| Mode | Input credit | Output |
|------|----------------|--------|
| **`first_rest_flat`** (default) | Hop 1 = 100%; hops 2+ = flat % (`token_limit_weight_percent`, default **100**) | 100% |
| **`flat_all`** | Every hop = flat % | 100% |
| **`peak`** | `MAX(prompt+cache)` once per turn | 100% |
| **`full`** | 100% every hop (amanai-style for limits) | 100% |
| **`custom`** | Ranges `{fromHop,toHop,percent}` JSON | 100% |

## Stats display modes (`token_input_mode`)

| Mode | Meaning |
|------|---------|
| **`per_turn_peak`** | MAX(prompt+cache) once per turn |
| **`full`** | SUM every hop |
| **`billable`** | context_delta (legacy) |

Does **not** change gates when limit schedule is configured.

## Amanai-style full In

`SUM(prompt+cache)` every hop — shown on **admin** Live Usage / Key Detail only. Hidden on portal client + Discord leaderboard.

## Alignment

Same limit schedule drives:

- Proxy daily/monthly input gates  
- Admin Live Usage input bar  
- Portal client input bar  
- Discord ranking “by tokens” (+ user-detail period stats)  
- **Top Models / by-model charts** (Discord embed, admin Key Detail & Analytics, portal Overview) via `modelLimitCreditBreakdownSql` — model rows sum toward the same Input/Total limit credit  

Prompts = distinct `turn_id`; API calls = hop rows — unchanged.
