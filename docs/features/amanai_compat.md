# Amanai-compatible upstream profile

Admin **Upstream Providers** has two orthogonal knobs:

| Field | Values | Meaning |
|-------|--------|---------|
| **Type** (`endpoint_type`) | `openai` / `anthropic` / `youcom` | Wire format + URL path |
| **Compat** (`compat_profile`) | `default` / `amanai` | Extra request shaping layered on Type |

- `openai` + `amanai` → OpenAI chat/responses **with** Amanai cache shaping + dual Anthropic + nested model ids  
- `anthropic` + `amanai` → Anthropic Messages **with** Amanai cache shaping  
- `default` → Type-only behavior (no cache injection)

New providers whose endpoint contains `amanai.dev` (or name contains `amanai`) default to **Compat = amanai**. Existing matching rows are backfilled on boot.

## Why (credits)

Per [Amanai Billing / Pricing Engine v3](https://ai.amanai.dev/docs/billing/):

```
credits = ceil( (input - cache_read) * m_in + cache_read * m_cache + output * m_out )
m_cache = 0.25 × m_in   # 75% discount on cached input
```

At ~60% cache-hit, effective input ≈ `0.55 × m_in`. One-shot requests get little benefit; multi-turn agent traffic (stable system + tools) benefits most. Successful requests also have a **1,000 credit minimum**.

## What Amanai compat does on upstream hit

1. **Prompt-cache breakpoints** — injects `cache_control: { type: "ephemeral" }` on:
   - last tool definition
   - system / developer prompt (as text content blocks)
   - first large user message (≥200 chars), when breakpoint budget remains (max 4)
2. **Dual Anthropic** — OpenAI-type amanai providers still accept native `/v1/messages` clients without translating away cache markers when possible
3. **Nested model ids** — keep `amanai/glm-5.2` form for catalog routing

Shaping runs **late** (after Token Saver / role sanitize) so breakpoints match the final prefix.

## Verify savings

Compare dashboard / Amanai usage `cache_read` (or OpenAI `prompt_tokens_details.cached_tokens`) before vs after enabling Compat=amanai on the same workload. If cache_read stays ~0, markers may be unsupported for that model route — leave Compat=default.

## Code

- `packages/proxy/src/utils/amanai-compat.ts`
- Gate: `packages/proxy/src/routes/proxy.ts` (`buildAnthropicBodyForProvider`, `openaiBodyBytesForProvider`)
- UI: `packages/dashboard/src/components/ProvidersManager.tsx`
