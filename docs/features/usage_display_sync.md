# Usage Display Sync (Shared Account vs Per-Key)

Single source of truth for how **usage today** is counted and shown across:

- Proxy gate (enforcement)
- Portal Overview / Keys
- Discord Usage embed (+ DM after key provision)
- Admin Live Usage / Key Detail

When changing formulas or labels, update **all** surfaces listed here and this doc.

## Canonical transparent breakdown API

The backend exposes one account-level explanation contract for every usage UI:

- Portal (authenticated account): `GET /portal/stats/usage-breakdown?period=1d`
- Admin (existing admin API-key route): `GET /admin/keys/:id/usage-breakdown?period=1d`
- Discord (internal bot route): `GET /admin/internal/discord/users/:discordUserId/usage-explanation?days=1`

Allowed periods are `1d`, `3d`, `7d`, and `30d`; default is `1d`. These are
rolling windows ending at request time, not calendar buckets. Invalid periods
return HTTP 400. `from` and `to` are UTC ISO timestamps and `timezone` is
`Asia/Jakarta`, the product's display/accounting timezone.

Both endpoints are **account scoped**. The portal uses the authenticated
Discord account. Admin resolves `:id` to its `discord_user_id`, then includes
logs from every API key with that value (including inactive sibling keys).
An unlinked admin key returns HTTP 422.

### Display vocabulary and information architecture

Never expose internal meter names or use the ambiguous label **Raw tokens**.
All user-facing surfaces use:

- **Input processed** = billable input + cached input. This is traffic context,
  not necessarily the amount charged to a limit.
- **Output generated** = completion/output tokens, separate from input.
- **Counted toward limits** = canonical input counted + canonical output
  counted. This is the value supplied by the gate meter.
- **Prompts** = distinct user turns.
- **Upstream calls** = request-log hops, including retry, continuation, and
  tool-step calls.
- **Total traffic** may appear only as tertiary context, explicitly described
  as input + output and not as a quota value.

Portal Overview and Admin Key Detail show a compact summary/trigger. The trigger
opens an accessible dialog with rolling 1/3/7/30-day controls, exact range, and
By IDE / By Model tables. Discord uses the same labels in a compact embed.

The IDE and model tables show Input processed, Output generated, and Counted
toward limits as separate columns. Each table independently partitions the same
account snapshot; never add the IDE table to the model table.

### Where counted values come from

For every successful upstream call:

1. **Input processed** is only descriptive traffic:
   `prompt_tokens + cached_tokens`.
2. When `upstream_credits > 0`, the canonical meter uses:
   - input units before hop weighting:
     `max(0, upstream_credits - upstream_credits_out)`
   - output units:
     `upstream_credits_out`
3. When upstream credits are absent, the fallback uses:
   - input: `(prompt_tokens + cached_tokens) × model input multiplier`
   - output: `completion_tokens × model output multiplier`
4. The configured hop schedule is applied to input. In `first_rest_flat`, the
   first call in a prompt is 100% and later calls use the configured follow-up
   percentage. Output uses its canonical output meter.
5. The account total is the sum of these canonical per-call results.

Therefore Input processed and Output generated are not expected to equal Input
counted and Output counted. Retries, continuations, tool steps, upstream usage
credits, model multipliers, and hop weights can all change the counted values.
The API's `composition` object exposes how many calls used each source and the
pre-weight input/output units so Portal/Admin/Discord can explain the result.
It also exposes the raw processed input/output attached to each path, allowing
the UI to render a complete reconciliation:

```text
upstream-metered calls:
  processed input tokens → input credit units
  generated output tokens → output credit units

local-fallback calls:
  processed input tokens × model multiplier → local input units
  generated output tokens × model multiplier → local output units

input units × hop schedule + output units → counted toward limits
```

The UI must not imply that upstream credit units equal raw tokens. Credit units
are the upstream's reported usage measure. For non-credit providers, the local
fallback remains directly derived from raw input/output and configured model
multipliers.

`Usage Today` quota bars are calendar-day counters since **00:00 WIB** and are
independent from the analytics period selector. Transparent explanation periods
use the same WIB calendar-aligned boundaries as analytics (`1d` = Today,
`3d` = today plus the previous two WIB dates, etc.), so equal selectors produce
equal account snapshots.

### Response contract

```json
{
  "period": "1d",
  "from": "2026-08-14T16:00:00.000Z",
  "to": "2026-08-15T16:00:00.000Z",
  "timezone": "Asia/Jakarta",
  "totals": {
    "turns": 12,
    "apiCalls": 31,
    "hops": 31,
    "success": 29,
    "fail": 2,
    "rawBillableInput": 10000,
    "cachedInput": 4000,
    "output": 3000,
    "total": 17000,
    "inputTowardLimit": 8200,
    "outputTowardLimit": 3000,
    "amountTowardLimit": 11200
  },
  "towardLimit": {
    "input": 8200,
    "output": 3000,
    "total": 11200,
    "source": "canonical-limit-meter",
    "explanation": "Canonical gate meter: upstream credits when present; otherwise configured model multipliers and flat hop weighting (25%). Output is weighted by the canonical output meter."
  },
  "byIde": [{ "name": "cursor", "...same totals fields": "..." }],
  "byModel": [{ "name": "claude-sonnet-4", "...same totals fields": "..." }]
}
```

`byIde` and `byModel` rows contain `name` plus every field in `totals`, including
`amountTowardLimit`; blank values are grouped as `unknown`. Groups sort by
`amountTowardLimit`, then API calls.

### Field meaning

- `turns`: distinct successful non-null `turn_id` values.
- `apiCalls` / `hops`: all request-log hops, successful or failed.
- `success` / `fail`: hop counts by HTTP 2xx / non-2xx status.
- `rawBillableInput`: successful-hop `prompt_tokens` before multipliers.
- `cachedInput`: successful-hop `cached_tokens` before multipliers.
- `output`: successful-hop `completion_tokens` before multipliers.
- `total`: the raw transparent sum of those three fields. It is informational,
  not the enforced amount.
- `inputTowardLimit`, `outputTowardLimit`, `amountTowardLimit`: canonical
  enforced meter. They call the same `weightedHopInputTokensSql` and
  `weightedHopTotalTokensSql` helpers as gates and existing surfaces; this
  service intentionally does not duplicate the billing formula.
- Canonical input uses upstream credits when available; otherwise it applies
  the account tier's configured model multiplier and current hop weighting.
  Canonical output likewise uses upstream output credits/model multiplier.

All consumers should display this contract directly. Do not recompute
`amountTowardLimit` in portal, dashboard, bot, or admin clients.

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
| Devices | `listAccountDevices` / gate `countRegisteredSlots` | Account-scoped slots (machine\|ide fingerprint); provisional excluded from count |
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
