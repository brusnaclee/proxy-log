# Auth sessions (admin + portal)

Admin dashboard and client portal share the same session model.

## Behavior

- Sessions are stored in PostgreSQL (`auth_sessions`), so they **survive PM2 / process restarts**.
- Hard max lifetime: **3 days** from login (`created_at`). Cookie `maxAge` is refreshed to the remaining TTL on each valid request (does not extend past 3 days).
- Cookie holds only an opaque id; the DB stores a **SHA-256 hash** of that id.
- Cookie flags: `httpOnly`, `SameSite=Lax`. Set `COOKIE_SECURE=1` only when the site is served over HTTPS (do not infer from `NODE_ENV=production` — plain HTTP dashboards would drop the cookie and look like a failed login).
- Changing or removing a password **invalidates all sessions** for that principal (admin: all admin sessions; portal: all sessions for that Discord user).
- Logout clears the DB row and the cookie (admin logout is allowed even if the session is already gone).
- Login rate limit (admin and portal): 10 attempts / 15 minutes / IP.

## Login flows (unchanged UX)

- **Admin**: existing password via `POST /admin/login`.
- **Portal**: API key via `POST /portal/api/auth/login`; if a portal password is set, `POST /portal/api/auth/verify-password` after the API key step.

## Table

Created automatically on boot via `ensureAuthSessionsTable()` in database init.
