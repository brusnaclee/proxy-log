import { useCallback, useEffect, useState } from "react";
import { auditLogsApi, type AdminAuditRow } from "@/lib/api";
import { formatLogTimeLine } from "@/lib/log-time";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotify } from "@/components/Notify";
import { ScrollText } from "lucide-react";

export function AdminAuditLogPanel() {
  const notify = useNotify();
  const [logs, setLogs] = useState<AdminAuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 40;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await auditLogsApi.list({
        limit,
        offset,
        action: actionFilter.trim() || undefined,
      });
      setLogs(res.logs || []);
      setTotal(res.total || 0);
    } catch (e: any) {
      notify.error(e?.message || "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, offset, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <CollapsibleCard
      id="admin-log-audit"
      title="Admin audit log"
      description="Append-only record of admin logins and mutating actions (providers, keys, models, settings, …). Entries cannot be deleted from the UI. Passwords and API keys are redacted."
      icon={<ScrollText className="h-4 w-4" />}
      defaultOpen={false}
      contentClassName="space-y-3"
    >
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex gap-1.5 flex-wrap">
            {[
              { label: "All", value: "" },
              { label: "Logins", value: "auth.login" },
              { label: "Password changes", value: "settings.password.change" },
              { label: "Session revoke", value: "session.revoke" },
            ].map((chip) => (
              <Button
                key={chip.label}
                type="button"
                size="sm"
                variant={actionFilter === chip.value ? "default" : "outline"}
                className="h-7 text-[11px]"
                onClick={() => {
                  setOffset(0);
                  setActionFilter(chip.value);
                }}
              >
                {chip.label}
              </Button>
            ))}
          </div>
          <div className="flex-1 min-w-[140px]">
            <Input
              value={actionFilter}
              onChange={(e) => {
                setOffset(0);
                setActionFilter(e.target.value);
              }}
              placeholder="Filter action e.g. model.activate"
              className="h-8 text-xs"
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
        {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!loading && logs.length === 0 && (
          <p className="text-xs text-muted-foreground">No audit entries yet.</p>
        )}
        <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
          {logs.map((row) => (
            <div
              key={row.id}
              className="rounded-lg border border-border/60 px-3 py-2 text-xs space-y-1"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-mono font-medium text-foreground">{row.action}</span>
                {row.statusCode != null && (
                  <span className="text-muted-foreground">HTTP {row.statusCode}</span>
                )}
              </div>
              <p className="text-foreground/90">{formatLogTimeLine(row.createdAt)}</p>
              <p className="text-muted-foreground font-mono truncate">
                {row.actor}
                {row.ip ? ` · ${row.ip}` : ""}
                {row.country ? ` · ${row.country}` : ""}
                {row.method && row.path ? ` · ${row.method} ${row.path}` : ""}
              </p>
              {row.details != null && (
                <pre className="text-[10px] text-muted-foreground/90 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                  {typeof row.details === "string"
                    ? row.details
                    : JSON.stringify(row.details, null, 0)}
                </pre>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            Showing {logs.length} / {total}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={offset <= 0}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
            >
              Prev
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={offset + limit >= total}
              onClick={() => setOffset((o) => o + limit)}
            >
              Next
            </Button>
          </div>
        </div>
    </CollapsibleCard>
  );
}
