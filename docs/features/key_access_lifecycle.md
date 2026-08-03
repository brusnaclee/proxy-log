# Key Access Lifecycle (Phantom / Pro / Add-on)

How Discord-linked **non-trial** API keys stay `is_active` during daily role sync.

## Policy (stay alive)

Keep key active if **any** of:

1. Discord **Phantom** role  
2. Discord **Staff** (moderator / troubleshooter / contributor)  
3. **Active add-on** assignment in DB (not expired, `is_active`)  
4. Discord **pack role** for an active add-on catalog entry (e.g. vibecode role) — backup if assignment lookup misses  

**Pro / Premium alone do not keep the key alive.** Without Phantom/Staff/add-on the key is disabled; quota for Pro is `zero_unless_addon` anyway.

## Quota vs key active (do not confuse)

| State | Key `is_active` | Daily base In/Out | Pack |
|-------|-----------------|-------------------|------|
| Phantom only | on | global base | — |
| Phantom + add-on | on | base + pack (stack) | until expiry |
| Pro/Premium + add-on (no Phantom) | **on** until pack ends | base **0** (`zero_unless_addon`) | pack only |
| Pro/Premium, no add-on | **off** (daily sync) | 0 | — |
| Add-on expired, no Phantom/Staff | **off** | — | — |

So: losing Phantom while a paid pack is still running must **not** disable the key. Pack-only users keep access until `expires_at`.

## Implementation

| Piece | File |
|-------|------|
| `shouldKeepKeyAccess` / `syncUserKeyAccess` | `packages/proxy/src/utils/key-access-lifecycle.ts` |
| Active assignment query (+ sibling keys, SQL `NOW()`) | `packages/proxy/src/utils/addons.ts` → `getActiveAddonsForUser` |
| Pack Discord role IDs | `listActiveAddonDiscordRoleIds` |
| Daily bot recheck | `packages/bot` → `runDailyInactiveMemberCleanup` → `/admin/internal/sync-user-access` |
| Proxy daily bulk | `syncAllDiscordLinkedKeyRoles` (24h interval; fail-open if Discord unconfirmed) |

**Never disable** when Discord role fetch is unconfirmed (rate-limit / network).

**Before disable:** re-run `getActiveAddonsForUser`; abort disable if a pack is still active.

## Ops

- Re-evaluate one user: `POST /admin/internal/sync-user-access` `{ discordUserId, rolesKnown?, roleIds? }`  
- After assign/extend/expire pack: `syncUserKeyAccessAfterAddonChange`  
- Unit tests: `key-access-lifecycle.test.ts`

## Related

- [`rate_limiting_and_tokens.md`](./rate_limiting_and_tokens.md) — stack / hard caps  
- Add-ons admin UI — assign / revoke  
