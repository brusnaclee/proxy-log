import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, XCircle, Minus, AlertTriangle } from "lucide-react";
import { PeriodSelector, type PeriodKey } from "@/components/PeriodSelector";
import { api, type TopError } from "@/lib/api";
import {
  formatDateWIB, statusLabel, statusDetail, statusColor,
  statusBgColor, formatNumber,
} from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

function StatusIcon({ code }: { code: number }) {
  if (code >= 200 && code < 300) return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />;
  if (code >= 400 && code < 500) {
    if (code === 429) return <Minus className="w-3.5 h-3.5 text-orange-400" />;
    return <AlertCircle className="w-3.5 h-3.5 text-yellow-400" />;
  }
  if (code >= 500) return <XCircle className="w-3.5 h-3.5 text-red-400" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}

export default function ActivityPage() {
  const { t } = useI18n();
  const [period, setPeriod] = useState<PeriodKey>("7d");
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [topErrors, setTopErrors] = useState<TopError[]>([]);
  const limit = 25;

  const loadLogs = () => {
    setLoading(true);
    setError("");
    Promise.all([
      api.logs.list(period, limit, page),
      api.stats.topErrors(period).catch(() => [] as TopError[]),
    ])
      .then(([result, errors]) => {
        setLogs(result.data);
        setTotalPages(result.pagination.totalPages);
        setTotalItems(result.pagination.total);
        setTopErrors(errors as TopError[]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load logs"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, page]);

  const rowKey = (log: any) => `${log.createdAt}:${log.model}:${log.id ?? ""}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t("Activity")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Recent API requests")}
            {totalItems > 0 && <span className="ml-1">({formatNumber(totalItems)} total)</span>}
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Top errors */}
      {topErrors.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            <h3 className="text-sm font-medium text-foreground">{t("Top Errors")}</h3>
          </div>
          <div className="space-y-2">
            {topErrors.slice(0, 5).map((err, i) => (
              <div key={i} className="flex items-start gap-3 text-xs">
                <span className={`px-1.5 py-0.5 rounded font-mono font-medium flex-shrink-0 ${
                  err.statusCode >= 500 ? "bg-red-400/10 text-red-400" : "bg-yellow-400/10 text-yellow-400"
                }`}>
                  {err.statusCode}
                </span>
                <span className="text-muted-foreground truncate flex-1">{err.errorSnippet || "—"}</span>
                <span className="text-foreground font-medium flex-shrink-0">×{err.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-400/10 border border-red-400/20 rounded-lg text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="p-4 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="h-4 w-24 bg-muted rounded" />
                  <div className="h-4 w-32 bg-muted rounded hide-mobile" />
                  <div className="h-4 w-20 bg-muted rounded hide-mobile" />
                  <div className="h-4 w-16 bg-muted rounded" />
                  <div className="h-4 w-20 bg-muted rounded hide-mobile" />
                  <div className="h-4 w-12 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            No activity found for this period
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-accent/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Time (WIB)</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hide-mobile">Model</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hide-mobile">IDE</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Latency</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hide-mobile">Tokens</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {logs.map((log) => {
                  const key = rowKey(log);
                  const isExpanded = expandedRow === key;
                  const hasDetail = [401, 403, 429, 500, 502, 503].includes(log.statusCode) || !!log.errorMessage;
                  return (
                    <>
                      <tr
                        key={key}
                        className="data-row"
                        onClick={() => setExpandedRow(isExpanded ? null : key)}
                      >
                        <td className="px-4 py-3 text-sm text-foreground whitespace-nowrap">
                          {formatDateWIB(log.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground hide-mobile max-w-[150px] truncate">
                          {log.model}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground hide-mobile">
                          {log.ideDetected}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground whitespace-nowrap">
                          {log.latencyMs}ms
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground hide-mobile">
                          {formatNumber(log.totalTokens)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${statusBgColor(log.statusCode)}`}>
                            <StatusIcon code={log.statusCode} />
                            {statusLabel(log.statusCode)}
                          </span>
                        </td>
                      </tr>
                      {isExpanded && hasDetail && (
                        <tr key={`${key}-detail`}>
                          <td colSpan={6} className="px-4 py-3 bg-accent/30 border-b border-border">
                            <div className="text-sm space-y-1">
                              <div>
                                <span className={`font-medium ${statusColor(log.statusCode)}`}>
                                  {log.statusCode} {statusLabel(log.statusCode)}
                                </span>
                                {statusDetail(log.statusCode) && (
                                  <span className="text-muted-foreground ml-2">
                                    — {statusDetail(log.statusCode)}
                                  </span>
                                )}
                              </div>
                              {log.errorMessage && (
                                <div className="text-xs text-red-400/90 bg-red-400/5 border border-red-400/10 rounded px-2 py-1 font-mono break-all">
                                  {log.errorMessage}
                                </div>
                              )}
                              {log.endpointPath && (
                                <div className="text-xs text-muted-foreground">
                                  Endpoint: <span className="font-mono">{log.endpointPath}</span>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-foreground px-3">{page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
