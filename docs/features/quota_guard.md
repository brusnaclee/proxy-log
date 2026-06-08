# 9Router Quota Guard Scheduler

## Overview

The Quota Guard Scheduler monitors 9Router provider quotas and automatically disables models or connections when quota drops below a configurable threshold. It uses a state-machine-based retry system with cooldowns, rechecks, and lockouts to handle transient quota issues gracefully.

This prevents downstream users from hitting quota errors when upstream providers are nearly exhausted.

---

## Retry Flow

```
IDLE → [quota low] → DISABLE → COOLDOWN (10 min) → ENABLE → WAIT-RECHECK (5 min)
                                                                    │
                                              ┌─── quota OK ────────┴───── quota low ────┐
                                              ▼                                           ▼
                                           IDLE                                    retry++
                                                                             retry <= 3?
                                                                              ├─ yes → COOLDOWN (10 min)
                                                                              └─ no  → LOCKOUT (1 hour) → ENABLE → WAIT-RECHECK (5 min)
                                                                                                                  │
                                                                                                    ┌── quota OK ──┴── quota low ──┐
                                                                                                    ▼                              ▼
                                                                                                 IDLE                    LOCKOUT (1 hour again, repeat)
```

### Step-by-Step Flow

1. **Every 1 minute**: Login to 9Router, fetch providers, check quotas.
2. **Quota low (<= 20%)**: Immediately DISABLE models/connections.
3. **Quota resets above threshold**: Enter COOLDOWN — wait 10 minutes.
4. **After 10 min cooldown**: ENABLE models/connections.
5. **After 5 min recheck window**: RECHECK quota.
6. **Recheck result**:
   - **Quota OK** → back to IDLE (normal 1 min monitoring).
   - **Still exhausted** → increment retry counter, DISABLE again.
7. **After 3 failed retries**: Enter LOCKOUT — disable for 1 hour.
8. **After 1 hour lockout**: ENABLE, recheck 5 min later.
9. **If still exhausted after lockout**: LOCKOUT again (repeat forever).

---

## Three Quota Types

| Provider | Quota Type | Quotas Key | Action When Low |
|----------|-----------|------------|-----------------|
| **antigravity** (alias `ag`) | Per-Model | `quotas["claude-sonnet-4-6"]`, etc. | Disable specific model |
| **glm** | Per-Session | `quotas["session"]` | Disable all connections |
| **minimax** | Per-Category | `quotas["M-series (5h)"]`, etc. | Disable all models in category |
| **xai** / **ollama** | No quota | `{"message": "Usage not available"}` | Skip |

---

## Configuration & Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NINEROUTER_BASE_URL` | `https://api3.tokito.xyz` | 9Router API base URL |
| `NINEROUTER_PASSWORD` | (required) | Password for 9Router login |
| `NINEROUTER_QUOTA_THRESHOLD` | `20` | Percentage threshold below which entities are disabled |
| `NINEROUTER_POLL_INTERVAL_MS` | `60000` (1 min) | How often to check quotas |

Hardcoded constants (in `quota-guard.ts`):
- **COOLDOWN_MS**: 10 minutes (wait before re-enable)
- **RECHECK_MS**: 5 minutes (wait after enable before recheck)
- **LOCKOUT_MS**: 1 hour (extended disable after 3 failed retries)
- **MAX_RETRIES**: 3 (normal retries before lockout)

---

## State Machine

Each entity (model, connection, or category) has its own independent state:

| Phase | Description |
|-------|-------------|
| `idle` | Normal monitoring. Disabling if quota is low. |
| `cooldown` | Disabled. Waiting 10 min (or 1 hr lockout) before enabling. |
| `waiting-recheck` | Enabled. Waiting 5 min before rechecking quota. |
| `locked-out` | (Uses `cooldown` phase with 1h wait) Extended disable. |

State is tracked in-memory per entity key (e.g. `"42:claude-sonnet-4-6"`, `"42:session"`, `"42:cat:M-series"`).

---

## Error Handling & Edge Cases

- **Login failure**: Skips the entire cycle. No entities are touched.
- **Provider fetch failure**: Skips the entire cycle.
- **Usage fetch failure**: Skips that specific provider.
- **No quota data**: Skips providers that return no quota (xai, ollama).
- **Scheduler disabled**: If `NINEROUTER_BASE_URL` or `NINEROUTER_PASSWORD` is not set, the scheduler does not start.
- **First run delay**: The scheduler waits 30 seconds after server start before the first cycle.
