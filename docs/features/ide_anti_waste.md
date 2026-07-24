# IDE Detection Gaps & Smart Anti-Waste

## Why hops ≠ prompts

One **user prompt** = one `turn_id`. Agent IDEs (Cline, Roo, Continue, Cursor, OpenCode, …) send **every tool result** as a new HTTP hop to the proxy → upstream. Prompt quota counts turns; API-call quota counts hops.

## Detection (Phase 0)

UA + content fallback ([`detect-ide.ts`](../../packages/proxy/src/utils/detect-ide.ts)):

| New / fixed label | How |
|---|---|
| Zed | UA `Zed/…` |
| OpenAI Go SDK | UA `OpenAI/Go` |
| Bun Client | UA `Bun/…` |
| Pi Agent | UA `pi/…` |
| Tokito Probe | `TokitoProbe` / `TokitoCompare` |
| OkHttp Client / Postman | UA |
| OpenClaw / Ralph / Cursor (from Node UA) | content fingerprints |

Generic UAs (`node`, Bun, SDKs, …) re-run `detectIdeFromContent` via `GENERIC_IDE_LABELS`.

## Anti-waste (model-agnostic, no stream cut)

Flag: `ANTI_WASTE_ENABLED` (default **on**) or header `X-Anti-Waste: off`.

| Stage | When | Effect |
|---|---|---|
| Soft nudge | identical noisy tool ≥ 2 (profile) | Inject system line — still upstream |
| Tool dedupe stub | seen ≥ 3 | Replace huge tool dump with `[cached]…` stub — still upstream, fewer tokens |
| Short-circuit | consecutive identical ≥ 5 **and** request `tools` includes a safe agent tool (`ask_followup_question`, `attempt_completion`, `ask_question`) | Local SSE/JSON with synthetic **`tool_calls`** (never plain assistant text) — skip upstream; log `response_preview=short_circuited` |
| Short-circuit skip | threshold met but no safe agent tool | Dedupe + nudge only; **forward upstream** (avoids illegal text-only replies that break Cline/Continue) |

Profiles: [`ide-profiles.ts`](../../packages/proxy/src/utils/ide-profiles.ts). Write/edit tools never short-circuited.

Plain `finish_reason: stop` text was removed because agent IDEs require a tool call and otherwise loop with `[ERROR] You did not use a tool`.

## Testing

```bash
pnpm --filter proxy test
```

Includes detect-ide fixtures + ~10 prompt×duplicate-read harness per IDE profile.

## Ops

- Disable instantly: `ANTI_WASTE_ENABLED=0` in server `.env` + restart `proxy-api`.
- Per-request: `X-Anti-Waste: off`.
