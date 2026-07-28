# Token Saver

Pipeline (before upstream): **RTK → Groupy Compact → Headroom → Caveman → Ponytail → Soft Batch**.

**Anti-Waste** runs in parallel (IDE loop guard): nudge → tool dedupe → optional short-circuit.

## Groups

| Group | Features | Default enable |
|-------|----------|----------------|
| **Groupy Token Saver** | Anti-Waste, Groupy Compact, Soft Batch | ON / ON / ON |
| **Token Saver** (classic) | RTK, Headroom, Caveman, Ponytail | ON / OFF / OFF / OFF |

## Intensity

Each feature supports:

- **preset** — lite / balanced / aggressive (or Caveman 1–5, Ponytail lite/full/ultra)
- **custom** — free numbers (admin + portal full; Discord stepped + link to portal)

Anti-Waste balanced defaults: `nudgeAt=3`, `dedupeAt=4`, `shortCircuitAt=8`.

Aggressive / custom outside the safe zone shows confirm (portal/Discord) or yellow banner (admin).

## Kill switches

- `X-Token-Saver: off` — disable pipeline
- `X-Anti-Waste: off` — disable Anti-Waste only
- Env `ANTI_WASTE_ENABLED=0` — server-wide Anti-Waste kill

## Surfaces

Admin Settings, User Portal Settings, Discord Token Saver panel (Usage).
