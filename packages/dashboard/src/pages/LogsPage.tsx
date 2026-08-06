import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  logs,
  type ChatSessionSummary,
  type LogEntry,
  type SessionDetailResponse,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatNumber, formatLogUserDisplay, formatInputBreakdown } from "@/lib/utils";
import { Download, Radio, ChevronLeft, ChevronRight } from "lucide-react";
import { formatCost } from "@/lib/utils";
import { useRealtimeSSE } from "@/lib/use-realtime-sse";
import { useRealtime } from "@/lib/realtime-context";
import { exportXlsx, buildLogsSection } from "@/lib/export-xlsx";

type ViewMode = "requests" | "sessions";

function normalizeTools(tools: string[] | null | undefined): string[] {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => String(tool).trim()).filter(Boolean);
}

function shortenSessionId(sessionId: string | null | undefined): string {
  if (!sessionId) return "-";
  if (sessionId.length <= 16) return sessionId;
  return `${sessionId.slice(0, 16)}...`;
}

function getContextEventVariant(event: string | null | undefined): "default" | "secondary" | "destructive" | "warning" {
  if (event === "compact") return "warning";
  if (event === "switch") return "destructive";
  if (event === "new_session") return "default";
  return "secondary";
}


export default function LogsPage() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("requests");
  const { realtimeEnabled } = useRealtime();

  // Request logs state
  const [requestData, setRequestData] = useState<LogEntry[]>([]);
  const [requestPage, setRequestPage] = useState(1);
  const [requestTotalPages, setRequestTotalPages] = useState(1);
  const [requestTotal, setRequestTotal] = useState(0);
  const [liveMode, setLiveMode] = useState(true);
  const [requestFilters, setRequestFilters] = useState({
    api_key_id: "",
    model: "",
    ide: "",
    provider: "",
    session_id: "",
    context_event: "",
    ip: "",
    status: "",
  });

  // Session state
  const [sessionData, setSessionData] = useState<ChatSessionSummary[]>([]);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionTotalPages, setSessionTotalPages] = useState(1);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionFilters, setSessionFilters] = useState({
    api_key_id: "",
    provider: "",
    model: "",
    ide: "",
    session_id: "",
  });
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedSessionDetail, setSelectedSessionDetail] = useState<SessionDetailResponse | null>(null);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);

  const loadRequestLogs = useCallback(async () => {
    try {
      const params: Record<string, string> = { page: requestPage.toString(), limit: "50" };
      Object.entries(requestFilters).forEach(([k, v]) => {
        if (v) params[k] = v;
      });

      const res = await logs.list(params);
      setRequestData(res.data);
      setRequestTotalPages(res.pagination.totalPages);
      setRequestTotal(res.pagination.total);
    } catch {
      // ignore load errors to keep dashboard responsive
    }
  }, [requestPage, requestFilters]);

  const loadSessions = useCallback(async () => {
    try {
      const params: Record<string, string> = { page: sessionPage.toString(), limit: "25" };
      Object.entries(sessionFilters).forEach(([k, v]) => {
        if (v) params[k] = v;
      });

      const res = await logs.sessions(params);
      setSessionData(res.data);
      setSessionTotalPages(res.pagination.totalPages);
      setSessionTotal(res.pagination.total);
      setSelectedSessionId((prev) => {
        if (res.data.length === 0) return "";
        if (prev && res.data.some((row) => row.sessionId === prev)) return prev;
        return res.data[0].sessionId;
      });
    } catch {
      // ignore load errors to keep dashboard responsive
    }
  }, [sessionPage, sessionFilters]);

  const loadSelectedSessionDetail = useCallback(async () => {
    if (!selectedSessionId) {
      setSelectedSessionDetail(null);
      return;
    }

    setSessionDetailLoading(true);
    try {
      const res = await logs.sessionDetail(selectedSessionId);
      setSelectedSessionDetail(res);
    } catch {
      setSelectedSessionDetail(null);
    } finally {
      setSessionDetailLoading(false);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    if (viewMode === "requests") {
      loadRequestLogs();
    }
  }, [viewMode, loadRequestLogs]);

  useEffect(() => {
    if (viewMode === "sessions") {
      loadSessions();
    }
  }, [viewMode, loadSessions]);

  useEffect(() => {
    if (viewMode === "sessions") {
      loadSelectedSessionDetail();
    }
  }, [viewMode, selectedSessionId, loadSelectedSessionDetail]);

  // Live mode SSE for requests + session explorer
  const handleSSEMessage = useCallback((newLog: any) => {
    if (!liveMode) return;
    if (viewMode === "requests") {
      if (requestPage !== 1) return;
      const billable = Number(newLog?.billablePromptTokens ?? newLog?.promptTokens) || 0;
      const cached = Number(newLog?.cachedTokens) || 0;
      const completion = Number(newLog?.completionTokens) || 0;
      const inputTokens = Number(newLog?.inputTokens) || billable + cached;
      const normalized = {
        ...newLog,
        billablePromptTokens: Number(newLog?.billablePromptTokens) || billable,
        cachedTokens: cached,
        upstreamCredits: Number(newLog?.upstreamCredits) || 0,
        inputTokens,
        promptTokens: inputTokens,
        completionTokens: completion,
        totalTokens: inputTokens + completion,
      };
      setRequestData((prev) => [normalized, ...prev].slice(0, 50));
    } else {
      void loadSessions();
      if (selectedSessionId) {
        void loadSelectedSessionDetail();
      }
    }
  }, [liveMode, viewMode, requestPage, selectedSessionId, loadSessions, loadSelectedSessionDetail]);
  useRealtimeSSE(handleSSEMessage, 500);

  const exportCSV = () => {
    const dateStr = new Date().toISOString().split("T")[0];
    const logSheet = buildLogsSection(requestData, "Request Logs");
    exportXlsx([logSheet], `proxy-logs-${dateStr}`, {
      title: "AI Proxy Gateway  -  Request Logs",
      period: `${requestData.length} rows (current view)`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Request & Session Logs</h1>
          <p className="text-muted-foreground mt-1">
            {viewMode === "requests" ? formatNumber(requestTotal) : formatNumber(sessionTotal)} total entries
          </p>
        </div>

        {viewMode === "requests" ? (
          <div className="flex items-center gap-2">
            {realtimeEnabled && (
              <Button
                variant={liveMode ? "default" : "outline"}
                size="sm"
                onClick={() => setLiveMode((prev) => !prev)}
                className={liveMode ? "bg-emerald-600 hover:bg-emerald-700" : ""}
              >
                <Radio className="h-3 w-3 mr-1" />
                {liveMode ? "Live Stream (On)" : "Live Stream (Paused)"}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-3 w-3 mr-1" /> Export XLSX
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={loadSessions}>Refresh Sessions</Button>
        )}
      </div>

      <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)}>
        <TabsList>
          <TabsTrigger value="requests">Raw Requests</TabsTrigger>
          <TabsTrigger value="sessions">Session Explorer</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="space-y-6">
          <Card className="border-border/50">
            <CardContent className="py-3 px-4">
              <div className="flex flex-wrap gap-3">
                <Input
                  placeholder="Model..."
                  className="w-36 h-8 text-xs"
                  value={requestFilters.model}
                  onChange={(e) => {
                    setRequestFilters((f) => ({ ...f, model: e.target.value }));
                    setRequestPage(1);
                  }}
                />
                <Input
                  placeholder="IDE..."
                  className="w-32 h-8 text-xs"
                  value={requestFilters.ide}
                  onChange={(e) => {
                    setRequestFilters((f) => ({ ...f, ide: e.target.value }));
                    setRequestPage(1);
                  }}
                />
                <Input
                  placeholder="Provider..."
                  className="w-32 h-8 text-xs"
                  value={requestFilters.provider}
                  onChange={(e) => {
                    setRequestFilters((f) => ({ ...f, provider: e.target.value }));
                    setRequestPage(1);
                  }}
                />
                <Input
                  placeholder="Session ID..."
                  className="w-40 h-8 text-xs"
                  value={requestFilters.session_id}
                  onChange={(e) => {
                    setRequestFilters((f) => ({ ...f, session_id: e.target.value }));
                    setRequestPage(1);
                  }}
                />
                <Input
                  placeholder="Context event..."
                  className="w-36 h-8 text-xs"
                  value={requestFilters.context_event}
                  onChange={(e) => {
                    setRequestFilters((f) => ({ ...f, context_event: e.target.value }));
                    setRequestPage(1);
                  }}
                />
                <Input
                  placeholder="IP Address..."
                  className="w-36 h-8 text-xs"
                  value={requestFilters.ip}
                  onChange={(e) => {
                    setRequestFilters((f) => ({ ...f, ip: e.target.value }));
                    setRequestPage(1);
                  }}
                />
                <Input
                  placeholder="Status code..."
                  className="w-28 h-8 text-xs"
                  value={requestFilters.status}
                  onChange={(e) => {
                    setRequestFilters((f) => ({ ...f, status: e.target.value }));
                    setRequestPage(1);
                  }}
                />
                <Input
                  placeholder="API Key ID..."
                  className="w-28 h-8 text-xs"
                  value={requestFilters.api_key_id}
                  onChange={(e) => {
                    setRequestFilters((f) => ({ ...f, api_key_id: e.target.value }));
                    setRequestPage(1);
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setRequestFilters({
                      api_key_id: "",
                      model: "",
                      ide: "",
                      provider: "",
                      session_id: "",
                      context_event: "",
                      ip: "",
                      status: "",
                    });
                    setRequestPage(1);
                  }}
                >
                  Clear
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Time</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">User</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">IDE / Provider</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Model</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Session</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Context</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Tools</th>
                      <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Total</th>
                      <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Est. Cost</th>
                      <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Latency</th>
                      <th className="text-center py-3 px-3 text-muted-foreground font-medium text-xs">Status</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requestData.map((log, i) => {
                      const tools = normalizeTools(log.toolsUsed);
                      const contextTokens = log.contextTokensBefore ?? log.estimatedContextLength ?? 0;
                      const contextDelta = log.contextDeltaTokens ?? 0;
                      return (
                        <tr key={log.id || i} className="border-b border-border/30 hover:bg-accent/30 transition-colors">
                          <td className="py-2 px-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{formatDate(log.createdAt)}</td>
                          <td className="py-2 px-3 text-xs">
                            <div className="flex items-center gap-1">
                              <span className="break-all">{formatLogUserDisplay(log)}</span>
                              {log.isTrial && (
                                <Badge variant="outline" className="text-[10px] border-purple-500/50 text-purple-400">
                                  Trial
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-xs">
                            <div>{log.ideDetected || "-"}</div>
                            <div className="text-[10px] text-muted-foreground">{log.provider || "unknown"}</div>
                            <div className="text-[10px] text-muted-foreground">{log.osDetected || "Unknown OS"}</div>
                          </td>
                          <td className="py-2 px-3">
                            <code className="text-[10px] bg-accent/50 px-1 py-0.5 rounded">{log.model || "-"}</code>
                          </td>
                          <td className="py-2 px-3 text-xs">
                            <div className="font-mono">{shortenSessionId(log.sessionId)}</div>
                            <div className="mt-1">
                              <Badge variant={getContextEventVariant(log.contextEvent)} className="text-[10px]">
                                {log.contextEvent || "append"}
                              </Badge>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-xs">
                            <div className="font-mono">{formatNumber(contextTokens)}</div>
                            <div className={contextDelta < 0 ? "text-amber-400 text-[10px]" : "text-muted-foreground text-[10px]"}>
                              {contextDelta === 0 ? "0" : contextDelta > 0 ? `+${contextDelta}` : contextDelta}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-xs">
                            {tools.length > 0 ? (
                              <span>{tools.slice(0, 2).join(", ")}{tools.length > 2 ? ` +${tools.length - 2}` : ""}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-xs">
                            {(() => {
                              const input = formatInputBreakdown(
                                log.billablePromptTokens,
                                log.cachedTokens,
                                log.inputTokens ?? log.promptTokens,
                              );
                              return (
                                <>
                                  <span className="text-blue-400" title={input.label}>{input.compact}</span>
                                  <span className="text-muted-foreground mx-1">/</span>
                                  <span className="text-purple-400">{formatNumber(log.completionTokens || 0)}</span>
                                </>
                              );
                            })()}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-xs font-semibold">{formatNumber(log.totalTokens || 0)}</td>
                          <td className="py-2 px-3 text-right font-mono text-xs text-emerald-400">{formatCost(log.estimatedCost)}</td>
                          <td className="py-2 px-3 text-right text-xs text-muted-foreground">{log.latencyMs}ms</td>
                          <td className="py-2 px-3 text-center">
                            <Badge variant={(log.statusCode || 0) >= 400 ? "destructive" : "success"} className="text-[10px]">
                              {log.statusCode || "-"}
                            </Badge>
                          </td>
                          <td className="py-2 px-3 text-xs text-muted-foreground max-w-[280px] truncate">{log.requestPreview || "-"}</td>
                        </tr>
                      );
                    })}
                    {requestData.length === 0 && (
                      <tr>
                        <td colSpan={11} className="text-center py-12 text-muted-foreground">No logs found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {requestTotalPages > 1 && (() => {
                const maxPages = Math.min(requestTotalPages, 10); // Cap at 500 rows (50 per page × 10)
                return (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
                  <p className="text-xs text-muted-foreground">Page {requestPage} of {maxPages}{requestTotalPages > 10 ? ` (showing max 500 rows)` : ""}</p>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={requestPage <= 1}
                      onClick={() => setRequestPage((prev) => prev - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={requestPage >= maxPages}
                      onClick={() => setRequestPage((prev) => prev + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions" className="space-y-6">
          <Card className="border-border/50">
            <CardContent className="py-3 px-4">
              <div className="flex flex-wrap gap-3">
                <Input
                  placeholder="Provider..."
                  className="w-36 h-8 text-xs"
                  value={sessionFilters.provider}
                  onChange={(e) => {
                    setSessionFilters((f) => ({ ...f, provider: e.target.value }));
                    setSessionPage(1);
                  }}
                />
                <Input
                  placeholder="Model..."
                  className="w-36 h-8 text-xs"
                  value={sessionFilters.model}
                  onChange={(e) => {
                    setSessionFilters((f) => ({ ...f, model: e.target.value }));
                    setSessionPage(1);
                  }}
                />
                <Input
                  placeholder="IDE..."
                  className="w-32 h-8 text-xs"
                  value={sessionFilters.ide}
                  onChange={(e) => {
                    setSessionFilters((f) => ({ ...f, ide: e.target.value }));
                    setSessionPage(1);
                  }}
                />
                <Input
                  placeholder="Session ID..."
                  className="w-40 h-8 text-xs"
                  value={sessionFilters.session_id}
                  onChange={(e) => {
                    setSessionFilters((f) => ({ ...f, session_id: e.target.value }));
                    setSessionPage(1);
                  }}
                />
                <Input
                  placeholder="API Key ID..."
                  className="w-28 h-8 text-xs"
                  value={sessionFilters.api_key_id}
                  onChange={(e) => {
                    setSessionFilters((f) => ({ ...f, api_key_id: e.target.value }));
                    setSessionPage(1);
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setSessionFilters({ api_key_id: "", provider: "", model: "", ide: "", session_id: "" });
                    setSessionPage(1);
                  }}
                >
                  Clear
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Session</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">User</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Provider</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Model</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">IDE</th>
                      <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Requests</th>
                      <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Input / Output</th>
                      <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Tokens</th>
                      <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Cost</th>
                      <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Context</th>
                      <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Compact / Switch</th>
                      <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Last Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionData.map((session) => (
                      <tr
                        key={session.sessionId}
                        className={`border-b border-border/30 hover:bg-accent/30 transition-colors cursor-pointer ${
                          selectedSessionId === session.sessionId ? "bg-accent/30" : ""
                        }`}
                        onClick={() => {
                          setSelectedSessionId(session.sessionId);
                          navigate(`/sessions/${encodeURIComponent(session.sessionId)}`);
                        }}
                      >
                        <td className="py-2 px-3 text-xs font-mono">{shortenSessionId(session.sessionId)}</td>
                        <td className="py-2 px-3 text-xs">{session.apiKeyName || "-"}</td>
                        <td className="py-2 px-3 text-xs">{session.provider || "unknown"}</td>
                        <td className="py-2 px-3 text-xs"><code className="text-[10px] bg-accent/50 px-1 py-0.5 rounded">{session.model || "-"}</code></td>
                        <td className="py-2 px-3 text-xs">{session.ideDetected || "-"}</td>
                        <td className="py-2 px-3 text-right font-mono text-xs">{formatNumber(session.requestCount || 0)}</td>
                        <td className="py-2 px-3 text-right font-mono text-xs">{formatNumber(session.totalTokens || 0)}</td>
                        <td className="py-2 px-3 text-right font-mono text-xs text-emerald-400">{formatCost(session.estimatedCost || 0)}</td>
                        <td className="py-2 px-3 text-right font-mono text-xs">{formatNumber(session.lastContextTokens || 0)}</td>
                        <td className="py-2 px-3 text-right text-xs text-muted-foreground">{session.compactCount || 0} / {session.switchCount || 0}</td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">
                          <div>{formatDate(session.lastSeenAt)}</div>
                        </td>
                      </tr>
                    ))}
                    {sessionData.length === 0 && (
                      <tr>
                        <td colSpan={10} className="text-center py-12 text-muted-foreground">No sessions found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {sessionTotalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
                  <p className="text-xs text-muted-foreground">Page {sessionPage} of {sessionTotalPages}</p>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={sessionPage <= 1}
                      onClick={() => setSessionPage((prev) => prev - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={sessionPage >= sessionTotalPages}
                      onClick={() => setSessionPage((prev) => prev + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Session Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {sessionDetailLoading && (
                <div className="text-sm text-muted-foreground">Loading session detail...</div>
              )}

              {!sessionDetailLoading && !selectedSessionDetail && (
                <div className="text-sm text-muted-foreground">Select a session to view its timeline.</div>
              )}

              {!sessionDetailLoading && selectedSessionDetail && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-border/50 p-3">
                      <p className="text-[11px] text-muted-foreground">Session</p>
                      <p className="font-mono text-xs mt-1">{selectedSessionDetail.session.sessionId}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 p-3">
                      <p className="text-[11px] text-muted-foreground">Requests / Tokens</p>
                      <p className="text-sm mt-1">{formatNumber(selectedSessionDetail.session.requestCount)} / {formatNumber(selectedSessionDetail.session.totalTokens)}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 p-3">
                      <p className="text-[11px] text-muted-foreground">Context Now</p>
                      <p className="text-sm mt-1">{formatNumber(selectedSessionDetail.session.lastContextTokens)}</p>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-border/50">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/50">
                          <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Time</th>
                          <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Event</th>
                          <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Context</th>
                          <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Tools</th>
                          <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Tokens</th>
                          <th className="text-center py-3 px-3 text-muted-foreground font-medium text-xs">Status</th>
                          <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Preview</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSessionDetail.timeline.map((row, i) => {
                          const tools = normalizeTools(row.toolsUsed);
                          const contextTokens = row.contextTokensBefore ?? row.estimatedContextLength ?? 0;
                          const contextDelta = row.contextDeltaTokens ?? 0;
                          return (
                            <tr key={`${row.id || i}-${row.createdAt}`} className="border-b border-border/30">
                              <td className="py-2 px-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{formatDate(row.createdAt)}</td>
                              <td className="py-2 px-3 text-xs">
                                <Badge variant={getContextEventVariant(row.contextEvent)} className="text-[10px]">
                                  {row.contextEvent || "append"}
                                </Badge>
                              </td>
                              <td className="py-2 px-3 text-xs font-mono">
                                <div>{formatNumber(contextTokens)}</div>
                                <div className={contextDelta < 0 ? "text-amber-400 text-[10px]" : "text-muted-foreground text-[10px]"}>
                                  {contextDelta === 0 ? "0" : contextDelta > 0 ? `+${contextDelta}` : contextDelta}
                                </div>
                              </td>
                              <td className="py-2 px-3 text-xs">{tools.length ? tools.join(", ") : "-"}</td>
                              <td className="py-2 px-3 text-right font-mono text-xs">{formatNumber(row.totalTokens || 0)}</td>
                              <td className="py-2 px-3 text-center">
                                <Badge variant={(row.statusCode || 0) >= 400 ? "destructive" : "success"} className="text-[10px]">
                                  {row.statusCode || "-"}
                                </Badge>
                              </td>
                              <td className="py-2 px-3 text-xs text-muted-foreground max-w-[300px] truncate">{row.requestPreview || "-"}</td>
                            </tr>
                          );
                        })}
                        {selectedSessionDetail.timeline.length === 0 && (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-muted-foreground">No request timeline for this session.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

