import { useEffect, useState, useCallback } from "react";
import { stats } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, formatCost } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useRealtimeSSE } from "@/lib/use-realtime-sse";
import { exportCsvMultiSection } from "@/lib/export-csv";

const COLORS = ["#818cf8", "#34d399", "#f59e0b", "#f87171", "#a78bfa", "#38bdf8", "#fb923c", "#e879f9"];

const PERIOD_OPTIONS = [
  { label: "1 Day",   days: 1  },
  { label: "7 Days",  days: 7  },
  { label: "30 Days", days: 30 },
  { label: "All",     days: 0  },
] as const;

// Fix tooltip colours — must override itemStyle/labelStyle too
const TOOLTIP_STYLE  = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
  color: "hsl(var(--foreground))",
};
const ITEM_STYLE  = { color: "hsl(var(--foreground))" };
const LABEL_STYLE = { color: "hsl(var(--foreground))" };

function PeriodToggle({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <div className="flex gap-1">
      {PERIOD_OPTIONS.map((o) => (
        <button
          key={o.days}
          onClick={() => onChange(o.days)}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            value === o.days ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function periodLabel(days: number): string {
  if (days === 0) return "All Time";
  if (days === 1) return "Last 1 Day";
  return `Last ${days} Days`;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(7);
  const [modelData,     setModelData]     = useState<any[]>([]);
  const [keyData,       setKeyData]       = useState<any[]>([]);
  const [deviceData,    setDeviceData]    = useState<any[]>([]);
  const [timeseriesData,setTimeseriesData]= useState<any[]>([]);
  const [hourlyData,    setHourlyData]    = useState<any[]>([]);
  const [topUsersData,  setTopUsersData]  = useState<{ byRequests: any[]; byTokens: any[] }>({ byRequests: [], byTokens: [] });

  // Pie chart mode toggle
  const [modelChartMode, setModelChartMode] = useState<"tokens" | "requests">("tokens");

  const loadData = useCallback(async (d = days) => {
    try {
      const tsdays = d === 0 ? 30 : d;
      const hrdays = d === 1 ? 1 : 2;
      const [models, byKey, byDevice, daily, hourly, topUsers] = await Promise.all([
        stats.byModel(d),
        stats.byKey(d),
        stats.byDevice(d),
        stats.timeseries("daily", tsdays),
        stats.timeseries("hourly", hrdays),
        stats.topUsers(d),
      ]);
      setModelData(models);
      setKeyData(byKey);
      setDeviceData(byDevice);
      setTimeseriesData(daily);
      setHourlyData(hourly);
      setTopUsersData(topUsers);
    } catch {}
  }, [days]);

  useEffect(() => { loadData(days); }, [days]);

  const handleSSEMessage = useCallback(() => { void loadData(days); }, [days, loadData]);
  useRealtimeSSE(handleSSEMessage, 900);

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = () => {
    const pl = periodLabel(days);
    const sections = [];
    if (modelData.length) {
      sections.push({
        title: "Models by Usage",
        headers: ["Model", "Requests", "Total Tokens", "Input Tokens", "Output Tokens", "Est. Cost ($)", "Avg Latency (ms)"],
        rows: modelData.map(m => [m.model, m.requests, m.tokens, m.promptTokens, m.completionTokens, formatCost(m.estimatedCost), m.avgLatency]),
        notes: `Period: ${pl}`,
      });
    }
    if (topUsersData.byRequests.length) {
      sections.push({
        title: "Top Users by Requests",
        headers: ["Display Name", "Key Name", "Discord ID", "Requests", "Total Tokens", "Input Tokens", "Output Tokens", "Est. Cost ($)"],
        rows: topUsersData.byRequests.map(u => [u.displayName, u.keyName, u.discordUserId || "", u.requests, u.tokens, u.promptTokens, u.completionTokens, formatCost(u.estimatedCost)]),
        notes: `Period: ${pl}`,
      });
    }
    if (topUsersData.byTokens.length) {
      sections.push({
        title: "Top Users by Tokens",
        headers: ["Display Name", "Key Name", "Discord ID", "Total Tokens", "Input Tokens", "Output Tokens", "Requests", "Est. Cost ($)"],
        rows: topUsersData.byTokens.map(u => [u.displayName, u.keyName, u.discordUserId || "", u.tokens, u.promptTokens, u.completionTokens, u.requests, formatCost(u.estimatedCost)]),
        notes: `Period: ${pl}`,
      });
    }
    if (keyData.length) {
      sections.push({
        title: "API Keys by Usage",
        headers: ["Key Name", "Requests", "Tokens", "Input Tokens", "Output Tokens", "Est. Cost ($)", "Unique Devices", "Top Model"],
        rows: keyData.map(k => [k.name, k.requests, k.tokens, k.promptTokens || "", k.completionTokens || "", formatCost(k.estimatedCost), k.uniqueDevices, k.topModel]),
        notes: `Period: ${pl}`,
      });
    }
    if (deviceData.length) {
      sections.push({
        title: "Top Devices by Usage",
        headers: ["Fingerprint", "IP Address", "IDE", "Requests", "Total Tokens", "Input Tokens", "Output Tokens", "Est. Cost ($)", "Last Seen"],
        rows: deviceData.map(d => [d.fingerprint, d.ipAddress, d.ide, d.requests, d.tokens, d.promptTokens || "", d.completionTokens || "", formatCost(d.estimatedCost), d.lastSeen]),
        notes: `Period: ${pl}`,
      });
    }
    if (timeseriesData.length) {
      sections.push({
        title: "Daily Timeseries",
        headers: ["Date", "Requests", "Total Tokens", "Input Tokens", "Output Tokens", "Est. Cost ($)", "Unique Devices"],
        rows: timeseriesData.map(t => [t.period, t.requests, t.tokens, t.promptTokens, t.completionTokens, formatCost(t.estimatedCost), t.uniqueDevices]),
        notes: "Each row represents one day.",
      });
    }
    if (hourlyData.length) {
      sections.push({
        title: "Hourly Timeseries",
        headers: ["Hour", "Requests", "Tokens"],
        rows: hourlyData.map(t => [t.period, t.requests, t.tokens]),
      });
    }
    exportCsvMultiSection(sections, `analytics-export-${new Date().toISOString().split("T")[0]}.csv`, pl);
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
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-1">Deep insights into your proxy usage patterns</p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodToggle value={days} onChange={setDays} />
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Row 1: Models pie + IDE bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Models Pie — with By Tokens / By Requests toggle */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Top Models by Usage</CardTitle>
              <div className="flex gap-1">
                {(["tokens", "requests"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setModelChartMode(m)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      modelChartMode === m ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    By {m === "tokens" ? "Tokens" : "Requests"}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {modelData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={modelData.slice(0, 8)}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
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
                </ResponsiveContainer>
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
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ideChartData.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={90} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={LABEL_STYLE} />
                    <Bar dataKey="value" fill="#34d399" radius={[0, 4, 4, 0]} name="Requests" />
                  </BarChart>
                </ResponsiveContainer>
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
          <CardTitle className="text-base font-medium">API Keys by Token Consumption</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            {keyData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={keyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={LABEL_STYLE} formatter={(value: number) => formatNumber(value)} />
                  <Bar dataKey="tokens"   fill="#a78bfa" radius={[4, 4, 0, 0]} name="Tokens" />
                  <Bar dataKey="requests" fill="#818cf8" radius={[4, 4, 0, 0]} name="Requests" />
                </BarChart>
              </ResponsiveContainer>
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
            <CardTitle className="text-base font-medium">Top Users by Requests</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium text-xs">#</th>
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium text-xs">User</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Requests</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Tokens</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Cost</th>
                </tr>
              </thead>
              <tbody>
                {topUsersData.byRequests.map((u, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-accent/30">
                    <td className="py-2 px-4 text-xs text-muted-foreground font-bold">{i + 1}</td>
                    <td className="py-2 px-4 text-xs">
                      <div className="font-medium truncate max-w-[160px]">{u.displayName}</div>
                      {u.displayName !== u.keyName && <div className="text-[10px] text-muted-foreground truncate max-w-[160px]">{u.keyName}</div>}
                    </td>
                    <td className="py-2 px-4 text-right font-mono text-xs font-semibold">{formatNumber(u.requests)}</td>
                    <td className="py-2 px-4 text-right font-mono text-xs">{formatNumber(u.tokens)}</td>
                    <td className="py-2 px-4 text-right font-mono text-xs text-emerald-400">{formatCost(u.estimatedCost)}</td>
                  </tr>
                ))}
                {topUsersData.byRequests.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-6 text-muted-foreground text-xs">No data yet.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Top Users by Tokens</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium text-xs">#</th>
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium text-xs">User</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Tokens</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Requests</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Cost</th>
                </tr>
              </thead>
              <tbody>
                {topUsersData.byTokens.map((u, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-accent/30">
                    <td className="py-2 px-4 text-xs text-muted-foreground font-bold">{i + 1}</td>
                    <td className="py-2 px-4 text-xs">
                      <div className="font-medium truncate max-w-[160px]">{u.displayName}</div>
                      {u.displayName !== u.keyName && <div className="text-[10px] text-muted-foreground truncate max-w-[160px]">{u.keyName}</div>}
                    </td>
                    <td className="py-2 px-4 text-right font-mono text-xs font-semibold">{formatNumber(u.tokens)}</td>
                    <td className="py-2 px-4 text-right font-mono text-xs">{formatNumber(u.requests)}</td>
                    <td className="py-2 px-4 text-right font-mono text-xs text-emerald-400">{formatCost(u.estimatedCost)}</td>
                  </tr>
                ))}
                {topUsersData.byTokens.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-6 text-muted-foreground text-xs">No data yet.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Hourly + Device Growth */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">
              Requests by Hour ({days === 1 ? "Last 24h" : "Last 48h"})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              {hourlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="period" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v?.split(" ")[1] || v} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={LABEL_STYLE} />
                    <Bar dataKey="requests" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">No hourly data yet</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Unique Devices Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              {timeseriesData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeseriesData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v?.split("-").slice(1).join("/")} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={LABEL_STYLE} />
                    <Line type="monotone" dataKey="uniqueDevices" stroke="#38bdf8" strokeWidth={2} dot={false} name="Unique Devices" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">No device data yet</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Devices Table */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Top Devices by Usage</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">Fingerprint</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">IP</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">IDE</th>
                <th className="text-right py-3 px-4 text-muted-foreground font-medium">Requests</th>
                <th className="text-right py-3 px-4 text-muted-foreground font-medium">Tokens</th>
                <th className="text-right py-3 px-4 text-muted-foreground font-medium">Cost</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {deviceData.slice(0, 20).map((d, i) => (
                <tr key={i} className="border-b border-border/30 hover:bg-accent/30">
                  <td className="py-2 px-4"><code className="text-xs font-mono">{d.fingerprint?.substring(0, 16)}...</code></td>
                  <td className="py-2 px-4 text-xs font-mono">{d.ipAddress || "—"}</td>
                  <td className="py-2 px-4 text-xs">{d.ide || "—"}</td>
                  <td className="py-2 px-4 text-right font-mono">{formatNumber(d.requests)}</td>
                  <td className="py-2 px-4 text-right font-mono">{formatNumber(d.tokens)}</td>
                  <td className="py-2 px-4 text-right font-mono text-emerald-400/90">{formatCost(d.estimatedCost || 0)}</td>
                  <td className="py-2 px-4 text-xs text-muted-foreground">{d.lastSeen || "—"}</td>
                </tr>
              ))}
              {deviceData.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No device data yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
