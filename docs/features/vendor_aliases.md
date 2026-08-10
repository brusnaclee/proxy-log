# Vendor aliases

Per-upstream **vendor segment** overrides for nested model ids.

## Example

| Layer | Id |
|-------|-----|
| Upstream list / body | `amanai/glm-5.2` |
| Public catalog / clients / admin displays | `phantom/vibecode/glm-5.2` (or `vibecode/glm-5.2` in Monitor) |

Clients may still call the old public form (`phantom/amanai/...`); the proxy accepts both and always forwards the **real** upstream id.

## Config

Dashboard → Settings → Upstream Providers → expand a provider → **Vendor aliases**.

- Empty public name = use original vendor
- Stored on `providers.vendor_aliases` as JSON `{ "amanai": "vibecode" }`
- Seeded: providers with Amanai compat / `amanai/*` monitor rows get `amanai → vibecode` when the map is still empty

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
- New `request_logs.model` / session writes use the **public** form
- Historical log rows are remapped on API read
