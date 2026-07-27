import { and, eq, lt, desc, ne, inArray } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { db, pool } from "../db/index.js";
import { authSessions, apiKeys } from "../db/schema.js";
import type { SessionClientMeta } from "./session-client-meta.js";

export type AuthSessionKind = "admin" | "portal";

/** Hard max lifetime from login (created_at). */
export const AUTH_SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const TOUCH_THROTTLE_MS = 5 * 60 * 1000;

export function hashSessionId(rawId: string): string {
  return createHash("sha256").update(rawId).digest("hex");
}

export function generateRawSessionId(): string {
  return randomBytes(32).toString("hex");
}

export function remainingTtlSeconds(createdAt: Date): number {
  const remainingMs = createdAt.getTime() + AUTH_SESSION_TTL_MS - Date.now();
  return Math.max(0, Math.floor(remainingMs / 1000));
}

export function isSessionExpired(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > AUTH_SESSION_TTL_MS;
}

export function sessionExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + AUTH_SESSION_TTL_MS);
}

export async function createAuthSession(opts: {
  kind: AuthSessionKind;
  discordUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Partial<SessionClientMeta> | null;
}): Promise<string> {
  const rawId = generateRawSessionId();
  const sessionHash = hashSessionId(rawId);
  const now = new Date();
  const m = opts.meta;
  await db.insert(authSessions).values({
    sessionHash,
    kind: opts.kind,
    discordUserId: opts.discordUserId ?? null,
    createdAt: now,
    lastSeenAt: now,
    ip: m?.ip ?? opts.ip ?? null,
    userAgent: m?.userAgent ?? opts.userAgent ?? null,
    country: m?.country ?? null,
    deviceClass: m?.deviceClass ?? null,
    osName: m?.osName ?? null,
    clientName: m?.clientName ?? null,
    fingerprint: m?.fingerprint ?? null,
    clientLabel: m?.clientLabel ?? null,
  });
  return rawId;
}

export async function getAuthSession(rawId: string, kind: AuthSessionKind) {
  if (!rawId) return null;
  const sessionHash = hashSessionId(rawId);
  const row = (
    await db
      .select()
      .from(authSessions)
      .where(and(eq(authSessions.sessionHash, sessionHash), eq(authSessions.kind, kind)))
      .limit(1)
  )[0];
  if (!row) return null;
  if (isSessionExpired(row.createdAt)) {
    await db.delete(authSessions).where(eq(authSessions.id, row.id));
    return null;
  }
  return row;
}

/** Update last_seen_at at most every TOUCH_THROTTLE_MS. */
export async function touchAuthSession(
  id: number,
  lastSeenAt: Date,
  opts?: { ip?: string | null },
): Promise<void> {
  if (Date.now() - lastSeenAt.getTime() < TOUCH_THROTTLE_MS) return;
  try {
    await db
      .update(authSessions)
      .set({
        lastSeenAt: new Date(),
        ...(opts?.ip ? { ip: opts.ip } : {}),
      })
      .where(eq(authSessions.id, id));
  } catch {
    // best-effort
  }
}

export async function destroyAuthSession(rawId: string, kind?: AuthSessionKind): Promise<void> {
  if (!rawId) return;
  const sessionHash = hashSessionId(rawId);
  if (kind) {
    await db
      .delete(authSessions)
      .where(and(eq(authSessions.sessionHash, sessionHash), eq(authSessions.kind, kind)));
  } else {
    await db.delete(authSessions).where(eq(authSessions.sessionHash, sessionHash));
  }
}

export async function destroyAuthSessionById(
  id: number,
  kind: AuthSessionKind,
  discordUserId?: string | null,
): Promise<boolean> {
  const conds = [eq(authSessions.id, id), eq(authSessions.kind, kind)];
  if (kind === "portal" && discordUserId) {
    conds.push(eq(authSessions.discordUserId, discordUserId));
  }
  const deleted = await db
    .delete(authSessions)
    .where(and(...conds))
    .returning({ id: authSessions.id });
  return deleted.length > 0;
}

export async function destroyOtherAuthSessions(
  kind: AuthSessionKind,
  keepRawId: string,
  discordUserId?: string | null,
): Promise<number> {
  const keepHash = hashSessionId(keepRawId);
  const conds = [eq(authSessions.kind, kind), ne(authSessions.sessionHash, keepHash)];
  if (kind === "portal") {
    if (!discordUserId) return 0;
    conds.push(eq(authSessions.discordUserId, discordUserId));
  }
  const deleted = await db
    .delete(authSessions)
    .where(and(...conds))
    .returning({ id: authSessions.id });
  return deleted.length;
}

/** Kill all sessions for a principal (password change / remove). */
export async function destroyAllAuthSessions(
  kind: AuthSessionKind,
  discordUserId?: string | null,
): Promise<void> {
  if (kind === "admin") {
    await db.delete(authSessions).where(eq(authSessions.kind, "admin"));
    return;
  }
  if (!discordUserId) return;
  await db
    .delete(authSessions)
    .where(
      and(eq(authSessions.kind, "portal"), eq(authSessions.discordUserId, discordUserId)),
    );
}

export function serializeAuthSession(
  row: typeof authSessions.$inferSelect,
  opts?: { isCurrent?: boolean; discordUsername?: string | null },
) {
  return {
    id: row.id,
    kind: row.kind,
    discordUserId: row.discordUserId,
    discordUsername: opts?.discordUsername ?? null,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: sessionExpiresAt(row.createdAt),
    ip: row.ip,
    userAgent: row.userAgent,
    country: row.country,
    deviceClass: row.deviceClass,
    osName: row.osName,
    clientName: row.clientName,
    fingerprint: row.fingerprint,
    clientLabel: row.clientLabel,
    isCurrent: Boolean(opts?.isCurrent),
  };
}

export async function listAuthSessions(opts: {
  kind: AuthSessionKind;
  discordUserId?: string | null;
  currentRawId?: string | null;
  limit?: number;
}) {
  const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
  const conds = [eq(authSessions.kind, opts.kind)];
  if (opts.kind === "portal" && opts.discordUserId) {
    conds.push(eq(authSessions.discordUserId, opts.discordUserId));
  }
  const rows = await db
    .select()
    .from(authSessions)
    .where(and(...conds))
    .orderBy(desc(authSessions.lastSeenAt))
    .limit(limit);

  const currentHash = opts.currentRawId ? hashSessionId(opts.currentRawId) : null;
  const alive = rows.filter((r) => !isSessionExpired(r.createdAt));
  // Drop expired as we see them
  for (const r of rows) {
    if (isSessionExpired(r.createdAt)) {
      void db.delete(authSessions).where(eq(authSessions.id, r.id));
    }
  }

  const usernames = new Map<string, string>();
  if (opts.kind === "portal") {
    const ids = [
      ...new Set(alive.map((r) => r.discordUserId).filter(Boolean) as string[]),
    ];
    if (ids.length) {
      const all = await db
        .select({
          discordUserId: apiKeys.discordUserId,
          discordUsername: apiKeys.discordUsername,
        })
        .from(apiKeys)
        .where(inArray(apiKeys.discordUserId, ids));
      for (const k of all) {
        if (k.discordUserId && k.discordUsername && !usernames.has(k.discordUserId)) {
          usernames.set(k.discordUserId, k.discordUsername);
        }
      }
    }
  }

  return alive.map((r) =>
    serializeAuthSession(r, {
      isCurrent: currentHash ? r.sessionHash === currentHash : false,
      discordUsername: r.discordUserId ? usernames.get(r.discordUserId) ?? null : null,
    }),
  );
}

export async function purgeExpiredAuthSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - AUTH_SESSION_TTL_MS);
  const result = await db
    .delete(authSessions)
    .where(lt(authSessions.createdAt, cutoff))
    .returning({ id: authSessions.id });
  return result.length;
}

let purgeStarted = false;

/** Start hourly cleanup (once per process). */
export function startAuthSessionPurgeJob(): void {
  if (purgeStarted) return;
  purgeStarted = true;
  const run = () => {
    void purgeExpiredAuthSessions().catch(() => undefined);
  };
  run();
  setInterval(run, 60 * 60 * 1000);
}

export async function ensureAuthSessionsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id SERIAL PRIMARY KEY,
      session_hash TEXT NOT NULL,
      kind TEXT NOT NULL,
      discord_user_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
      ip TEXT,
      user_agent TEXT
    )
  `);
  await pool.query(`
    ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS country TEXT;
    ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS device_class TEXT;
    ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS os_name TEXT;
    ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS client_name TEXT;
    ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS fingerprint TEXT;
    ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS client_label TEXT;
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_hash ON auth_sessions (session_hash)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_kind_user ON auth_sessions (kind, discord_user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_created ON auth_sessions (created_at)`);
}
