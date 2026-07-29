import { useCallback, useEffect, useState } from "react";
import { Monitor, Smartphone, Tablet, Bot, Shield, Trash2, RefreshCw, LogOut } from "lucide-react";
import { api, type PortalSessionRow } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useNotify } from "@/components/Notify";

function DeviceIcon({ cls }: { cls?: string | null }) {
  if (cls === "mobile") return <Smartphone className="w-4 h-4" />;
  if (cls === "tablet") return <Tablet className="w-4 h-4" />;
  if (cls === "bot") return <Bot className="w-4 h-4" />;
  return <Monitor className="w-4 h-4" />;
}

function fmt(d?: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

export function ActiveSessionsPanel() {
  const { t } = useI18n();
  const notify = useNotify();
  const [rows, setRows] = useState<PortalSessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.sessions.list();
      setRows(res.sessions || []);
    } catch (e: any) {
      notify.error(e?.message || t("Failed to load sessions"));
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(s: PortalSessionRow) {
    try {
      await api.sessions.revoke(s.id);
      if (s.isCurrent) {
        notify.success(t("Session revoked"));
        try {
          await api.auth.logout();
        } catch {
          /* cookie may already be invalid */
        }
        window.location.href = "/login";
        return;
      }
      notify.success(t("Session revoked"));
      await load();
    } catch (e: any) {
      notify.error(e?.message || t("Revoke failed"));
    }
  }

  async function revokeOthers() {
    try {
      const res = await api.sessions.revokeOthers();
      notify.success(`${t("Revoked")} ${res.revoked} ${t("other session(s)")}`);
      await load();
    } catch (e: any) {
      notify.error(e?.message || t("Revoke failed"));
    }
  }

  async function revokeAll() {
    if (!window.confirm(t("Sign out all devices? You will need to log in again."))) return;
    try {
      await api.sessions.revokeAll();
      notify.success(t("All sessions revoked"));
      try {
        await api.auth.logout();
      } catch {
        /* already cleared */
      }
      window.location.href = "/login";
    } catch (e: any) {
      notify.error(e?.message || t("Revoke failed"));
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 border-emerald-500/20">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            {t("Active sessions")}
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            {t(
              "Devices signed into your portal. Sessions expire after 3 days. Changing password or revoking all signs every device out.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void load()}
            className="p-1.5 rounded-md border border-border text-muted-foreground hover:bg-accent transition-colors"
            aria-label="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void revokeOthers()}
            className="px-3 py-1.5 text-xs rounded-md border border-border text-foreground hover:bg-accent transition-colors"
          >
            {t("Sign out other devices")}
          </button>
          <button
            type="button"
            onClick={() => void revokeAll()}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-red-400/30 text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            {t("Sign out everywhere")}
          </button>
        </div>
      </div>

      {loading && <p className="text-xs text-muted-foreground">{t("Loading…")}</p>}
      {!loading && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t("No active sessions. Log in again to create one.")}
        </p>
      )}

      <div className="space-y-2">
        {rows.map((s) => (
          <div
            key={s.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground flex-wrap">
                <DeviceIcon cls={s.deviceClass} />
                <span>
                  {[s.osName, s.clientName, s.clientLabel].filter(Boolean).join(" · ") ||
                    t("Unknown device")}
                </span>
                {s.isCurrent && (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                    {t("Current")}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground font-mono truncate">
                {s.ip || "?"}
                {s.country ? ` · ${s.country}` : ""}
                {s.userAgent ? ` · ${s.userAgent.slice(0, 80)}` : ""}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {t("First login")} {fmt(s.createdAt)} · {t("Last active")} {fmt(s.lastSeenAt)} ·{" "}
                {t("Expires")} {fmt(s.expiresAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void revoke(s)}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-red-400 hover:bg-red-400/10 rounded-md transition-colors shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t("Revoke")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
