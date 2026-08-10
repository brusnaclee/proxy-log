# Vendor aliases

Per-upstream **vendor segment** overrides for nested model ids.

## Example

| Layer | Id |
|-------|-----|
| Upstream list / body | `amanai/glm-5.2` |
| Public catalog / clients | `phantom/vibecode/glm-5.2` |

Clients may still call the old public form (`phantom/amanai/...`); the proxy accepts both and always forwards the **real** upstream id.

## Config

Dashboard → Settings → Upstream Providers → expand a provider → **Vendor aliases**.

- Empty public name = use original vendor
- Stored on `providers.vendor_aliases` as JSON `{ "amanai": "vibecode" }`
- Seeded: providers with Amanai compat / `amanai/*` monitor rows get `amanai → vibecode` when the map is still empty

## Surfaces

- `/v1/models`, portal models, settings model pickers — public form
- New `request_logs.model` rows — public form
- Admin logs / stats / ranks / Discord panels — remapped on read for historical rows
- Model Monitor admin table keeps **raw** upstream `modelId` (ops truth)
