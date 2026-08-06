# Device slots (max 2 + confirmation)

## Overview

Each Discord/trial account has a limited number of **device slots** (default **2**). A slot is identified by a fingerprint of **machine + IDE**, not IP.

When all slots are full and a new IDE/client appears, the proxy **does not rotate the API key**. Instead it opens a **30-minute confirmation challenge** (Discord DM + portal popup/bell). While pending, the new device gets **provisional** access.

## Fingerprint

```
sha256("slot:" + machineHint + "|ide:" + normalizedIde)
```

| Signal | Role |
|--------|------|
| Machine hint (OS + arch from UA / `sec-ch-ua-platform`) | Same PC bucket |
| Normalized IDE name (`Cursor`, `Cline`, …) | Separate slot per IDE |
| IP | Logging only — **not** identity |
| UA version bumps | Stripped via machine hint + IDE name — **same slot** |

Cursor ↔ Cline on the same machine = **two** slots.

## Limits

- Default `maxDevices` for Discord / trial / pack = **2**
- `0` = unlimited (no challenge path)
- `99` left unchanged (special ops)
- One-shot migrate: active Discord/trial keys with `max_devices = 1` → `2`

Slot count = **distinct registered fingerprints** (provisional and blocked rows excluded).

## Challenge state machine

1. Fingerprint blacklisted (`allowed_devices.listType = 'block'`) → **403** (enforced even if `devicePolicy = none`)
2. Fingerprint already registered → allow + `lastSeen`
3. Registered count &lt; max → register new slot
4. Over limit + open valid challenge for FP → allow provisional
5. Over limit + no challenge → open/reuse challenge (30m TTL, 5m DM cooldown), provisional allow, queue Discord DM + `user_notifications`

### Approve (“Ya itu saya”)

Delete the **oldest** registered slot (`lastSeen` / `firstSeen`), promote the challenged fingerprint to registered, clear provisional.

### Deny (“Bukan saya”)

Remove provisional row. Record deny on `device_challenges`. **Second deny** for the same fingerprint → insert account-scoped `allowed_devices` block rule → subsequent requests **403**.

### Expire (30m no answer)

Challenge → `expired`; provisional revoked. Same FP may open a new challenge after cooldown.

## Tables

- `device_challenges` — durable challenge + token for Discord customId / portal actions
- `user_notifications` — portal history (popup only while pending & before `actionable_until`; recent list keeps expired items disabled)
- `devices.is_provisional` — provisional flag

## Surfaces

| Surface | Behavior |
|---------|----------|
| Proxy gate | Challenge / provisional / blacklist |
| Discord bot | DM with Ya / Bukan saya buttons → internal approve/deny |
| Portal | Auto modal + bell Yes/No; Devices show registered / pending / blacklist + unblock |
| Admin Key Detail | Devices + pending challenges + history; Block/Unblock writes `allowed_devices` |

## Code map

- `packages/proxy/src/utils/crypto.ts` — `generateFingerprint`
- `packages/proxy/src/utils/device-slots.ts` — slot count / oldest
- `packages/proxy/src/utils/device-challenge.ts` — open / approve / deny / expire
- `packages/proxy/src/routes/proxy.ts` — gate
- `packages/bot/src/index.js` — `device_chal:yes|no:*`
