# Model Catalog: clientOnline = admin Published (1:1)

After the migration, the **single source of truth** for client-side Online / Offline
is the admin **Published** toggle (`model_monitor.is_online`). Probe health is still
recorded and still visible in the admin Model Monitor page for ops, but it no longer
suppresses the Online label on `/v1/models`, the portal Models page, the Discord
API Checker buttons, or the user-dashboard model monitor.

## Why

Earlier this was `clientOnline = published && probeOk`. With `monitor_auto_mode = off`,
probes go stale, and Discord / portal / user dashboard drifted away from admin intent
even when admin had explicitly Published a model. Switching to `clientOnline = published`
makes every consumer agree 100% with the admin toggle — DC, user dashboard, gate, and
the chat 503 check.

| Surface | Field | After |
|---|---|---|
| `/v1/models` | `is_online` | = admin `is_online` (Published) |
| Portal Models | `online` | = admin `is_online` (Published) |
| Discord 3 buttons | Online / Offline icon | catalog `is_online` (Published) |
| Chat gate 503 | `requestable` | = admin `is_online` (Published) |
| Admin Model Monitor | Published + Probe columns | unchanged (probe shown separately) |

## Files

- Helper: [`packages/proxy/src/utils/model-monitor-store.ts`](packages/proxy/src/utils/model-monitor-store.ts) (`getClientCatalogFlags`)
- Pipeline consumers (no code changes needed — they already pipe through this helper):
  - [`packages/proxy/src/utils/model-catalog.ts`](packages/proxy/src/utils/model-catalog.ts) (`loadClientCatalogMonitorRows`)
  - `/v1/models` enrich, `/portal/models`, `/admin/internal/models/details`
  - Discord bot uses `is_online` from the catalog (not the live-gateway id presence).

## Probe remains informational

The Probe column on `/admin/monitor/models` still shows the last `http_status` /
`latency_ms` / `error_message` and `checked_at`. Sweeps, retries, and force-OFF rules
are unchanged. Only the **client label** for Online/Offline now mirrors admin Published.

## Manual override (ops)

```sql
-- Mark a model Published ON (admin intent)
UPDATE model_monitor SET is_online = TRUE, error_message = NULL WHERE model_id = '...';

-- Mark Published OFF (sticky)
UPDATE model_monitor SET is_online = FALSE,
  error_message = 'Force-deactivated by admin' WHERE model_id = '...';
```

After either, expect:
- `/v1/models` entry reflects the change within one portal refresh.
- Discord API Checker button panel shows the same within one open / refresh.
- Chat gate returns 200 if Published ON, 503 if Published OFF.