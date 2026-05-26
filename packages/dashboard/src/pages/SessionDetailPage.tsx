import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { logs, type SessionDetailResponse } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ChevronDown, ChevronUp, Download } from "lucide-react";
import { formatDate, formatNumber, formatCost, formatRelativeTime } from "@/lib/utils";
import { useRealtimeSSE } from "@/lib/use-realtime-sse";
import { exportCsvMultiSection, buildTimelineSection } from "@/lib/export-csv";
import { useCallback } from "react";

type TimelineTurn = {
  id: number;
  createdAt: string;
  model?: string | null;
  contextEvent?: string | null;
  requestPreview?: string | null;
  responsePreview?: string | null;
  toolsUsed?: string[];
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCost?: number;
  latencyMs?: number;
  statusCode?: number;
  transcript?: { role: string; content: string }[];
  attemptCount?: number;
  statusTrail?: number[];
  latencyTrail?: number[];
  errorMessages?: string[];
  firstSeenAt?: string;
  lastSeenAt?: string;
  turnKey?: string;
};

function roleTone(role: string): string {
  const key = String(role || "").toLowerCase();
  if (key === "user") return "bg-blue-500/10 border-blue-500/30";
  if (key === "assistant") return "bg-emerald-500/10 border-emerald-500/30";
  if (key === "system") return "bg-amber-500/10 border-amber-500/30";
  return "bg-accent/40 border-border/60";
}

export default function SessionDetailPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedTurns, setExpandedTurns] = useState<Record<string, boolean>>({});
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});

  const loadDetail = async () => {
    if (!sessionId) return;
    try {
      const response = await logs.sessionDetail(sessionId);
      setDetail(response);
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void loadDetail();
  }, [sessionId]);

  const handleSSEMessage = useCallback((row: any) => {
    if (row?.sessionId !== sessionId) return;
    void loadDetail();
  }, [sessionId]);
  useRealtimeSSE(handleSSEMessage, 450);

  const turns = useMemo(() => {
    return (detail?.timeline || []) as unknown as TimelineTurn[];
  }, [detail]);

  const renderMessage = (content: string, id: string) => {
    const text = String(content || "").trim();
    if (!text) return "-";
    const needsCollapse = text.length > 560;
    const expanded = !!expandedMessages[id];
    if (!needsCollapse || expanded) {
      return (
        <div>
          <p className="text-sm mt-2 whitespace-pre-wrap break-words">{text}</p>
          {needsCollapse ? (
            <Button variant="ghost" size="sm" className="h-7 mt-2 px-2" onClick={() => setExpandedMessages((prev) => ({ ...prev, [id]: false }))}>
              Show less
            </Button>
          ) : null}
        </div>
      );
    }
    return (
      <div>
        <p className="text-sm mt-2 whitespace-pre-wrap break-words">{text.slice(0, 560)}...</p>
        <Button variant="ghost" size="sm" className="h-7 mt-2 px-2" onClick={() => setExpandedMessages((prev) => ({ ...prev, [id]: true }))}>
          Show more
        </Button>
      </div>
    );
  };

  const getRoleText = (turn: TimelineTurn, role: string): string => {
    const hit = [...(turn.transcript || [])]
      .reverse()
      .find((entry) => String(entry.role || "").toLowerCase() === role.toLowerCase());
    return String(hit?.content || "").trim();
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading session detail...</div>;
  }

  const handleExport = () => {
    const sess = detail?.session;
    const dateStr = new Date().toISOString().split("T")[0];
    const sessionName = sess?.sessionName && sess.sessionName.trim() ? sess.sessionName : "Session";

    const sections = [];

    // Section 1: Session info
    if (sess) {
      sections.push({
        title: "Session Info",
        headers: ["Field", "Value"],
        rows: [
          ["Session Name",  sess.sessionName || "Untitled Chat"],
          ["Session ID",    sess.sessionId],
          ["IDE",           sess.ideDetected || "Unknown"],
          ["Provider",      sess.provider || "Unknown"],
          ["Model (Last)",  sess.model || "Unknown"],
          ["Device",        sess.deviceFingerprint || "Unknown"],
          ["User Prompts",  sess.requestCount],
          ["Total Tokens",  sess.totalTokens],
          ["Est. Cost",     `$${((sess.estimatedCost||0)/1e6).toFixed(5)}`],
          ["First Seen",    sess.firstSeenAt],
          ["Last Seen",     sess.lastSeenAt],
        ],
      });
    }

    // Section 2: Timeline
    sections.push(buildTimelineSection(turns, "Conversation Timeline"));

    exportCsvMultiSection(
      sections,
      `session-${sessionName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${dateStr}.csv`,
      "Full Session",
    );
  };

  if (!detail) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">Session not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {detail.session.sessionName && detail.session.sessionName.trim()
              ? detail.session.sessionName
              : "Session Transcript"}
          </h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">{detail.session.sessionId}</p>
        </div>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="border-border/50"><CardContent className="p-4"><p className="text-xs text-muted-foreground">IDE</p><p className="text-sm mt-1">{detail.session.ideDetected || "Unknown"}</p></CardContent></Card>
        <Card className="border-border/50"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Provider / Model</p><p className="text-sm mt-1">{detail.session.provider || "unknown"} / {detail.session.model || "unknown"}</p></CardContent></Card>
        <Card className="border-border/50"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Reqs / Tokens / Cost</p><p className="text-sm mt-1">{formatNumber(detail.session.requestCount)} / {formatNumber(detail.session.totalTokens)} / <span className="text-emerald-400">{formatCost(detail.session.estimatedCost)}</span></p></CardContent></Card>
        <Card className="border-border/50"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Last Seen</p><p className="text-sm mt-1">{formatRelativeTime(detail.session.lastSeenAt)}</p></CardContent></Card>
      </div>

      <Card className="border-border/50">
        <CardHeader><CardTitle className="text-base">Conversation Flow</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {turns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No chat turns captured yet for this session.</p>
          ) : (
            turns.map((turn, idx) => {
              const key = turn.turnKey || `${turn.id}-${idx}`;
              const userText = getRoleText(turn, "user") || String(turn.requestPreview || "");
              const assistantText = String(turn.responsePreview || "") || getRoleText(turn, "assistant");
              const attempts = turn.attemptCount || 1;
              const expanded = !!expandedTurns[key];
              return (
                <div key={key} className="rounded-lg border border-border/60 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">Turn #{idx + 1}</Badge>
                      <Badge variant={(turn.statusCode || 0) >= 400 ? "destructive" : "success"} className="text-[10px]">{turn.statusCode || "-"}</Badge>
                      {turn.model ? <code className="text-[10px] bg-accent/50 px-1.5 py-0.5 rounded">{turn.model}</code> : null}
                      {attempts > 1 ? <Badge variant="secondary" className="text-[10px]">{attempts} attempts</Badge> : null}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{formatDate(turn.lastSeenAt || turn.createdAt)}</div>
                  </div>

                  <div className={`rounded-lg border p-3 ${roleTone("user")}`}>
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="secondary" className="text-[10px]">user</Badge>
                      <span className="text-[10px] text-muted-foreground">{formatRelativeTime(turn.firstSeenAt || turn.createdAt)}</span>
                    </div>
                    {renderMessage(userText, `${key}-user`)}
                  </div>

                  <div className={`rounded-lg border p-3 ${roleTone("assistant")}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">assistant</Badge>
                        {turn.model ? <code className="text-[10px] text-muted-foreground">{turn.model}</code> : null}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{formatNumber(turn.totalTokens || 0)} tokens</span>
                    </div>
                    {renderMessage(assistantText || "-", `${key}-assistant`)}
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span>event: {turn.contextEvent || "append"}</span>
                    <span>latency: {turn.latencyMs || 0}ms</span>
                    <span>tools: {(turn.toolsUsed || []).join(", ") || "-"}</span>
                  </div>

                  {attempts > 1 ? (
                    <div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setExpandedTurns((prev) => ({ ...prev, [key]: !prev[key] }))}
                      >
                        {expanded ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />} 
                        {expanded ? "Hide retry details" : "Show retry details"}
                      </Button>

                      {expanded ? (
                        <div className="mt-2 rounded-lg border border-border/50 p-2 text-xs text-muted-foreground space-y-1">
                          <div>Status trail: {(turn.statusTrail || []).join(" -> ") || "-"}</div>
                          <div>Latency trail: {(turn.latencyTrail || []).map((v) => `${v}ms`).join(" -> ") || "-"}</div>
                          {(turn.errorMessages || []).length > 0 ? <div>Errors: {(turn.errorMessages || []).join(" | ")}</div> : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader><CardTitle className="text-base">Technical Timeline (Collapsed Turns)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Time</th>
                  <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Model</th>
                  <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Event</th>
                  <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Tools</th>
                  <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Input / Output</th>
                  <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Total Tokens</th>
                  <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Cost</th>
                  <th className="text-right py-3 px-3 text-muted-foreground font-medium text-xs">Latency</th>
                  <th className="text-center py-3 px-3 text-muted-foreground font-medium text-xs">Status</th>
                  <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Prompt</th>
                  <th className="text-left py-3 px-3 text-muted-foreground font-medium text-xs">Reply</th>
                </tr>
              </thead>
              <tbody>
                {turns.map((row, idx) => (
                  <tr key={row.id} className="border-b border-border/30">
                    <td className="py-2 px-3 text-xs text-muted-foreground">{formatDate(row.lastSeenAt || row.createdAt)}</td>
                    <td className="py-2 px-3 text-xs"><code className="bg-accent/50 px-1 py-0.5 rounded text-[10px]">{row.model || "—"}</code></td>
                    <td className="py-2 px-3 text-xs">{row.contextEvent || "append"}</td>
                    <td className="py-2 px-3 text-xs">{(row.toolsUsed || []).join(", ") || "-"}</td>
                    <td className="py-2 px-3 text-right font-mono text-xs">
                      <span className="text-blue-400">{formatNumber(row.promptTokens || 0)}</span>
                      <span className="text-muted-foreground mx-1">/</span>
                      <span className="text-purple-400">{formatNumber(row.completionTokens || 0)}</span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs">{formatNumber(row.totalTokens || 0)}</td>
                    <td className="py-2 px-3 text-right font-mono text-xs text-emerald-400/90">{formatCost(row.estimatedCost || 0)}</td>
                    <td className="py-2 px-3 text-right text-xs text-muted-foreground">{row.latencyMs}ms</td>
                    <td className="py-2 px-3 text-center"><Badge variant={(row.statusCode || 0) >= 400 ? "destructive" : "success"} className="text-[10px]">{row.statusCode || "-"}</Badge></td>
                    <td className="py-2 px-3 text-xs text-muted-foreground max-w-[320px] truncate">{row.requestPreview || "-"}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground max-w-[320px] truncate">{row.responsePreview || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
