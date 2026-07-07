import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Activity, MessageSquare, Download, DollarSign, Users, Wrench, Zap } from "lucide-react";
import { PeriodSelector, type PeriodKey } from "@/components/PeriodSelector";
import { api } from "@/lib/api";
import { formatNumber, formatCost } from "@/lib/utils";

interface OverviewStats {
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  sessions: number;
  toolCalls: number;
  cost: { prompt: number; completion: number; total: number };
}

interface TimeseriesItem {
  period: string;
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
}

interface ModelUsage {
  model: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  tokens: number;
}

interface IdeUsage {
  ide: string;
  requests: number;
  devices: number;
}

const statCards = [
  { key: "requests", label: "Requests", icon: Activity, format: formatNumber },
  { key: "promptTokens", label: "Input Tokens", icon: MessageSquare, format: formatNumber },
  { key: "completionTokens", label: "Output Tokens", icon: Download, format: formatNumber },
  { key: "cost.total", label: "Est. Cost", icon: DollarSign, format: formatCost },
  { key: "sessions", label: "Sessions", icon: Users, format: formatNumber },
  { key: "toolCalls", label: "Tool Calls", icon: Wrench, format: formatNumber },
] as const;

const CHART_COLORS = {
  primary: "#14b8a6", // teal-500
  primaryOpacity: "rgba(20, 184, 166, 0.1)",
  secondary: "#475569", // slate-600
  grid: "hsl(208, 12%, 15%)",
  text: "hsl(210, 14%, 60%)",
};

export default function OverviewPage() {
  const [period, setPeriod] = useState<PeriodKey>("7d");
  const [stats, setStats] = useState<any>(null);
  const [timeseries, setTimeseries] = useState<any[]>([]);
  const [modelUsage, setModelUsage] = useState<any[]>([]);
  const [ideUsage, setIdeUsage] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");

    Promise.all([
      api.stats.overview(period),
      api.stats.timeseries(period),
      api.stats.byModel(period),
      api.stats.byIde(period),
    ] as [Promise<any>, Promise<any[]>, Promise<any[]>, Promise<any[]>])
      .then(([statsRes, tsRes, modelRes, ideRes]) => {
        setStats(statsRes);
        setTimeseries(tsRes as TimeseriesItem[]);
        setModelUsage((modelRes as ModelUsage[]).slice(0, 8) as ModelUsage[]);
        setIdeUsage(ideRes as IdeUsage[]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load data"))
      .finally(() => setLoading(false));
  }, [period]);

  const renderStatCards = () => {
    if (!stats) return null;

    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {statCards.map(({ key, label, icon: Icon, format }) => (
          <div key={key} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <p className="text-xl font-semibold text-foreground">
              {key === "cost.total"
                ? format(stats.cost.total)
                : format(stats[key as keyof OverviewStats] as number)}
            </p>
          </div>
        ))}
      </div>
    );
  };

  const renderTimeseriesChart = () => {
    if (!timeseries.length) return null;

    const data = timeseries.map((item) => ({
      ...item,
      date: item.period.slice(5), // MM-DD
    }));

    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">Requests Over Time</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
              <XAxis
                dataKey="date"
                stroke={CHART_COLORS.text}
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                stroke={CHART_COLORS.text}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => formatNumber(v)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(208, 14%, 9%)",
                  border: "1px solid hsl(208, 12%, 15%)",
                  borderRadius: "0.5rem",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "hsl(210, 14%, 94%)" }}
              />
              <Line
                type="monotone"
                dataKey="requests"
                stroke={CHART_COLORS.primary}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: CHART_COLORS.primary }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  const renderModelChart = () => {
    if (!modelUsage.length) return null;

    const data = modelUsage.map((item) => ({
      name: item.model.length > 15 ? item.model.slice(0, 15) + "..." : item.model,
      fullName: item.model,
      tokens: item.tokens,
    }));

    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">Token Usage by Model</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} horizontal={false} />
              <XAxis
                type="number"
                stroke={CHART_COLORS.text}
                fontSize={11}
                tickLine={false}
                tickFormatter={(v) => formatNumber(v)}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke={CHART_COLORS.text}
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={100}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(208, 14%, 9%)",
                  border: "1px solid hsl(208, 12%, 15%)",
                  borderRadius: "0.5rem",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "hsl(210, 14%, 94%)" }}
                formatter={(value: number, _name: string, props: { payload?: { fullName: string } }) => [
                  formatNumber(value),
                  props.payload?.fullName || "",
                ]}
              />
              <Bar dataKey="tokens" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  const renderIdeBreakdown = () => {
    if (!ideUsage.length) return null;

    const totalRequests = ideUsage.reduce((sum, item) => sum + item.requests, 0);

    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">IDE Breakdown</h3>
        <div className="space-y-3">
          {ideUsage.map((item) => (
            <div key={item.ide} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-3 h-3 text-primary" />
                <span className="text-sm text-foreground">{item.ide}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">{formatNumber(item.requests)}</span>
                <span className="text-xs font-medium text-primary w-10 text-right">
                  {totalRequests > 0 ? ((item.requests / totalRequests) * 100).toFixed(0) : 0}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Overview</h1>
          <p className="text-sm text-muted-foreground">Your usage at a glance</p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Loading skeleton */}
      {loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
                <div className="h-4 w-16 bg-muted rounded mb-2" />
                <div className="h-6 w-20 bg-muted rounded" />
              </div>
            ))}
          </div>
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-xl p-4 h-[280px] animate-pulse" />
            <div className="bg-card border border-border rounded-xl p-4 h-[280px] animate-pulse" />
          </div>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          {renderStatCards()}

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-6">
            {renderTimeseriesChart()}
            {renderModelChart()}
          </div>

          {/* IDE breakdown */}
          {renderIdeBreakdown()}
        </>
      )}
    </div>
  );
}
