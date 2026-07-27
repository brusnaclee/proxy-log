# Auth sessions (admin + portal)

Admin dashboard and client portal share the same session model.

## Behavior

- Sessions are stored in PostgreSQL (`auth_sessions`), so they **survive PM2 / process restarts**.
- Hard max lifetime: **3 days** from login (`created_at`). Cookie `maxAge` is refreshed to the remaining TTL on each valid request (does not extend past 3 days).
- Cookie holds only an opaque id; the DB stores a **SHA-256 hash** of that id.
- Cookie flags: `httpOnly`, `SameSite=Lax`. **Secure** follows the client-facing protocol (`X-Forwarded-Proto` / HTTPS). The admin Vite dashboard on plain HTTP (`:5173`) must not receive `Secure` cookies or the browser drops the session (login loop). Portal on HTTPS still gets Secure cookies. Set `COOKIE_SECURE=0` to force never-Secure; `COOKIE_SECURE=1` only forces Secure when the request protocol is unknown.
- Changing or removing a password **invalidates all sessions** for that principal (admin: all admin sessions; portal: all sessions for that Discord user).
- Logout clears the DB row and the cookie (admin logout is allowed even if the session is already gone).
- Login rate limit (admin and portal): 10 attempts / 15 minutes / IP.
- Hourly purge removes expired / revoked rows.

## Client metadata

On create (and optional enrich), each session stores request-derived metadata:

| Field | Source |
|-------|--------|
| `ip` | `CF-Connecting-IP` / `X-Forwarded-For` / socket |
| `country` | Cloudflare `CF-IPCountry` only (no MaxMind) |
| `user_agent` | `User-Agent` |
| `device_class` / `os_name` / `client_name` | Parsed from UA |
| `fingerprint` | Stable hash of UA + IP class |
| `client_label` | Optional body `clientHint` from `navigator.userAgentData` at login |

Honest limits: HTTP alone cannot reveal PC hostname, IMEI, or GPS.

## APIs

**Admin** (cookie session required):

- `GET /admin/sessions?kind=admin|portal` — list with `isCurrent`
- `DELETE /admin/sessions/:id?kind=…` — revoke one
- `POST /admin/sessions/revoke-others` — revoke other **admin** sessions (keeps current)
- `GET /admin/audit-logs` — see below

**Portal** (portal cookie):

- `GET /portal/api/sessions`
- `DELETE /portal/api/sessions/:id`
- `POST /portal/api/sessions/revoke-others`

UI: Dashboard Settings (admin + portal session panels) and Portal Settings → Active sessions.

## Login flows (unchanged UX)

- **Admin**: password via `POST /admin/login` (optional `clientHint`).
- **Portal**: API key via `POST /portal/api/auth/login`; if a portal password is set, `POST /portal/api/auth/verify-password` after the API key step.

## Admin audit log (append-only)

Table `admin_audit_logs` is created on boot. Middleware on `/admin/*` records successful mutating requests (and login failures/successes) with redacted bodies (passwords / API keys / tokens stripped).

- **No delete API** — entries cannot be removed from the UI.
- List: `GET /admin/audit-logs?limit=&offset=&action=`
- Dashboard Settings → Admin audit log panel.

## Security notes

- Proxy client auth is **Bearer header only** (not query string). Missing and invalid keys return the same `Invalid API key.` message.
- Portal log SSE emits only slim fields (id/model/status/createdAt) scoped to the user’s keys. Admin logs/SSE redact `sk-…` / `Bearer …` in previews and error text; Authorization headers are never stored on request logs.
- CORS does not expose `Set-Cookie` to JS. Sensitive probe paths (`.env`, `.git`, …) return JSON 404 instead of SPA HTML.

## Table

Created automatically on boot via `ensureAuthSessionsTable()` / `ensureAdminAuditLogsTable()` in database init.
