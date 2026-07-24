---
name: ui-ux-pro
description: >-
  Polish admin dashboard and client portal UI for monit_api (Groupy Proxy).
  Use when editing Trial Settings, Add-ons, Settings roles, Key Detail, LiveUsage,
  portal Overview/Keys/Models, or any packages/dashboard or packages/portal UI.
---

# UI/UX Pro — monit_api dashboard & portal

## Vocabulary (always)

| Term | Meaning |
|------|---------|
| Prompts | User turns / prompt quota (e.g. 50/5h) |
| API calls | Hop / request count |
| Tokens | Input/output / daily token pool |
| Premium | Required Discord role for trial + add-on |
| Pro | Higher social tier; **no** proxy bonus |
| Phantom | Base daily tokens (global, e.g. 2M) |
| Add-on | Pack: +daily tokens, model unlocks, bypasses per-model prompt caps |

## Layout rules

1. **One job per section** — Access · Limits · Models · Messages · Actions (trial); Catalog · Assign · Help (addons).
2. **Dense admin is OK** — use existing Tailwind cards, borders, muted labels; do not invent a new design system.
3. **Hierarchy** — page title → short help strip → primary actions → advanced collapsed.
4. **Mobile-safe forms** — stack fields on small screens; avoid wide multi-column editors without collapse.
5. **No EN/ID mix in one sentence** — prefer clear Indonesian or English consistently per page; labels can stay English if rest of dashboard is English.

## Do

- Show stacked daily as `base + pack = effective` when add-on active.
- Hide per-model **prompt** rows when add-on bypasses them; still show pack **token** subcaps.
- Badge trial keys clearly (1d / 1M / all models).
- Group Discord roles: Premium · Pro · Phantom in one Settings block.

## Don't

- Don't put allowlist pickers / subcap editors in the first viewport of Add-ons — collapse under Edit.
- Don't show confusing 5/20 per-model prompt bars for users with an active pack.
- Don't invent purple glow / generic AI marketing chrome; match existing dashboard chrome.
- Don't rewrite unrelated Settings monolith sections in a trial/addon pass.

## Trial defaults to surface in UI

- Duration: **1 day** · Daily tokens: **1M** · Models: **all** (or whitelist) · Auto supported.
