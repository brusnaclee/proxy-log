import { useEffect, useState, useCallback, useRef } from "react";
import { stats, logs, type OverviewStats, type LogEntry } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber, formatRelativeTime, formatChartPeriod, formatLogUserDisplay, formatInputBreakdown } from "@/lib/utils";
import { Activity, Coins, Key, Monitor, TrendingUp, Download, RefreshCw, DollarSign, Search, ChevronLeft, ChevronRight } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { ChartBox } from "@/components/ChartBox";
import { useRealtimeSSE } from "@/lib/use-realtime-sse";
import { exportXlsx, buildModelsSection, fmtCost } from "@/lib/export-xlsx";
import { formatCost } from "@/lib/utils";
import { PeriodSelector, type PeriodKey } from "@/components/PeriodSelector";
import { useNotify } from "@/components/Notify";

// ─── Types ────────────────────────────────────────────────────────────────────
type LocalPeriodKey = "today" | "3d" | "7d" | "30d" | "thisMonth" | "lastMonth" | "allTime";

const PERIOD_OPTS: { key: LocalPeriodKey; label: string }[] = [
  { key: "today",   label: "Today"    },
  { key: "7d",     label: "7 Days"   },
  { key: "30d",    label: "30 Days"  },
  { key: "allTime", label: "All Time" },
];

const CHART_DAYS: Record<LocalPeriodKey, number> = {
  today:      1,
  "3d":       3,
  "7d":       7,
  "30d":     30,
  thisMonth: 62,
  lastMonth: 62,
  allTime:   90,
};

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
  color: "hsl(var(--foreground))",
};
const ITEM_STYLE  = { color: "hsl(var(--foreground))" };
const LABEL_STYLE = { color: "hsl(var(--foreground))" };

/** Recent Requests: 20 rows/page, paginate up to 25 pages (500 rows). */
const RECENT_PAGE_SIZE = 20;
const RECENT_MAX_PAGES = 25;

// ─── Component ────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const notify = useNotify();
  const [overview, setOverview]         = useState<OverviewStats | null>(null);
  const [timeseries, setTimeseries]     = useState<any[]>([]);
  const [modelStats, setModelStats]     = useState<any[]>([]);
  const [recentLogs, setRecentLogs]     = useState<LogEntry[]>([]);
  const [recentPage, setRecentPage]     = useState(1);
  const [recentTotalPages, setRecentTotalPages] = useState(1);
  const [recentTotal, setRecentTotal]   = useState(0);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError]   = useState<string | null>(null);
  const recentPageRef = useRef(1);
  const [period, setPeriod]             = useState<LocalPeriodKey>("today");
  const [chartPeriod, setChartPeriod]   = useState<LocalPeriodKey>("7d"); // for charts only
  const [modelChartDays, setModelChartDays] = useState(7);
  const [chartMetric, setChartMetric]   = useState<"prompts" | "apiCalls">("prompts");

  // Search User State
  const [searchUserResult, setSearchUserResult] = useState<any>(null);

  const handleSearchUser = async () => {
    const discordId = await notify.prompt({
      title: "Search Discord user",
      message: "Masukkan Discord User ID:",
      placeholder: "e.g. 123456789012345678",
      confirmLabel: "Search",
    });
    if (!discordId?.trim()) return;
    try {
      const res = await stats.userDetail(discordId.trim());
      if (res.error) {
        notify.error("Error: " + res.error);
        return;
      }
      if (res.found === false || !res.discordUserId) {
        notify.error("User tidak ditemukan.");
        return;
      }
      setSearchUserResult(res);
    } catch (err: any) {
      notify.error("Gagal mencari user: " + err.message);
    }
  };

  // Map period to overview sub-object
  const periodData = overview
    ? ({
        today:      overview.today,
        "3d":       overview.week,
        "7d":       overview.week,
        "30d":      overview.month,
        thisMonth:  overview.month,
        lastMonth:  overview.month,
        allTime:    overview.allTime,
      } as Record<LocalPeriodKey, typeof overview.today>)[period]
    : null;

  const loadData = useCallback(async () => {
    try {
      const tsdays = CHART_DAYS[chartPeriod];
      const tsperiod = tsdays <= 1 ? "hourly" : "daily";
      const [ov, ts, ms] = await Promise.all([
        stats.overview(),
        stats.timeseries(tsperiod, tsdays),
        stats.byModel(modelChartDays),
      ]);
      setOverview(ov);
      setTimeseries(ts);
      setModelStats(ms);
    } catch {}
  }, [chartPeriod, modelChartDays]);

  const loadRecentLogs = useCallback(async (page: number) => {
    const safePage = Math.max(1, Math.min(page, RECENT_MAX_PAGES));
    setRecentLoading(true);
    setRecentError(null);
    try {
      const lg = await logs.list({
        page: String(safePage),
        limit: String(RECENT_PAGE_SIZE),
        lite: "1",
        period: "7d",
      });
      const rows = Array.isArray(lg?.data) ? lg.data : [];
      setRecentLogs(
        rows.map((r) => ({
          ...r,
          createdAt:
            r.createdAt ||
            (r as any).created_at ||
            new Date().toISOString(),
        })),
      );
      const total = Number(lg?.pagination?.total) || 0;
      const apiPages = Math.max(1, Number(lg?.pagination?.totalPages) || 1);
      setRecentTotal(total);
      setRecentTotalPages(Math.min(apiPages, RECENT_MAX_PAGES));
      setRecentPage(safePage);
      recentPageRef.current = safePage;
    } catch (e: any) {
      setRecentError(e?.message || "Failed to load recent requests");
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { void loadRecentLogs(1); }, [loadRecentLogs]);

  const handleSSEMessage = useCallback((data: any) => {
    // Live prepend only on page 1 so other pages stay stable
    if (recentPageRef.current !== 1) return;
    const billable = Number(data?.billablePromptTokens ?? data?.promptTokens) || 0;
    const cached = Number(data?.cachedTokens) || 0;
    const completion = Number(data?.completionTokens) || 0;
    // SSE used to emit promptTokens=billable only; normalize like API mapTimelineRow
    const inputTokens = Number(data?.inputTokens) || billable + cached;
    const entry = {
      ...data,
      createdAt: data?.createdAt || data?.created_at || new Date().toISOString(),
      billablePromptTokens: Number(data?.billablePromptTokens) || billable,
      cachedTokens: cached,
      inputTokens,
      promptTokens: inputTokens,
      completionTokens: completion,
      totalTokens: inputTokens + completion,
    };
    setRecentLogs((prev) => {
      const id = entry?.id;
      const withoutDup = id != null ? prev.filter((r) => r.id !== id) : prev;
      return [entry, ...withoutDup].slice(0, RECENT_PAGE_SIZE);
    });
    setRecentTotal((t) => t + 1);
  }, []);
  useRealtimeSSE(handleSSEMessage, 800);

  // Soft refresh cards/charts every 45s (cache-backed on server; logs stay SSE-live)
  useEffect(() => {
    const id = setInterval(() => { void loadData(); }, 45_000);
    return () => clearInterval(id);
  }, [loadData]);

  // ─── Export ─────────────────────────────────────────────────────────────────
  const handleExport = () => {
    const periodLabelMap: Record<LocalPeriodKey, string> = {
      today: "Today", "3d": "Last 3 Days", "7d": "7 Days", "30d": "30 Days",
      thisMonth: "This Month", lastMonth: "Last Month", allTime: "All Time",
    };
    const activePeriodLabel = periodLabelMap[period] || "All Time";
    const dateStr = new Date().toISOString().split("T")[0];
    const sheets = [];

    // Sheet 1: Summary stats across all periods
    if (overview) {
      sheets.push({
        name: "Summary",
        note: "Aggregated stats across all API keys and devices",
        headers: ["Metric", "Today", "Last 7 Days", "Last 30 Days", "All Time"],
        rows: [
          ["Prompts",           overview.today.requests,                                 overview.week?.requests ?? "",              overview.month?.requests ?? "",              overview.allTime.requests],
          ["Total Tokens",      overview.today.tokens,                                   overview.week?.tokens ?? "",                overview.month?.tokens ?? "",                overview.allTime.tokens],
          ["Input Tokens",      overview.today.promptTokens ?? "",                       overview.week?.promptTokens ?? "",          overview.month?.promptTokens ?? "",          overview.allTime.promptTokens ?? ""],
          ["Output Tokens",     overview.today.completionTokens ?? "",                   overview.week?.completionTokens ?? "",      overview.month?.completionTokens ?? "",      overview.allTime.completionTokens ?? ""],
          ["Unique Devices",    overview.today.uniqueDevices ?? "",                      "",                                        "",                                          overview.totalDevices],
          ["Active Keys",       overview.activeKeys,                                     "",                                        "",                                          overview.totalKeys],
          ["Total Sessions",    "",                                                      "",                                        "",                                          overview.allTime.totalSessions ?? ""],
          ["Avg Prompts/Session", "",                                                    "",                                        "",                                          (overview.allTime.avgRequestsPerSession || 0).toFixed(2)],
          ["Est. Cost",         fmtCost(overview.today.totalCost ?? overview.today.estimatedCost), fmtCost(overview.week?.totalCost ?? overview.week?.estimatedCost), fmtCost(overview.month?.totalCost ?? overview.month?.estimatedCost), fmtCost(overview.allTime.totalCost ?? overview.allTime.estimatedCost)],
        ],
      });
    }

    // Sheet 2: Timeseries
    if (timeseries.length) {
      sheets.push({
        name: "Timeseries",
        note: "Daily/hourly data  -  select columns and Insert Chart in Excel to visualize",
        headers: ["Period", "Prompts", "Total Tokens", "Input Tokens", "Output Tokens", "Est. Cost", "Unique Devices"],
        rows: timeseries.map(t => [
          t.period,
          Number(t.requests) || 0,
          Number(t.tokens) || 0,
          Number(t.promptTokens) || 0,
          Number(t.completionTokens) || 0,
          fmtCost(t.estimatedCost),
          Number(t.uniqueDevices) || 0,
        ]),
      });
    }

    // Sheet 3: Model breakdown
    if (modelStats.length) {
      sheets.push(buildModelsSection(modelStats, "Models"));
    }

    exportXlsx(sheets, `gateway-overview-${dateStr}`, {
      title: "AI Proxy Gateway  -  Overview Report",
      period: activePeriodLabel,
    });
  };

  // ─── Stat Cards ─────────────────────────────────────────────────────────────

  const periodLabelMap: Record<LocalPeriodKey, string> = {
    today: "Today", "3d": "3 Days", "7d": "7 Days", "30d": "30 Days",
    thisMonth: "This Month", lastMonth: "Last Month", allTime: "All Time",
  };

  const dynamicCards = periodData
    ? [
        {
          label: `Prompts (${periodLabelMap[period]})`,
          value: formatNumber(periodData.requests),
          icon: Activity,
          sub: period === "allTime"
            ? `${overview?.allTime.totalSessions || 0} sessions total`
            : `${formatNumber(overview?.allTime.requests || 0)} all time`,
          color: "text-blue-400",
        },
        {
          label: `API Calls (${periodLabelMap[period]})`,
          value: formatNumber(periodData.apiCalls || 0),
          icon: TrendingUp,
          sub: period === "allTime"
            ? "Live hops (tool retries included)"
            : `${formatNumber(overview?.allTime.apiCalls || 0)} all time`,
          color: "text-indigo-400",
        },
        {
          label: `Total Tokens (${periodLabelMap[period]})`,
          value: formatNumber(periodData.tokens),
          icon: Coins,
          sub: `${formatNumber(overview?.allTime.tokens || 0)} all time`,
          color: "text-emerald-400",
        },
        {
          label: `Input Tokens (${periodLabelMap[period]})`,
          value: formatInputBreakdown(
            periodData.billablePromptTokens,
            periodData.cachedTokens,
            periodData.promptTokens || 0,
          ).label,
          icon: Coins,
          sub: `Cost: ${formatCost(periodData.promptCost || 0)}`,
          color: "text-cyan-400",
        },
        {
          label: `Output Tokens (${periodLabelMap[period]})`,
          value: formatNumber(periodData.completionTokens || 0),
          icon: Coins,
          sub: `Cost: ${formatCost(periodData.completionCost || 0)}`,
          color: "text-orange-400",
        },
        {
          label: `Est. Cost (${periodLabelMap[period]})`,
          value: formatCost((periodData.promptCost || 0) + (periodData.completionCost || 0)),
          icon: DollarSign,
          sub: `All time: ${formatCost((overview?.allTime.promptCost || 0) + (overview?.allTime.completionCost || 0))}`,
          color: "text-emerald-500",
        },
      ]
    : [];

  const staticCards = overview
    ? [
        {
          label: "Active API Keys",
          value: overview.activeKeys.toString(),
          icon: Key,
          sub: `${overview.totalKeys} total`,
          color: "text-violet-400",
        },
        {
          label: "Unique Devices",
          value: (overview.today.uniqueDevices || 0).toString(),
          icon: Monitor,
          sub: `${overview.totalDevices} total registered`,
          color: "text-amber-400",
        },
        {
          label: "Total Sessions",
          value: formatNumber(overview.allTime.totalSessions || 0),
          icon: TrendingUp,
          sub: `Avg ${(overview.allTime.avgRequestsPerSession || 0).toFixed(2)} prompts/session`,
          color: "text-pink-400",
        },
      ]
    : [];

  const allCards = [...dynamicCards, ...staticCards];

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor your AI API proxy usage in real-time</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />Export XLSX
          </Button>
        </div>
      </div>

      {/* Period Toggle for stat cards */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Period:</span>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* User Search Feature */}
      <Card className="border-border/50 bg-accent/20">
        <CardContent className="p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div>
            <h3 className="font-medium flex items-center gap-2">
              <Search className="w-4 h-4 text-primary" /> Cari Usage User
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Klik tombol di bawah untuk mencari data penggunaan API seorang user. Masukkan Discord User ID saat diminta.
            </p>
            {searchUserResult && (
              <div className="mt-3 text-sm bg-background p-3 rounded border border-border">
                <p><strong>User:</strong> {searchUserResult.discordUsername || searchUserResult.discordUserId}</p>
                <p><strong>Status Key:</strong> {searchUserResult.isActive ? 'Aktif' : 'Nonaktif'}</p>
                <div className="mt-2 space-y-1">
                  <p className="font-semibold">Prompt Limits:</p>
                  <p>Global: {searchUserResult.promptLimit > 0 ? `${searchUserResult.promptUsed} / ${searchUserResult.promptLimit} (${searchUserResult.promptLimitWindow})` : 'Unlimited'}</p>
                  <p className="font-semibold mt-1">Per-Model:</p>
                  <ul className="list-disc list-inside pl-4 text-xs">
                    {searchUserResult.modelUsage?.map((m: any) => (
                      <li key={m.model}><code>{m.model}</code>: {m.used} / {m.limit > 0 ? m.limit : '∞'}</li>
                    ))}
                    {(!searchUserResult.modelUsage || searchUserResult.modelUsage.length === 0) && (
                      <li>Default: {searchUserResult.perModelPromptLimit > 0 ? `${searchUserResult.perModelPromptLimit} (${searchUserResult.perModelPromptLimitWindow})` : 'Unlimited'}</li>
                    )}
                  </ul>
                </div>
                <div className="mt-2 space-y-1">
                  <p className="font-semibold">Token Limits (Harian):</p>
                  <p>Input: {formatNumber(searchUserResult.dailyInputUsed || 0)} / {searchUserResult.dailyInputTokenLimit > 0 ? formatNumber(searchUserResult.dailyInputTokenLimit) : 'Unlimited'}</p>
                  <p>Output: {formatNumber(searchUserResult.dailyOutputUsed || 0)} / {searchUserResult.dailyOutputTokenLimit > 0 ? formatNumber(searchUserResult.dailyOutputTokenLimit) : 'Unlimited'}</p>
                  <p>Total: {formatNumber(searchUserResult.dailyTokensUsed || 0)} / {searchUserResult.dailyTokenLimit > 0 ? formatNumber(searchUserResult.dailyTokenLimit) : 'Unlimited'}</p>
                  <p>Bulanan: {formatNumber(searchUserResult.monthlyTokensUsed || 0)} / {searchUserResult.monthlyTokenLimit > 0 ? formatNumber(searchUserResult.monthlyTokenLimit) : 'Unlimited'}</p>
                </div>
              </div>
            )}
          </div>
          <Button onClick={handleSearchUser} variant="secondary" size="sm">
            <Search className="w-4 h-4 mr-2" /> Cari User
          </Button>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-4">
        {allCards.map((card) => (
          <Card key={card.label} className="border-border/50 transition-all duration-200 hover:border-border hover:bg-accent/10">
            <CardContent className="stat-card">
              <div className="flex items-center justify-between">
                <p className="text-xs sm:text-sm text-muted-foreground leading-tight">{card.label}</p>
                <card.icon className={`h-4 w-4 shrink-0 ${card.color}`} />
              </div>
              <p className="text-xl sm:text-2xl font-bold mt-2 truncate tabular-nums">{card.value}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 truncate">{card.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Requests Over Time */}
        <Card className="border-border/50">
          <CardHeader className="pb-2 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base font-medium">
                {chartMetric === "prompts" ? "Prompts Over Time" : "API Calls Over Time"}
              </CardTitle>
              <PeriodSelector value={chartPeriod} onChange={setChartPeriod} />
            </div>
            <div className="inline-flex rounded-lg border border-border/60 p-0.5 bg-accent/20">
              {([
                { key: "prompts" as const, label: "Prompts" },
                { key: "apiCalls" as const, label: "API Calls" },
              ]).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setChartMetric(opt.key)}
                  className={`px-3 py-1 text-xs rounded-md transition-all duration-200 ${
                    chartMetric === opt.key
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <ChartBox>
                <LineChart data={timeseries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={formatChartPeriod}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={LABEL_STYLE} />
                  <Line
                    type="monotone"
                    dataKey={chartMetric === "prompts" ? "requests" : "apiCalls"}
                    name={chartMetric === "prompts" ? "Prompts" : "API Calls"}
                    stroke={chartMetric === "prompts" ? "#818cf8" : "#34d399"}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive
                    animationDuration={450}
                  />
                </LineChart>
            </ChartBox>
          </CardContent>
        </Card>

        {/* Token Usage by Model */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Token Usage by Model</CardTitle>
              <div className="flex gap-1">
                {[{ label: "1d", days: 1 }, { label: "7d", days: 7 }, { label: "30d", days: 30 }, { label: "All", days: 0 }].map((o) => (
                  <button
                    key={o.days}
                    onClick={() => setModelChartDays(o.days)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      modelChartDays === o.days
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ChartBox>
                <BarChart data={modelStats.slice(0, 8)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="model"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => v?.split("/").pop()?.replace("claude-", "c-").replace("gpt-", "").substring(0, 12)}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={ITEM_STYLE}
                    labelStyle={LABEL_STYLE}
                    formatter={(value: number) => formatNumber(value)}
                  />
                  <Bar dataKey="tokens" fill="#818cf8" radius={[4, 4, 0, 0]} name="Tokens" />
                </BarChart>
            </ChartBox>
          </CardContent>
        </Card>
      </div>

      {/* Recent Requests */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base font-medium">Recent API calls</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={recentLoading}
                onClick={() => void loadRecentLogs(recentPage)}
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${recentLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Time</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">User</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Model</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium hide-mobile">IDE</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Tokens</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium hide-mobile">Latency</th>
                  <th className="text-center py-2 px-3 text-muted-foreground font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log, i) => (
                  <tr key={log.id || i} className="border-b border-border/30 hover:bg-accent/30 transition-colors">
                    <td className="py-2 px-3 text-xs text-muted-foreground font-mono">
                      {log.createdAt ? formatRelativeTime(log.createdAt) : "—"}
                    </td>
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
                    <td className="py-2 px-3">
                      <code className="text-xs bg-accent/50 px-1.5 py-0.5 rounded">{log.model || " - "}</code>
                    </td>
                    <td className="py-2 px-3 text-xs hide-mobile">{log.ideDetected || " - "}</td>
                    <td className="py-2 px-3 text-right font-mono text-xs">
                      {(() => {
                        const input = formatInputBreakdown(
                          log.billablePromptTokens,
                          log.cachedTokens,
                          log.inputTokens ?? log.promptTokens,
                        );
                        return (
                          <>
                            <div title={`${input.label} · out ${formatNumber(log.completionTokens || 0)}`}>
                              {formatNumber(log.totalTokens || 0)}
                            </div>
                            <div className="text-[10px] text-muted-foreground" title={input.label}>
                              ↑{input.compact}
                              {" · "}↓{formatNumber(log.completionTokens || 0)}
                            </div>
                          </>
                        );
                      })()}
                    </td>
                    <td className="py-2 px-3 text-right text-xs text-muted-foreground hide-mobile">
                      {log.latencyMs || 0}ms
                    </td>
                    <td className="py-2 px-3 text-center">
                      <Badge
                        variant={(log.statusCode || 0) >= 400 ? "destructive" : "success"}
                        className="text-[10px]"
                      >
                        {log.statusCode || " - "}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {recentLogs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground">
                      {recentLoading
                        ? "Loading recent requests..."
                        : recentError
                          ? `Failed to load: ${recentError}`
                          : "No requests in the last 7 days."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between pt-3 mt-1 border-t border-border/50">
            <p className="text-xs text-muted-foreground">
              {recentLoading
                ? "Loading…"
                : `Page ${recentPage} of ${recentTotalPages} · ${formatNumber(recentTotal)} in last 7d · ${RECENT_PAGE_SIZE}/page`}
              {recentTotalPages >= RECENT_MAX_PAGES ? ` (max ${RECENT_MAX_PAGES} pages)` : ""}
            </p>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={recentLoading || recentPage <= 1}
                onClick={() => void loadRecentLogs(recentPage - 1)}
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={recentLoading || recentPage >= recentTotalPages}
                onClick={() => void loadRecentLogs(recentPage + 1)}
                title="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
