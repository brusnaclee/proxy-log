import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, XCircle, Minus } from "lucide-react";
import { PeriodSelector, type PeriodKey } from "@/components/PeriodSelector";
import { api } from "@/lib/api";
import {
  formatDateWIB,
  statusLabel,
  statusDetail,
  statusColor,
  statusBgColor,
  formatNumber,
} from "@/lib/utils";

interface LogItem {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  ideDetected: string;
  provider: string;
  latencyMs: number;
  statusCode: number;
  createdAt: string;
}

function StatusIcon({ code }: { code: number }) {
  if (code >= 200 && code < 300) {
    return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />;
  }
  if (code >= 400 && code < 500) {
    if (code === 429) return <Minus className="w-3.5 h-3.5 text-orange-400" />;
    return <AlertCircle className="w-3.5 h-3.5 text-yellow-400" />;
  }
  if (code >= 500) {
    return <XCircle className="w-3.5 h-3.5 text-red-400" />;
  }
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}

export default function ActivityPage() {
  const [period, setPeriod] = useState<PeriodKey>("7d");
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const limit = 25;

  const loadLogs = () => {
    setLoading(true);
    setError("");
    api.logs
      .list(period, limit, page)
      .then((result) => {
        setLogs(result.data);
        setTotalPages(result.pagination.totalPages);
        setTotalItems(result.pagination.total);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load logs"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadLogs();
  }, [period, page]);

  const showErrorDetail = (code: number) => {
    return [401, 403, 429, 500, 502, 503].includes(code);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Activity</h1>
          <p className="text-sm text-muted-foreground">
            Recent API requests
            {totalItems > 0 && (
              <span className="ml-1">({formatNumber(totalItems)} total)</span>
            )}
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

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
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    Time (WIB)
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hide-mobile">
                    Model
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hide-mobile">
                    IDE
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    Latency
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hide-mobile">
                    Tokens
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {logs.map((log) => (
                  <>
                    <tr
                      key={log.createdAt + log.model}
                      className="data-row"
                      onClick={() =>
                        setExpandedRow(expandedRow === log.createdAt + log.model ? null : log.createdAt + log.model)
                      }
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
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${statusBgColor(
                            log.statusCode
                          )}`}
                        >
                          <StatusIcon code={log.statusCode} />
                          {statusLabel(log.statusCode)}
                        </span>
                      </td>
                    </tr>
                    {expandedRow === log.createdAt + log.model && showErrorDetail(log.statusCode) && (
                      <tr key={`${log.createdAt + log.model}-detail`}>
                        <td
                          colSpan={6}
                          className="px-4 py-3 bg-accent/30 border-b border-border"
                        >
                          <div className="text-sm">
                            <span className={`font-medium ${statusColor(log.statusCode)}`}>
                              {log.statusCode} {statusLabel(log.statusCode)}
                            </span>
                            {statusDetail(log.statusCode) && (
                              <span className="text-muted-foreground ml-2">
                                — {statusDetail(log.statusCode)}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-foreground px-3">
              {page} / {totalPages}
            </span>
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
