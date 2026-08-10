# Vendor aliases

Per-upstream **vendor segment** overrides for nested model ids.

## Example

| Layer | Id |
|-------|-----|
| Upstream list / body | `amanai/glm-5.2` |
| Public catalog / clients / admin displays | `phantom/vibecode/glm-5.2` (or `vibecode/glm-5.2` in Monitor) |

Clients **must** use the public vendor (`phantom/vibecode/...`). Calling a raw-only upstream vendor (`phantom/amanai/...` when aliased away and not also someone else's public name) returns **404 Not found** (no alias details in the body). The proxy still forwards the **real** upstream id after resolving the public name.

## Collisions / chains

Public names may overlap another upstream vendor (allowed), e.g.:

```json
{ "ikan": "amanai", "tokito": "ikan" }
```

| Client asks | Resolves to |
|-------------|-------------|
| `amanai/...` | natural `amanai/...` **and/or** `ikan/...` (aliased → amanai) |
| `ikan/...` | `tokito/...` only (ikan itself is aliased away) |
| `tokito/...` | **404** (raw-only dead name) |

When two known upstream models share the same public id (same leaf), the proxy **picks randomly** among them each request.

**Logs:** on collision (`matchCount > 1`), model is stored as  
`phantom/amanai/glm-5.2 · ikan` — the part after `·` is the **real** vendor that was forwarded. No suffix when there was only one match.

`/v1/models` dedupes to a single public id per collision set.

## Config

Dashboard → Settings → Upstream Providers → expand a provider → **Vendor aliases**.

- Empty public name = use original vendor
- Stored on `providers.vendor_aliases` as JSON `{ "amanai": "vibecode" }`
- Seeded: providers with Amanai compat / `amanai/*` monitor rows get `amanai → vibecode` when the map is still empty
- Two different reals cannot share the **same** public name (still rejected). A public name **may** equal another real vendor key (collision / chain).

## Surfaces (all follow override on read)

Changing a vendor alias updates displays everywhere via `loadVendorAliasIndex` + `publicizeModelString` / `withPublicizedModels`:

- `/v1/models`, portal models, Client Catalog
- Admin **Model Monitor** table + Vendor filter (mutations reverse-map to raw DB ids)
- Admin logs / sessions / SSE / analytics / buglog / key detail / model-limits lists
- Portal overview by-model, logs, `/me` usage
- Discord ranking, model status panel, usage
- Recap Wrapped model names

## Storage (ops truth)

- `model_monitor.model_id` and upstream probes stay **raw** (`amanai/...`)
- New `request_logs.model` / session writes use the **public** form (+ ` · realVendor` on collision)
- Historical log rows are remapped on API read
