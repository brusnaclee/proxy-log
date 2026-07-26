# Token Saver

Canonical overview of the full Token Saver pipeline: what each feature does, its default state, and a concrete before/after case study. For Groupy Compact's deep-dive (stub rules, levels), see [`groupy_compact.md`](./groupy_compact.md). For duplicate-tool-call handling, see [`ide_anti_waste.md`](./ide_anti_waste.md).

## Pipeline order

```
RTK → Groupy Compact → Headroom → Caveman → Ponytail → Batch
```

Applied in `packages/proxy/src/utils/token-saver/index.ts`, invoked from `proxy.ts` step 7d (after Anthropic→OpenAI conversion when applicable). Order matters only in that each step sees the output of the previous one.

## Two different kinds of "saving"

| Kind | What it shrinks | Features |
|------|------------------|----------|
| **Body size per hop** | Bytes sent to upstream in a single request | RTK, Groupy Compact, Headroom |
| **Number of hops** | How many round-trips a task needs in total | Batch |
| **Output verbosity** | Completion tokens the model writes back | Caveman, Ponytail |

Shrinking body size and shrinking hop count are complementary — a hop that never happens saves 100% of its (already-shrunk) body, including the growing history that every prior technique still has to re-send.

## Controls (same for every feature)

| Scope | Control |
|-------|---------|
| Global default | `admin_config.token_saver_*_enabled` (set in Dashboard → Settings → Token Saver) |
| Per-user override | Portal Settings or Discord `/token-saver` panel — tri-state **Default / On / Off** (`null` = follow admin) |
| Per-request kill switch | Request header `X-Token-Saver: off` disables **all** features for that one call |

## Features

### RTK (Real Token Killer)

- **What:** Truncates individual noisy `tool_result` bodies (git/grep/ls/read/shell output) to head+tail within a char budget. Skips write/edit/apply-diff results and never touches `tool_calls` JSON.
- **Default:** ON, budget 2000 chars.
- **Before → After:** a 50KB `git status` dump on a huge repo → truncated to ~2KB (head + tail), same information density for the model's next decision.

### Groupy Compact

- **What:** In long agent loops, keeps the last N tool results full and replaces **older** noisy dumps with a short stub marker (`[groupy-compact] Earlier tool result for …`). Never deletes messages or touches write/edit results.
- **Default:** ON, level `balanced` (keep last 3, stub if >1.5k chars).
- **Before → After:** a 150-hop Cline session where hop 120 would otherwise re-ship the full content of files read at hops 5, 12, 30, … → those are replaced by one-line stubs, so hop 120's body only carries the last 3 tool results in full.
- **Trade-off:** the model may occasionally re-read a stubbed file (one small extra hop) — still a net win since it stops that file from being re-shipped on every subsequent hop.

### Headroom (optional, external)

- **What:** POSTs the message history to an external `/compress` service before upstream. 3s timeout, fails open (request proceeds uncompressed on error/timeout).
- **Default:** OFF (needs an admin-configured URL; enabling without a URL is a no-op).
- **Before → After:** a 40-message history compressed down to ~15 messages by the external service.

### Caveman

- **What:** Injects a system-prompt directive asking the model to reply tersely (levels 1–5, from "cut filler words" to "telegram style"). Does not touch tools or tool_calls.
- **Default:** OFF (changes response style/tone — an explicit choice, not silently applied).
- **Before → After:** a 6-sentence explanatory paragraph → 2–3 short sentences at level 3.

### Ponytail

- **What:** Injects a directive to skip conversational boilerplate around tool use — no "Sure, I'll…" acknowledgements, no restating the plan, no post-tool summaries (levels `lite` / `full` / `ultra`).
- **Default:** OFF.
- **Before → After:** "Let me read that file for you now…" + tool call + "Great, I can see the file now, let me also check…" → just the tool call, straight through.

### Batch — reduce hop count, not just hop size

- **What:** Injects a system-prompt directive asking the model to plan ahead within a turn: request every read/search it foresees needing in **one response** (parallel `tool_calls`), instead of one file at a time; and emit all edit/write `tool_calls` for multiple files together instead of editing one file per round-trip. Skips requests using the legacy singular `functions`/`function_call` schema, since that format cannot structurally return more than one call.
- **Default:** ON (admin-configurable; user can override to Off in the portal).
- **Why this exists:** a 24h sample of live production traffic (`request_logs.response_preview`, counting `[tool_call:N …]` markers per hop) showed:

  | Metric | Value |
  |--------|-------|
  | Hops with exactly 1 tool call | 1,843 / 2,305 (80%) |
  | Hops with 2+ tool calls (already batched) | 462 / 2,305 (20%) |

  Per-model averages ranged from `tokitoV2/gcli/grok-4.5` (avg 2.41 calls/hop, 57% multi-call) down to `tokito/combogroupy` (avg 1.00, 0% multi-call) — i.e. whether a model batches its tool calls is mostly a **generation habit**, not a protocol constraint. Every provider proxied here already accepts multiple `tool_calls`/`tool_use` blocks per response (hops with up to 7 calls exist in production traffic today), and every IDE seen in that sample (Claude Code, OpenCode, Cline, Zed, Hermes, GitHub Copilot, Continue, Ralph Agent, n8n) already produced successful multi-call hops — so nudging this behavior does not introduce a new, unproven request shape.
- **Before → After (realistic estimate, not a guarantee):** a task needing 5 known files → was 5 separate reads = 5 upstream hits, each resending the growing conversation history → nudged to request all 5 together = 1 hit. This only helps the **batchable** portion of a session (exploration/reads/multi-file edits where the model already knows what it needs). It does **not** collapse inherently sequential steps (edit → run test → read error → fix → run again) — those require seeing feedback before the next action and cannot be pre-planned. For a complex multi-hundred-hop session, expect meaningfully fewer hops for models/IDEs that currently batch poorly (GLM, Gemini-Flash-heavy IDEs like Zed/Hermes/Copilot), and a smaller improvement where the model already batches well (Grok, Claude Opus, Continue, Cline).

## What none of these change

- Token **limit** accounting / gate formulas (see [`rate_limiting_and_tokens.md`](./rate_limiting_and_tokens.md))
- Anti-Waste's duplicate-call short-circuit behavior (separate mechanism, see [`ide_anti_waste.md`](./ide_anti_waste.md))
- What the model is allowed to do — every feature here only changes *how* the request is shaped or *how many* round-trips it takes, never the underlying capability.

## Source

- `packages/proxy/src/utils/token-saver/index.ts` — pipeline orchestration + flag resolution
- `packages/proxy/src/utils/token-saver/rtk.ts`, `groupy-compact.ts`, `headroom.ts`, `caveman.ts`, `ponytail.ts`, `batch.ts`
