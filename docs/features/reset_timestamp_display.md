# Reset Timestamp Display Sync

How “when does this meter reset?” is shown on Discord, portal, and admin.

## Window types

| Meter | Clock | `resetAt` source |
|-------|--------|------------------|
| Daily In / Out / Total / dedicated pools | Next **00:00 WIB** | `dailyResetAt` (always set) |
| Monthly | 1st next month WIB | `monthlyResetAt` |
| Global prompts | Fixed/sliding **prompt window** (e.g. 5h) from first counted turn | `promptResetAt` when window open; else UI fallback “Resets {window} after first use” |
| API calls | Same style for hop window | `apiCallResetAt` + same fallback |
| Per-model prompts | Per-rule window (tease / override) | `modelUsage[].resetAt` / `modelUsageLimits[].resetAt` + `window` fallback |

## Surfaces

| Surface | File | Behavior |
|---------|------|----------|
| Discord Usage embed | `packages/bot` `buildUsageDetailEmbed` | `<t:unix:t> (<t:unix:R>)` or `Resets {window} after first use` |
| Discord `!agstatus` | same package | Same fields + In/Out get `dailyResetAt` |
| Portal Overview | `OverviewPage.tsx` | `Resets HH:MM · in Xh` on bars + per-model rows |
| Admin Key Detail LiveUsage | `LiveUsageCard.tsx` | Same as portal |
| Admin Overview search | `OverviewPage.tsx` | Prompt / API / per-model / tokens with reset text |

## API

- Portal `/me`, `buildLiveUsageForKey`, internal `user-detail` already emit reset ISO fields.
- Discord path also fills `modelUsage[].window` so fallback works when `resetAt` is null (0 used).

When changing reset math, update `rate-limit.ts` / `model-prompt-usage.ts` **and** keep these three UIs in sync (this doc).
