import { useCallback, useEffect, useState } from "react";
import { sessionsApi, type AuthSessionRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotify } from "@/components/Notify";
import { Monitor, Smartphone, Tablet, Bot, Shield, Trash2 } from "lucide-react";

function DeviceIcon({ cls }: { cls?: string | null }) {
  if (cls === "mobile") return <Smartphone className="h-4 w-4" />;
  if (cls === "tablet") return <Tablet className="h-4 w-4" />;
  if (cls === "bot") return <Bot className="h-4 w-4" />;
  return <Monitor className="h-4 w-4" />;
}

function fmt(d?: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
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

  async function revoke(id: number) {
    try {
      await sessionsApi.revoke(id, kind);
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
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" />
              {title}
            </CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
          {kind === "admin" && (
            <Button type="button" variant="outline" size="sm" onClick={() => void revokeOthers()}>
              Sign out other admin sessions
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">No active sessions.</p>
        )}
        {rows.map((s) => (
          <div
            key={s.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <DeviceIcon cls={s.deviceClass} />
                <span>
                  {[s.osName, s.clientName, s.clientLabel].filter(Boolean).join(" · ") || "Unknown device"}
                </span>
                {s.isCurrent && (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                    Current
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground font-mono truncate">
                {s.ip || "?"}
                {s.country ? ` · ${s.country}` : ""}
                {kind === "portal" && s.discordUsername ? ` · @${s.discordUsername}` : ""}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Last seen {fmt(s.lastSeenAt)} · Expires {fmt(s.expiresAt)}
              </p>
            </div>
            {!s.isCurrent && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-destructive"
                onClick={() => void revoke(s.id)}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Revoke
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
