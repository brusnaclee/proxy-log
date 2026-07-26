# Groupy Compact

Smart Token Saver step for **agent multi-hop** loops (Cline, Roo, OpenCode, Cursor, Claude Code, …).

**Tagline:** keep the last tools full, stub the rest before upstream.

## Why

One user prompt = one `turn_id`. Each IDE tool round-trip is a new hop that re-sends nearly the full conversation. RTK truncates individual dumps; Anti-Waste stubs *identical* re-reads. Neither collapses **older distinct** tool results that already ran earlier in the turn — so hop 40 still ships most of hops 1–39.

Groupy Compact stubs those older noisy tool bodies with a labeled marker so upstream input shrinks without deleting messages or breaking `tool_call_id` pairs.

## Pipeline position

```
RTK → Groupy Compact → Headroom → Caveman → Ponytail → Batch
```

Applied in `packages/proxy/src/utils/token-saver/` from `proxy.ts` step 7d (after Anthropic→OpenAI convert when applicable). See [`token_saver.md`](./token_saver.md) for the full pipeline overview with before/after case studies for every feature, including **Batch**, which reduces *hop count* rather than shrinking each hop's body like Compact does.

## Behavior

| Rule | Detail |
|------|--------|
| Recent window | Last **N** noisy tool dumps stay full (RTK may still compress them) |
| Older dumps | Replaced with `[groupy-compact] Earlier tool result for … Re-read if you need exact lines.` |
| Never touch | `assistant.tool_calls`, write/edit/patch/diff results, message order/roles |
| Fail-open | Exceptions leave the body unchanged |

### Levels (admin-only)

| Level | Keep last N | Stub if content longer than | Extra |
|-------|-------------|-----------------------------|--------|
| `lite` | 4 | 4000 chars | — |
| `balanced` (default) | 3 | 1500 chars | — |
| `aggressive` | 2 | 400 chars | Truncate old assistant prose (&gt;8k, no tool_calls) |

## Defaults & toggles

| Scope | Control |
|-------|---------|
| Global | `admin_config.token_saver_groupy_compact_enabled` default **true**, level **balanced** |
| User | Portal / Discord tri-state override (`null` = follow admin) |
| Request | `X-Token-Saver: off` disables **all** Token Saver features including Compact |

## What it does **not** change

- Hop count / prompt quota (IDE still decides how many tools to call)
- Limit weight / gate formulas
- Anti-Waste short-circuit behavior
- Probe/spam 1-token mega-hop loops (use Anti-Waste)

## Trade-off

Model may **re-read** a file that was stubbed → +1 small hop. Net savings usually remain large because later hops stop replaying the full dump.

## Related

- [`token_saver.md`](./token_saver.md) — full pipeline overview (RTK, Compact, Headroom, Caveman, Ponytail, Batch) with before/after examples
- [`ide_anti_waste.md`](./ide_anti_waste.md) — duplicate-tool stub + short-circuit
- [`rate_limiting_and_tokens.md`](./rate_limiting_and_tokens.md) — prompts vs hops
- Source: `packages/proxy/src/utils/token-saver/groupy-compact.ts`
