import { useCallback, useEffect, useMemo, useState } from "react";
import { auditLogsApi, type AdminAuditRow } from "@/lib/api";
import { formatLogTimeLine } from "@/lib/log-time";
import { Button } from "@/components/ui/button";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { useNotify } from "@/components/Notify";
import { AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";

function loginOutcome(row: AdminAuditRow): "ok" | "fail" | "rate_limited" | "other" {
  const d = row.details as { ok?: boolean; reason?: string } | null;
  if (row.statusCode === 429 || d?.reason === "rate_limited") return "rate_limited";
  if (row.statusCode === 200 && d?.ok === true) return "ok";
  if (row.statusCode != null && row.statusCode >= 400) return "fail";
  if (d?.ok === false) return "fail";
  return "other";
}

export function AdminLoginActivityPanel() {
  const notify = useNotify();
  const [logs, setLogs] = useState<AdminAuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await auditLogsApi.list({ limit: 50, offset: 0, action: "auth.login" });
      setLogs(res.logs || []);
    } catch (e: any) {
      notify.error(e?.message || "Failed to load login activity");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const failCount = useMemo(
    () => logs.filter((r) => {
      const o = loginOutcome(r);
      return o === "fail" || o === "rate_limited";
    }).length,
    [logs],
  );

  return (
    <CollapsibleCard
      id="admin-log-login-activity"
      title="Admin login activity"
      description="Every dashboard login attempt (success, wrong password, rate-limit). Rate limit: 10 tries / 15 min / IP. Password change revokes all admin sessions."
      icon={<ShieldAlert className="h-4 w-4" />}
      defaultOpen={false}
      headerActions={
        <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      }
      contentClassName="space-y-2"
    >
      {failCount > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {failCount} failed / rate-limited attempt(s) in the last {logs.length} login events. Check IP &amp; time
            below.
          </span>
        </div>
      )}
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {!loading && logs.length === 0 && (
        <p className="text-xs text-muted-foreground">No login attempts recorded yet.</p>
      )}
      {logs.map((row) => {
        const outcome = loginOutcome(row);
        const d = row.details as { reason?: string } | null;
        const badge =
          outcome === "ok"
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : outcome === "rate_limited"
              ? "bg-orange-500/15 text-orange-700 dark:text-orange-300"
              : "bg-red-500/15 text-red-700 dark:text-red-300";
        const label =
          outcome === "ok"
            ? "OK"
            : outcome === "rate_limited"
              ? "RATE LIMITED"
              : d?.reason === "invalid_password"
                ? "BAD PASSWORD"
                : "FAILED";
        return (
          <div
            key={row.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${badge}`}>
                  {label}
                </span>
                {row.statusCode != null && (
                  <span className="text-[10px] text-muted-foreground">HTTP {row.statusCode}</span>
                )}
              </div>
              <p className="text-xs text-foreground/90">{formatLogTimeLine(row.createdAt)}</p>
              <p className="text-[11px] text-muted-foreground font-mono truncate">
                {row.ip || "?"}
                {row.country ? ` · ${row.country}` : ""}
                {row.userAgent ? ` · ${row.userAgent.slice(0, 80)}` : ""}
              </p>
            </div>
          </div>
        );
      })}
    </CollapsibleCard>
  );
}
