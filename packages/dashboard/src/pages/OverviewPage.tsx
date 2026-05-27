import { useEffect, useState, useCallback } from "react";
import { stats, logs, type OverviewStats, type LogEntry } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber, formatRelativeTime } from "@/lib/utils";
import { Activity, Coins, Key, Monitor, TrendingUp, Download, RefreshCw, DollarSign, Search } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useRealtimeSSE } from "@/lib/use-realtime-sse";
import { exportXlsx, buildModelsSection, fmtCost } from "@/lib/export-xlsx";
import { formatCost } from "@/lib/utils";

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type PeriodKey = "today" | "7d" | "30d" | "allTime";

const PERIOD_OPTS: { key: PeriodKey; label: string }[] = [
  { key: "today",   label: "Today"    },
  { key: "7d",      label: "7 Days"   },
  { key: "30d",     label: "30 Days"  },
  { key: "allTime", label: "All Time" },
];

const CHART_DAYS: Record<PeriodKey, number> = {
  today:   1,
  "7d":    7,
  "30d":   30,
  allTime: 90, // show 90d timeseries for "all" view
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

// â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function OverviewPage() {
  const [overview, setOverview]         = useState<OverviewStats | null>(null);
  const [timeseries, setTimeseries]     = useState<any[]>([]);
  const [modelStats, setModelStats]     = useState<any[]>([]);
  const [recentLogs, setRecentLogs]     = useState<LogEntry[]>([]);
  const [period, setPeriod]             = useState<PeriodKey>("today");
  const [chartPeriod, setChartPeriod]   = useState<PeriodKey>("7d"); // for charts only
  const [modelChartDays, setModelChartDays] = useState(7);

  // Search User State
  const [searchUserResult, setSearchUserResult] = useState<any>(null);

  const handleSearchUser = async () => {
    const discordId = window.prompt("Masukkan Discord User ID saat diminta:");
    if (!discordId) return;
    try {
      const res = await stats.userDetail(discordId.trim());
      if (res.error) {
        alert("Error: " + res.error);
        return;
      }
      if (res.found === false || !res.discordUserId) {
        alert("User tidak ditemukan.");
        return;
      }
      setSearchUserResult(res);
    } catch (err: any) {
      alert("Gagal mencari user: " + err.message);
    }
  };

  // Map period â†’ overview sub-object
  const periodData = overview
    ? ({
        today:   overview.today,
        "7d":    overview.week,
        "30d":   overview.month,
        allTime: overview.allTime,
      } as Record<PeriodKey, typeof overview.today>)[period]
    : null;

  const loadData = useCallback(async () => {
    try {
      const tsdays = CHART_DAYS[chartPeriod];
      const tsperiod = tsdays <= 1 ? "hourly" : "daily";
      const [ov, ts, ms, lg] = await Promise.all([
        stats.overview(),
        stats.timeseries(tsperiod, tsdays),
        stats.byModel(modelChartDays),
        logs.list({ limit: "20" }),
      ]);
      setOverview(ov);
      setTimeseries(ts);
      setModelStats(ms);
      setRecentLogs(lg.data);
    } catch {}
  }, [chartPeriod, modelChartDays]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSSEMessage = useCallback((data: any) => {
    setRecentLogs((prev) => [data, ...prev].slice(0, 20));
    void loadData();
  }, [loadData]);
  useRealtimeSSE(handleSSEMessage, 800);

  // Re-fetch timeseries on chart period change
  useEffect(() => {
    const tsdays = CHART_DAYS[chartPeriod];
    const tsperiod = tsdays <= 1 ? "hourly" : "daily";
    stats.timeseries(tsperiod, tsdays).then(setTimeseries).catch(() => {});
  }, [chartPeriod]);

  // Re-fetch model data on model chart period change
  useEffect(() => {
    stats.byModel(modelChartDays).then(setModelStats).catch(() => {});
  }, [modelChartDays]);

  // â”€â”€ Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleExport = () => {
    const activePeriodLabel = PERIOD_OPTS.find(o => o.key === period)?.label || "All Time";
    const dateStr = new Date().toISOString().split("T")[0];
    const sheets = [];

    // Sheet 1: Summary stats across all periods
    if (overview) {
      sheets.push({
        name: "Summary",
        note: "Aggregated stats across all API keys and devices",
        headers: ["Metric", "Today", "Last 7 Days", "Last 30 Days", "All Time"],
        rows: [
          ["Requests",          overview.today.requests,                                 overview.week?.requests ?? "",              overview.month?.requests ?? "",              overview.allTime.requests],
          ["Total Tokens",      overview.today.tokens,                                   overview.week?.tokens ?? "",                overview.month?.tokens ?? "",                overview.allTime.tokens],
          ["Input Tokens",      overview.today.promptTokens ?? "",                       overview.week?.promptTokens ?? "",          overview.month?.promptTokens ?? "",          overview.allTime.promptTokens ?? ""],
          ["Output Tokens",     overview.today.completionTokens ?? "",                   overview.week?.completionTokens ?? "",      overview.month?.completionTokens ?? "",      overview.allTime.completionTokens ?? ""],
          ["Unique Devices",    overview.today.uniqueDevices ?? "",                      "",                                        "",                                          overview.totalDevices],
          ["Active Keys",       overview.activeKeys,                                     "",                                        "",                                          overview.totalKeys],
          ["Total Sessions",    "",                                                      "",                                        "",                                          overview.allTime.totalSessions ?? ""],
          ["Avg Reqs/Session",  "",                                                      "",                                        "",                                          (overview.allTime.avgRequestsPerSession || 0).toFixed(2)],
          ["Est. Cost",         fmtCost(overview.today.totalCost ?? overview.today.estimatedCost), fmtCost(overview.week?.totalCost ?? overview.week?.estimatedCost), fmtCost(overview.month?.totalCost ?? overview.month?.estimatedCost), fmtCost(overview.allTime.totalCost ?? overview.allTime.estimatedCost)],
        ],
      });
    }

    // Sheet 2: Timeseries
    if (timeseries.length) {
      sheets.push({
        name: "Timeseries",
        note: "Daily/hourly data  -  select columns and Insert â†’ Chart in Excel to visualize",
        headers: ["Period", "Requests", "Total Tokens", "Input Tokens", "Output Tokens", "Est. Cost", "Unique Devices"],
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

  // â”€â”€ Period Toggle component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const PeriodToggle = ({
    value, onChange, small = false
  }: { value: PeriodKey | number; onChange: (v: any) => void; small?: boolean; options?: any[] }) => null;

  // â”€â”€ Stat Cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const dynamicCards = periodData
    ? [
        {
          label: `Requests (${PERIOD_OPTS.find(o => o.key === period)?.label})`,
          value: formatNumber(periodData.requests),
          icon: Activity,
          sub: period === "allTime"
            ? `${overview?.allTime.totalSessions || 0} sessions total`
            : `${formatNumber(overview?.allTime.requests || 0)} all time`,
          color: "text-blue-400",
        },
        {
          label: `Total Tokens (${PERIOD_OPTS.find(o => o.key === period)?.label})`,
          value: formatNumber(periodData.tokens),
          icon: Coins,
          sub: `${formatNumber(overview?.allTime.tokens || 0)} all time`,
          color: "text-emerald-400",
        },
        {
          label: `Input Tokens (${PERIOD_OPTS.find(o => o.key === period)?.label})`,
          value: formatNumber(periodData.promptTokens || 0),
          icon: Coins,
          sub: `Cost: ${formatCost(periodData.promptCost || 0)}`,
          color: "text-cyan-400",
        },
        {
          label: `Output Tokens (${PERIOD_OPTS.find(o => o.key === period)?.label})`,
          value: formatNumber(periodData.completionTokens || 0),
          icon: Coins,
          sub: `Cost: ${formatCost(periodData.completionCost || 0)}`,
          color: "text-orange-400",
        },
        {
          label: `Est. Cost (${PERIOD_OPTS.find(o => o.key === period)?.label})`,
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
          sub: `Avg ${(overview.allTime.avgRequestsPerSession || 0).toFixed(2)} req/session`,
          color: "text-pink-400",
        },
      ]
    : [];

  const allCards = [...dynamicCards, ...staticCards];

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground mt-1">Monitor your AI API proxy usage in real-time</p>
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
        <div className="flex gap-1">
          {PERIOD_OPTS.map((o) => (
            <button
              key={o.key}
              onClick={() => setPeriod(o.key)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors font-medium ${
                period === o.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
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
                    <p className="font-semibold">Token Limits:</p>
                    <p>Harian: {formatNumber(searchUserResult.dailyTokensUsed || 0)} / {searchUserResult.dailyTokenLimit > 0 ? formatNumber(searchUserResult.dailyTokenLimit) : 'Unlimited'}</p>
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {allCards.map((card) => (
          <Card key={card.label} className="border-border/50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground leading-tight">{card.label}</p>
                <card.icon className={`h-4 w-4 shrink-0 ${card.color}`} />
              </div>
              <p className="text-2xl font-bold mt-2 truncate">{card.value}</p>
              <p className="text-xs text-muted-foreground mt-1 truncate">{card.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Requests Over Time */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Requests Over Time</CardTitle>
              <div className="flex gap-1">
                {PERIOD_OPTS.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => setChartPeriod(o.key)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      chartPeriod === o.key
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {o.label === "All Time" ? "All" : o.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeseries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) =>
                      v?.includes(" ") ? v.split(" ")[1] : v?.split("-").slice(1).join("/")
                    }
                  />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={LABEL_STYLE} />
                  <Line type="monotone" dataKey="requests" stroke="#818cf8" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
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
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
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
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Requests */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium">Recent Requests</CardTitle>
            <Badge variant="secondary" className="gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Time</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">API Key</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Model</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">IDE</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Tokens</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Latency</th>
                  <th className="text-center py-2 px-3 text-muted-foreground font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log, i) => (
                  <tr key={log.id || i} className="border-b border-border/30 hover:bg-accent/30 transition-colors">
                    <td className="py-2 px-3 text-xs text-muted-foreground font-mono">
                      {log.createdAt ? formatRelativeTime(log.createdAt) : "just now"}
                    </td>
                    <td className="py-2 px-3">{log.apiKeyName || " - "}</td>
                    <td className="py-2 px-3">
                      <code className="text-xs bg-accent/50 px-1.5 py-0.5 rounded">{log.model || " - "}</code>
                    </td>
                    <td className="py-2 px-3 text-xs">{log.ideDetected || " - "}</td>
                    <td className="py-2 px-3 text-right font-mono text-xs">
                      {formatNumber(log.totalTokens || 0)}
                    </td>
                    <td className="py-2 px-3 text-right text-xs text-muted-foreground">
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
                      No requests yet. Send a request through the proxy to see it here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

