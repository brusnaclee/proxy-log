# Usage Display Sync (Shared Account vs Per-Key)

Single source of truth for how **usage today** is counted and shown across:

- Proxy gate (enforcement)
- Portal Overview / Keys
- Discord Usage embed (+ DM after key provision)
- Admin Live Usage / Key Detail

When changing formulas or labels, update **all** surfaces listed here and this doc.

---

## 1. Scope rules

| Concept | Scope | Meaning |
|---------|--------|---------|
| **Shared account pool** | All `api_keys` with the same `discord_user_id` | Prompts, API calls, daily In/Out/Total, devices — **one remaining quota** |
| **Per-key contribution** | Single `api_key_id` | How much that key burned from the shared pool today — **not** a separate limit |

Extra keys do **not** add quota. Trial / Phantom / add-on limits attach to the account (synced across sibling keys).

---

## 2. Counting formulas (must match)

Reuse helpers in `packages/proxy/src/utils/counting.ts` + rate-limit windows:

| Metric | SQL / helper | Notes |
|--------|----------------|-------|
| Prompts | `turnCountSql` / `COUNT(DISTINCT turn_id)` on 2xx | 1 user turn = 1 prompt |
| API calls | `hopCountSql` | Every 2xx hop |
| Input toward limit | `weightedHopInputTokensSql` | Hop-weighted + token multipliers (trial = 1×) |
| Output toward limit | `turnCompletionTokensSql` / hop output credit | Output multiplier applied for paid |
| Total toward limit | `weightedHopTotalTokensSql` | In + Out credit |
| Prompt window | `checkPromptLimit` | Account key ids; cliff or sliding fallback |
| API window | `checkApiCallLimit` | Same account key ids |
| Devices | `listAccountDevices` / gate `countDistinctMachines` | Account-scoped slots |
| In-flight prompts | `tryReserveTurn` / `countReserved` | Gate-only; **must release after DB insert** or `dbUsed+reserved` double-counts vs dashboard |

Daily cutover: **midnight WIB** (`wibTodayStartDate` / period helpers).

Prompt/API **5h** reset label: show `≈ HH:MM WIB` (+ relative), never bare `00:18` without `WIB` (easy to confuse with calendar midnight). Token / `1d` per-model: `00:00 WIB`.

Do **not** invent a second formula in the bot or React — call the same internal/portal payloads.

---

## 3. API payloads

### Portal

| Endpoint | Shared | Per-key |
|----------|--------|---------|
| `GET /portal/api/me` | `usageToday`, `limits`, meters | — |
| `GET /portal/api/keys` | — | `requestsToday`, `apiCallsToday`, `inputToday`, `outputToday`, `tokensToday` |
| `GET /portal/api/keys/:id/devices` | Account device list via `listAccountDevices` | Rows tagged `isCurrentKey` / `ownerKey*` |

### Discord / bot

| Endpoint | Shared | Per-key |
|----------|--------|---------|
| `GET /admin/internal/stats/user-detail/:discordUserId` | Quotas, Today/Month fields, `accountKeyCount` | `keysToday[]` when ≥2 keys (`requests`, `apiCalls`, `promptTokens`, `completionTokens`, `tokens`) |

Embed builder: `buildUsageDetailEmbed` in `packages/bot/src/index.js`.

---

## 4. UI / copy conventions

Label clearly so users never confuse contribution with remaining:

| Surface | Shared label | Per-key label |
|---------|--------------|---------------|
| Portal Overview | “Shared account · N keys” | Point to Keys page |
| Portal Keys banner | “Account remaining (shared…)” | Card line = “this key” contribution |
| Portal Keys expand | “Account shared today” | “This key today” + devices |
| Discord Usage | “Today (shared all keys)” when N>1 | “Per key today (contribution only…)” |
| Key provision DM | Note: limits shared; Usage / portal Keys for detail | — |

Indonesian/English: keep one language per sentence; mirror existing portal `i18n` / bot `preferredLang`.

---

## 5. Files to touch together

| Change type | Files |
|-------------|--------|
| Token / hop / turn formula | `counting.ts`, `rate-limit.ts`, `token-multiplier.ts`, then portal `routes/portal`, admin `live-usage` / `internal`, Discord embed |
| Account device list | `account-devices.ts`, portal + admin `keys/:id/devices`, proxy gate |
| Display labels only | Portal Overview/Keys, bot `buildUsageDetailEmbed`, this doc |
| New meter field | Add to internal `user-detail` **and** portal `/me` or `/keys` **and** UI **and** this table |

---

## 6. Regression checklist

1. Multi-key Phantom (e.g. Override + Discord): Overview prompts = sum of per-key prompts; remaining one pool.
2. Expand Override key: devices from sibling Discord key visible; no `Internal server error`.
3. Discord Usage: Today labeled shared; per-key block shows prompts + API + In/Out.
4. Admin Live Usage matches Discord/portal for same Discord user (±1 request race).
5. Trial-only account: multipliers 1× on all surfaces.

---

## 7. Related docs

- [`rate_limiting_and_tokens.md`](./rate_limiting_and_tokens.md) — gate hierarchy & windows
- [`token_input_modes.md`](./token_input_modes.md) — peak / full / billable
- [`discord_bot_integration.md`](./discord_bot_integration.md) — bot commands / Usage button
