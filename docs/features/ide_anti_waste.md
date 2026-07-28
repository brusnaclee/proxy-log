# IDE Anti-Waste

Stops identical noisy tool loops (read/search/shell) without a hard 429.

## Stages

1. **Nudge** — soft system hint after `nudgeAt` consecutive identical signatures  
2. **Dedupe** — stub duplicate dumps after `dedupeAt` seen count  
3. **Short-circuit** — synthetic `ask_followup_question` / `attempt_completion` after `shortCircuitAt` (skips upstream)

## Partial reads

Signatures include **path + line range** (or content sample). Reading lines 1–80 then 81–160 of the same file does **not** count as an identical loop.

## Config

Part of **Groupy Token Saver** (default ON). Intensity preset/custom via admin, portal, Discord. See [token_saver.md](./token_saver.md).
