# Monthly Recap (Wrapped)

Dual surface: Discord teaser + animated web story at `/recap/:apiKeyName`.

## Window (WIB)

- Open: day `daysInMonth - 2` of month M through day 5 of M+1 (e.g. Juli → 29 Jul–5 Agu).
- Panel visible from day 25 through day 5.
- Debug channel can generate anytime.

## Testimonials

- Table `recap_testimonials` (unique per user + `year_month`).
- Discord **Lihat Testimoni**: lists **all months**, rotates every 5s, expires in **10 minutes**.
- Submit via web form with day-token during open window.

## Stats source

Aggregates from `request_logs` / `chat_sessions` only (privacy: no previews/transcripts).
Additive `stats.story` enricher adds addon/burn/providers/schedule/token-saver/eggs without replacing core fields.

## Portal dashboard

- From the **25th** (panel visible) until open: one-time popup “ready in N days”; dismiss stored in `localStorage` until the open window.
- While **open** (H-2 → day 5 next month): popup “Show now / Close”; dedicated floating **Lihat Rekap** button always available.
- Show now / button → loading stages → `POST /portal/api/recap/open` (generate for that Discord user) → fade into `/recap/:apiKeyName`.
- After window closes, button + popups hide (same as Discord).
