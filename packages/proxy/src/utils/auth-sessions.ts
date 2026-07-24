import { and, eq, lt } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { db, pool } from "../db/index.js";
import { authSessions } from "../db/schema.js";

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

export async function createAuthSession(opts: {
  kind: AuthSessionKind;
  discordUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<string> {
  const rawId = generateRawSessionId();
  const sessionHash = hashSessionId(rawId);
  const now = new Date();
  await db.insert(authSessions).values({
    sessionHash,
    kind: opts.kind,
    discordUserId: opts.discordUserId ?? null,
    createdAt: now,
    lastSeenAt: now,
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
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
export async function touchAuthSession(id: number, lastSeenAt: Date): Promise<void> {
  if (Date.now() - lastSeenAt.getTime() < TOUCH_THROTTLE_MS) return;
  try {
    await db
      .update(authSessions)
      .set({ lastSeenAt: new Date() })
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
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_hash ON auth_sessions (session_hash)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_kind_user ON auth_sessions (kind, discord_user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_created ON auth_sessions (created_at)`);
}
