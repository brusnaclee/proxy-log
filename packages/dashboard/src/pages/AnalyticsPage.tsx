import { useEffect, useState, useCallback, useRef } from "react";
import { stats } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatCost, formatChartPeriod } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, 
} from "recharts";
import { ChartBox } from "@/components/ChartBox";
import { useRealtimeSSE } from "@/lib/use-realtime-sse";
import { exportXlsx, buildModelsSection, fmtCost } from "@/lib/export-xlsx";
import { PeriodSelector, type PeriodKey } from "@/components/PeriodSelector";

const COLORS = ["#818cf8", "#34d399", "#f59e0b", "#f87171", "#a78bfa", "#38bdf8", "#fb923c", "#e879f9"];

// Fix tooltip colours  -  must override itemStyle/labelStyle too
const TOOLTIP_STYLE  = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
  color: "hsl(var(--foreground))",
};
const ITEM_STYLE  = { color: "hsl(var(--foreground))" };
const LABEL_STYLE = { color: "hsl(var(--foreground))" };

function daysFromPeriod(p: PeriodKey): number {
  if (p === "allTime") return 0;
  if (p === "today") return 1;
  if (p === "3d") return 3;
  if (p === "7d") return 7;
  if (p === "30d") return 30;
  return 7; // thisMonth/lastMonth fallback
}

function periodKeyToLabel(p: PeriodKey): string {
  const labels: Record<PeriodKey, string> = {
    today: "Today", "3d": "Last 3 Days", "7d": "Last 7 Days", "30d": "Last 30 Days",
    thisMonth: "This Month", lastMonth: "Last Month", allTime: "All Time",
  };
  return labels[p];
}

export default function AnalyticsPage() {
  const [periodKey, setPeriodKey] = useState<PeriodKey>("7d");
  const [modelData,     setModelData]     = useState<any[]>([]);
  const [keyData,       setKeyData]       = useState<any[]>([]);
  const [deviceData,    setDeviceData]    = useState<any[]>([]);
  const [timeseriesData,setTimeseriesData]= useState<any[]>([]);
  const [trafficData,   setTrafficData]   = useState<any[]>([]);
  const [topUsersData,  setTopUsersData]  = useState<{ byRequests: any[]; byTokens: any[] }>({ byRequests: [], byTokens: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasDataRef = useRef(false);

  // Pie chart mode toggle
  const [modelChartMode, setModelChartMode] = useState<"tokens" | "requests">("tokens");
  // Traffic chart: prompts vs API calls (local — no refetch)
  const [trafficMetric, setTrafficMetric] = useState<"prompts" | "apiCalls">("prompts");

  const trafficIsHourly = periodKey === "today" || periodKey === "3d";

  const loadData = useCallback(async (_opts?: { soft?: boolean }) => {
    if (!hasDataRef.current) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [models, byKey, byDevice, daily, traffic, topUsers] = await Promise.all([
        stats.byModel(0, undefined, periodKey),
        stats.byKey(0, periodKey),
        stats.byDevice(0, periodKey),
        stats.timeseries("daily", daysFromPeriod(periodKey) || 30, undefined, periodKey === "today" || periodKey === "3d" ? "7d" : periodKey),
        stats.timeseries(
          trafficIsHourly ? "hourly" : "daily",
          daysFromPeriod(periodKey) || 7,
          undefined,
          periodKey,
        ),
        stats.topUsers(0, periodKey),
      ]);
      setModelData(models);
      setKeyData(byKey);
      setDeviceData(byDevice);
      setTimeseriesData(daily);
      setTrafficData(traffic);
      setTopUsersData(topUsers || { byRequests: [], byTokens: [] });
      hasDataRef.current = true;
    } catch (e: any) {
      setError(e?.message || "Failed to load analytics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [periodKey, trafficIsHourly]);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleSSEMessage = useCallback(() => { void loadData({ soft: true }); }, [loadData]);
  useRealtimeSSE(handleSSEMessage, 900);

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = () => {
    const pl = periodKeyToLabel(periodKey);
    const dateStr = new Date().toISOString().split("T")[0];
    const sheets = [];

    if (modelData.length) sheets.push(buildModelsSection(modelData, "Models"));

    if (topUsersData.byRequests.length) {
      sheets.push({
        name: "Top Users (Prompts)",
        note: `Period: ${pl}`,
        headers: ["Display Name", "Key Name", "Discord ID", "Prompts", "Total Tokens", "Input Tokens", "Output Tokens", "Est. Cost"],
        rows: topUsersData.byRequests.map(u => [
          u.displayName, u.keyName, u.discordUserId || "",
          Number(u.requests)||0, Number(u.tokens)||0, Number(u.promptTokens)||0, Number(u.completionTokens)||0,
          fmtCost(u.estimatedCost),
        ]),
      });
    }

    if (topUsersData.byTokens.length) {
      sheets.push({
        name: "Top Users (Tokens)",
        note: `Period: ${pl}`,
        headers: ["Display Name", "Key Name", "Discord ID", "Total Tokens", "Input Tokens", "Output Tokens", "Prompts", "Est. Cost"],
        rows: topUsersData.byTokens.map(u => [
          u.displayName, u.keyName, u.discordUserId || "",
          Number(u.tokens)||0, Number(u.promptTokens)||0, Number(u.completionTokens)||0, Number(u.requests)||0,
          fmtCost(u.estimatedCost),
        ]),
      });
    }

    if (keyData.length) {
      sheets.push({
        name: "API Keys",
        note: `Period: ${pl}`,
        headers: ["Key Name", "Prompts", "Total Tokens", "Input Tokens", "Output Tokens", "Est. Cost", "Unique Devices", "Top Model"],
        rows: keyData.map(k => [
          k.name, Number(k.requests)||0, Number(k.tokens)||0, Number(k.promptTokens)||0, Number(k.completionTokens)||0,
          fmtCost(k.estimatedCost), Number(k.uniqueDevices)||0, k.topModel,
        ]),
      });
    }

    if (deviceData.length) {
      sheets.push({
        name: "Devices",
        note: `Period: ${pl}`,
        headers: ["Fingerprint", "IP Address", "IDE", "Prompts", "Total Tokens", "Input Tokens", "Output Tokens", "Est. Cost", "Last Seen"],
        rows: deviceData.map(d => [
          d.fingerprint, d.ipAddress, d.ide,
          Number(d.requests)||0, Number(d.tokens)||0, Number(d.promptTokens)||0, Number(d.completionTokens)||0,
          fmtCost(d.estimatedCost), d.lastSeen,
        ]),
      });
    }

    if (timeseriesData.length) {
      sheets.push({
        name: "Daily Timeseries",
        note: "Each row = one day  -  select columns and Insert → Chart to visualize",
        headers: ["Date", "Prompts", "Total Tokens", "Input Tokens", "Output Tokens", "Est. Cost", "Unique Devices"],
        rows: timeseriesData.map(t => [
          t.period, Number(t.requests)||0, Number(t.tokens)||0, Number(t.promptTokens)||0, Number(t.completionTokens)||0,
          fmtCost(t.estimatedCost), Number(t.uniqueDevices)||0,
        ]),
      });
    }

    if (trafficData.length) {
      sheets.push({
        name: trafficIsHourly ? "Hourly Timeseries" : "Daily Traffic",
        note: trafficIsHourly ? "Each row = one hour" : "Each row = one day",
        headers: ["Period", "Prompts", "API Calls", "Total Tokens"],
        rows: trafficData.map(t => [
          t.period,
          Number(t.requests)||0,
          Number(t.apiCalls)||0,
          Number(t.tokens)||0,
        ]),
      });
    }

    exportXlsx(sheets, `analytics-${dateStr}`, {
      title: "AI Proxy Gateway - Analytics Report",
      period: pl,
    });
  };

  // IDE distribution from device data
  const ideDistribution: Record<string, number> = {};
  deviceData.forEach((d) => {
    const ide = d.ide || "Unknown";
    ideDistribution[ide] = (ideDistribution[ide] || 0) + d.requests;
  });
  const ideChartData = Object.entries(ideDistribution)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Deep insights into your proxy usage patterns</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <PeriodSelector value={periodKey} onChange={setPeriodKey} />
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" /> Export XLSX
          </Button>
        </div>
      </div>

      {error && !hasDataRef.current && (
        <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-border/50 bg-card">
          <p className="text-red-400 mb-4 text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void loadData()}>Retry</Button>
        </div>
      )}

      {loading && !hasDataRef.current ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-border/50">
              <CardContent className="h-[220px] animate-pulse bg-muted/30 rounded-lg m-4" />
            </Card>
          ))}
        </div>
      ) : hasDataRef.current || modelData.length > 0 || trafficData.length > 0 || topUsersData.byTokens.length > 0 ? (
      <div className={refreshing ? "opacity-70 transition-opacity space-y-6 sm:space-y-8" : "space-y-6 sm:space-y-8"}>

      {/* Row 1: Models pie + IDE bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Top Models Pie  -  with By Tokens / By Requests toggle */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base font-medium">Top Models by Usage</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">Limit credit (same meter as Input/Total)</p>
              </div>
              <div className="flex gap-1 shrink-0">
                {(["tokens", "requests"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setModelChartMode(m)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      modelChartMode === m ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    By {m === "tokens" ? "Tokens" : "Prompts"}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[250px] sm:h-[300px]">
              {modelData.length > 0 ? (
                <ChartBox className="!h-full !min-h-0 lg:!h-full">
                  <PieChart>
                    <Pie
                      data={modelData.slice(0, 8)}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey={modelChartMode}
                      nameKey="model"
                      label={({ model, percent }) =>
                        `${(model || "").split("/").pop()?.substring(0, 12)} (${(percent * 100).toFixed(0)}%)`
                      }
                      labelLine={false}
                    >
                      {modelData.slice(0, 8).map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      itemStyle={ITEM_STYLE}
                      labelStyle={LABEL_STYLE}
                      formatter={(value: number, _: any, props: any) => [
                        formatNumber(value) + (modelChartMode === "tokens" ? " tokens" : " requests"),
                        props.payload?.model,
                      ]}
                    />
                  </PieChart>
                </ChartBox>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">No model data yet</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* IDE Distribution Bar */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Top IDEs by Request Count</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {ideChartData.length > 0 ? (
                <ChartBox className="!h-full !min-h-0 lg:!h-full">
                  <BarChart data={ideChartData.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={90} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={LABEL_STYLE} />
                    <Bar dataKey="value" fill="#34d399" radius={[0, 4, 4, 0]} name="Prompts" />
                  </BarChart>
                </ChartBox>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">No IDE data yet</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: API Keys by Token Consumption */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Users by Token Consumption</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Per API key (hop-weighted tokens)</p>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            {keyData.length > 0 ? (
              <ChartBox className="!h-full !min-h-0 lg:!h-full">
                <BarChart data={keyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={LABEL_STYLE} formatter={(value: number) => formatNumber(value)} />
                  <Bar dataKey="tokens"   fill="#a78bfa" radius={[4, 4, 0, 0]} name="Tokens" />
                  <Bar dataKey="requests" fill="#818cf8" radius={[4, 4, 0, 0]} name="Prompts" />
                </BarChart>
              </ChartBox>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">No data yet</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Row 3: Top Users by Requests | Top Users by Tokens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Top Users by Prompts</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Per Discord account — same as Discord ranking</p>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium text-xs">#</th>
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium text-xs">User</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Prompts</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Tokens</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Cost</th>
                </tr>
              </thead>
              <tbody>
        {topUsersData?.byRequests?.map((u, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-accent/30">
                    <td className="py-2 px-4 text-xs text-muted-foreground font-bold">{i + 1}</td>
                    <td className="py-2 px-4 text-xs">
                      <div className="flex items-center gap-1">
                        <div className="font-medium truncate max-w-[160px]">{u.displayName || u.discordUsername || 'Unknown'}</div>
                        {u.isTrial && (
                          <Badge variant="outline" className="text-[10px] border-purple-500/50 text-purple-400">Trial</Badge>
                        )}
                      </div>
                      {(u.displayName || u.discordUsername) !== u.keyName && <div className="text-[10px] text-muted-foreground truncate max-w-[160px]">{u.keyName || 'Unknown Key'}</div>}
                    </td>
                    <td className="py-2 px-4 text-right font-mono text-xs font-semibold">{formatNumber(u.requests || 0)}</td>
                    <td className="py-2 px-4 text-right font-mono text-xs">{formatNumber(u.tokens || 0)}</td>
                    <td className="py-2 px-4 text-right font-mono text-xs text-emerald-400">{formatCost(u.estimatedCost || 0)}</td>
                  </tr>
                ))}
                {!topUsersData?.byRequests?.length && (
                  <tr><td colSpan={5} className="text-center py-6 text-muted-foreground text-xs">No data yet.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Top Users by Tokens</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Per Discord account — hop-weighted + sibling key merge</p>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium text-xs">#</th>
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium text-xs">User</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Tokens</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Prompts</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Cost</th>
                </tr>
              </thead>
              <tbody>
        {topUsersData?.byTokens?.map((u, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-accent/30">
                    <td className="py-2 px-4 text-xs text-muted-foreground font-bold">{i + 1}</td>
                    <td className="py-2 px-4 text-xs">
                      <div className="flex items-center gap-1">
                        <div className="font-medium truncate max-w-[160px]">{u.displayName || u.discordUsername || 'Unknown'}</div>
                        {u.isTrial && (
                          <Badge variant="outline" className="text-[10px] border-purple-500/50 text-purple-400">Trial</Badge>
                        )}
                      </div>
                      {(u.displayName || u.discordUsername) !== u.keyName && <div className="text-[10px] text-muted-foreground truncate max-w-[160px]">{u.keyName || 'Unknown Key'}</div>}
                    </td>
                    <td className="py-2 px-4 text-right font-mono text-xs font-semibold">{formatNumber(u.tokens || 0)}</td>
                    <td className="py-2 px-4 text-right font-mono text-xs">{formatNumber(u.requests || 0)}</td>
                    <td className="py-2 px-4 text-right font-mono text-xs text-emerald-400">{formatCost(u.estimatedCost || 0)}</td>
                  </tr>
                ))}
                {!topUsersData?.byTokens?.length && (
                  <tr><td colSpan={5} className="text-center py-6 text-muted-foreground text-xs">No data yet.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Traffic + Device Growth */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Card className="border-border/50">
          <CardHeader className="pb-2 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base font-medium">
                {trafficMetric === "prompts" ? "Prompts" : "API Calls"}
                {trafficIsHourly ? " by Hour" : " by Day"}
                {" "}({periodKeyToLabel(periodKey)})
              </CardTitle>
            </div>
            <div className="inline-flex rounded-lg border border-border/60 p-0.5 bg-accent/20">
              {([
                { key: "prompts" as const, label: "Prompts" },
                { key: "apiCalls" as const, label: "API Calls" },
              ]).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setTrafficMetric(opt.key)}
                  className={`px-3 py-1 text-xs rounded-md transition-all duration-200 ${
                    trafficMetric === opt.key
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
            {trafficData.length > 0 ? (
                <ChartBox>
                  <BarChart data={trafficData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="period" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => { const p = formatChartPeriod(v); return p.replace(" WIB", ""); }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={LABEL_STYLE} />
                    <Bar
                      dataKey={trafficMetric === "prompts" ? "requests" : "apiCalls"}
                      name={trafficMetric === "prompts" ? "Prompts" : "API Calls"}
                      fill={trafficMetric === "prompts" ? "#f59e0b" : "#34d399"}
                      radius={[2, 2, 0, 0]}
                    />
                  </BarChart>
                </ChartBox>
              ) : (
                <div className="flex items-center justify-center h-[200px] text-muted-foreground">No traffic data yet</div>
              )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Unique Devices Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {timeseriesData.length > 0 ? (
                <ChartBox>
                  <LineChart data={timeseriesData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={formatChartPeriod} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={LABEL_STYLE} />
                    <Line type="monotone" dataKey="uniqueDevices" stroke="#38bdf8" strokeWidth={2} dot={false} name="Unique Devices" />
                  </LineChart>
                </ChartBox>
              ) : (
                <div className="flex items-center justify-center h-[200px] text-muted-foreground">No device data yet</div>
              )}
          </CardContent>
        </Card>
      </div>

      {/* Top Devices Table */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Top Devices by Usage</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Fingerprint</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium hide-mobile">IP</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">IDE</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium">Prompts</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium">Tokens</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium hide-mobile">Cost</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium hide-mobile">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {deviceData.slice(0, 20).map((d, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-accent/30">
                    <td className="py-2 px-4"><code className="text-xs font-mono">{d.fingerprint?.substring(0, 16)}...</code></td>
                    <td className="py-2 px-4 text-xs font-mono hide-mobile">{d.ipAddress || " - "}</td>
                    <td className="py-2 px-4 text-xs">{d.ide || " - "}</td>
                    <td className="py-2 px-4 text-right font-mono">{formatNumber(d.requests)}</td>
                    <td className="py-2 px-4 text-right font-mono">{formatNumber(d.tokens)}</td>
                    <td className="py-2 px-4 text-right font-mono text-emerald-400/90 hide-mobile">{formatCost(d.estimatedCost || 0)}</td>
                    <td className="py-2 px-4 text-xs text-muted-foreground hide-mobile">{d.lastSeen || " - "}</td>
                  </tr>
                ))}
                {deviceData.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No device data yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </div>
      ) : null}
    </div>
  );
}

