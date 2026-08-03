import { useCallback, useEffect, useState } from "react";
import { auth, sessionsApi, type AuthSessionRow } from "@/lib/api";
import { formatLogTimeLine } from "@/lib/log-time";
import { Button } from "@/components/ui/button";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { useNotify } from "@/components/Notify";
import { Monitor, Smartphone, Tablet, Bot, Shield, Trash2, RefreshCw } from "lucide-react";

function DeviceIcon({ cls }: { cls?: string | null }) {
  if (cls === "mobile") return <Smartphone className="h-4 w-4" />;
  if (cls === "tablet") return <Tablet className="h-4 w-4" />;
  if (cls === "bot") return <Bot className="h-4 w-4" />;
  return <Monitor className="h-4 w-4" />;
}

export function ActiveSessionsPanel({
  kind,
  title,
  description,
}: {
  kind: "admin" | "portal";
  title: string;
  description: string;
}) {
  const notify = useNotify();
  const [rows, setRows] = useState<AuthSessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sessionsApi.list(kind);
      setRows(res.sessions || []);
    } catch (e: any) {
      notify.error(e?.message || "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [kind, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(s: AuthSessionRow) {
    try {
      await sessionsApi.revoke(s.id, kind);
      if (s.isCurrent && kind === "admin") {
        notify.success("Session revoked — signing out");
        try {
          await auth.logout();
        } catch {
          /* cookie may already be invalid */
        }
        window.location.href = "/login";
        return;
      }
      notify.success("Session revoked");
      await load();
    } catch (e: any) {
      notify.error(e?.message || "Revoke failed");
    }
  }

  async function revokeOthers() {
    if (kind !== "admin") return;
    try {
      const res = await sessionsApi.revokeOthers();
      notify.success(`Revoked ${res.revoked} other session(s)`);
      await load();
    } catch (e: any) {
      notify.error(e?.message || "Revoke failed");
    }
  }

  return (
    <CollapsibleCard
      id={`admin-log-sessions-${kind}`}
      title={title}
      description={description}
      icon={<Shield className="h-4 w-4" />}
      defaultOpen={kind === "admin"}
      headerActions={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {kind === "admin" && (
            <Button type="button" variant="outline" size="sm" onClick={() => void revokeOthers()}>
              Sign out other admin sessions
            </Button>
          )}
        </>
      }
      contentClassName="space-y-2"
    >
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {kind === "portal"
            ? "No active portal sessions right now. They appear when a client logs into the portal. After a wipe or 3-day expiry they disappear until someone signs in again."
            : "No active admin sessions."}
        </p>
      )}
      {rows.map((s) => (
        <div
          key={s.id}
          className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium flex-wrap">
              <DeviceIcon cls={s.deviceClass} />
              {kind === "portal" && (s.discordUsername || s.discordUserId) && (
                <span className="text-foreground">
                  {s.discordUsername ? `@${s.discordUsername}` : s.discordUserId}
                </span>
              )}
              <span className="text-muted-foreground font-normal">
                {[s.osName, s.clientName, s.deviceClass].filter(Boolean).join(" · ") ||
                  "Unknown device"}
              </span>
              {s.isCurrent && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  Current
                </span>
              )}
            </div>
            <p className="text-[11px] text-foreground/90 font-mono">
              IP {s.ip && s.ip !== "unknown" ? s.ip : "—"}
              {s.country ? ` · ${s.country}` : ""}
              {kind === "portal" && s.discordUserId ? ` · id ${s.discordUserId}` : ""}
            </p>
            {s.clientLabel && (
              <p className="text-[11px] text-muted-foreground truncate">Hint: {s.clientLabel}</p>
            )}
            {s.userAgent && (
              <p
                className="text-[10px] text-muted-foreground/90 font-mono truncate"
                title={s.userAgent}
              >
                UA {s.userAgent}
              </p>
            )}
            {s.fingerprint && (
              <p className="text-[10px] text-muted-foreground font-mono">
                FP {s.fingerprint.slice(0, 16)}…
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">
              First login {formatLogTimeLine(s.createdAt)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Last active {formatLogTimeLine(s.lastSeenAt)} · Expires{" "}
              {formatLogTimeLine(s.expiresAt)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-destructive shrink-0"
            onClick={() => void revoke(s)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Revoke
          </Button>
        </div>
      ))}
    </CollapsibleCard>
  );
}
