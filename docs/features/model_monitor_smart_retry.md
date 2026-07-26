# Model Monitor & Smart Retry

## Auto modes (`admin_config.monitor_auto_mode`)

| Mode | Probes (10-min / retry) | Published catalog (`model_monitor.is_online`) |
|------|-------------------------|-----------------------------------------------|
| `off` | Skipped (unless admin force sweep) | Unchanged by sweeps |
| `notif_only` (default) | Always run, including admin force-OFF models | **Heal Online** when probe OK; probe fail keeps published as-is; Discord/admin notif on changes |
| `auto` | Always run | Probe OK → Online; probe fail → Offline |

### Force-OFF sticky

Admin deactivate sets a force-deactivated error message and published OFF. Sweeps still **probe** those models (latency / HTTP status update) but **never** clear force-OFF or publish Online until an admin activates again.

### Soft-suspend

After consecutive probe failures, `model_test_state` may soft-suspend a model from the retry sweep. The full 10-minute cadence ignores soft-suspend by default so trial-critical models keep getting retested.

## Bot sweep behavior

- Full sweep / provider-prefix sweeps / retry sweeps **do not skip** force-OFF rows.
- Proxy `upsertModelStatus(..., { source: "sweep" })` applies the mode rules above.
- Live traffic key-exhaustion paths may still flip published Offline even in `notif_only` (separate from probe heal).

## Related

- Proxy store: `packages/proxy/src/utils/model-monitor-store.ts`
- Admin routes: `packages/proxy/src/routes/admin/monitor.ts`
- Bot sweeps: `packages/bot/src/index.js` (`runFullSweep`, `runRetrySweep`)
