/**
 * ModelHistoryChart — the one history chart used by both dashboards.
 *
 * Shared on purpose: the admin monitor and the user portal must never draw
 * different shapes for the same model. Data comes from
 * `/api/internal/models/:model/history` (admin) or
 * `/api/portal/models/:model/history` (portal); both return the same payload.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, CheckCircle2, Clock, Gauge, TrendingUp } from "lucide-react";

export const HISTORY_RANGES = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "60d", label: "60 days" },
  { key: "all", label: "All time" },
] as const;

export type HistoryRangeKey = (typeof HISTORY_RANGES)[number]["key"];

export interface HistoryPoint {
  t: string;
  req: number;
  ok: number;
  fail: number;
  p50: number | null;
  p95: number | null;
  tps: number | null;
  inTok: number;
  outTok: number;
  cachedTok: number;
}

export interface ModelHistory {
  model: string;
  range: HistoryRangeKey;
  days: number | null;
  bucket: "day" | "week";
  points: HistoryPoint[];
  totals: {
    req: number;
    ok: number;
    fail: number;
    successRate: number | null;
    p50: number | null;
    p95: number | null;
    tps: number | null;
    inTok: number;
    outTok: number;
    cachedTok: number;
    activeDays: number;
  };
  firstSeen: string | null;
  lastSeen: string | null;
}

function fmtMs(v: number | null): string {
  if (v == null || v <= 0) return "—";
  return v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`;
}

function fmtNum(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

function shortDate(iso: string, bucket: "day" | "week"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const base = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return bucket === "week" ? `w/${base}` : base;
}

export interface ModelHistoryChartProps {
  /** Returns the history payload. Provided by each surface so it can hit its own auth path. */
  load: (range: HistoryRangeKey) => Promise<ModelHistory>;
  /** Controlled range; when omitted the component owns it. */
  range?: HistoryRangeKey;
  onRangeChange?: (r: HistoryRangeKey) => void;
  /** Compact mode hides the stat strip (used inside dense list rows). */
  compact?: boolean;
  className?: string;
}

export function ModelHistoryChart({
  load,
  range: rangeProp,
  onRangeChange,
  compact = false,
  className = "",
}: ModelHistoryChartProps) {
  const [ownRange, setOwnRange] = useState<HistoryRangeKey>("7d");
  const range = rangeProp ?? ownRange;
  const setRange = (r: HistoryRangeKey) => {
    if (onRangeChange) onRangeChange(r);
    if (rangeProp == null) setOwnRange(r);
  };

  const [data, setData] = useState<ModelHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    load(range)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `load` is intentionally not a dependency: callers inline it, so a new
    // identity every render would loop forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const chartData = useMemo(() => {
    if (!data) return [];
    const bucket = data.bucket;
    return data.points.map((p) => ({
      ...p,
      label: shortDate(p.t, bucket),
    }));
  }, [data]);

  const totals = data?.totals;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Range selector — same four options on every surface. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {HISTORY_RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
              range === r.key
                ? "bg-primary/15 text-primary border-primary/40"
                : "bg-background text-muted-foreground border-border/60 hover:text-foreground"
            }`}
          >
            {r.label}
          </button>
        ))}
        {data && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {data.points.length} {data.bucket === "week" ? "weeks" : "days"} ·{" "}
            {totals?.activeDays ?? 0} active
          </span>
        )}
      </div>

      {loading && (
        <div className="text-[11px] text-muted-foreground py-6 text-center">Loading history…</div>
      )}
      {error && !loading && (
        <div className="text-[11px] text-red-400 py-3">{error}</div>
      )}
      {!loading && !error && data && data.points.length === 0 && (
        <div className="text-[11px] text-muted-foreground py-6 text-center">
          No traffic recorded for this model in this range.
        </div>
      )}

      {!loading && !error && chartData.length > 0 && (
        <>
          {/* Requests: ok vs fail stacked, so an outage day is visible at a glance. */}
          <div>
            <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
              <Activity className="w-3 h-3" /> Requests
            </div>
            <ResponsiveContainer width="100%" height={compact ? 95 : 130}>
              <BarChart data={chartData} margin={{ top: 2, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9 }}
                  stroke="hsl(var(--muted-foreground))"
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 9 }}
                  stroke="hsl(var(--muted-foreground))"
                  width={52}
                  tickCount={compact ? 3 : 5}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  formatter={(v: any, n: any) => [v, n === "ok" ? "success" : "failed"]}
                />
                <Bar dataKey="ok" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
                <Bar dataKey="fail" stackId="a" fill="#ef4444" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Latency p50 — the number users feel. */}
          <div>
            <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Latency p50
            </div>
            <ResponsiveContainer width="100%" height={compact ? 80 : 110}>
              <AreaChart data={chartData} margin={{ top: 2, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="histP50" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9 }}
                  stroke="hsl(var(--muted-foreground))"
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 9 }}
                  stroke="hsl(var(--muted-foreground))"
                  width={52}
                  tickCount={compact ? 3 : 5}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  formatter={(v: any) => [fmtMs(Number(v)), "p50"]}
                />
                <Area type="monotone" dataKey="p50" stroke="#3b82f6" fill="url(#histP50)" strokeWidth={1.5} connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Throughput, only when there is something to show. */}
          {chartData.some((p) => p.tps != null) && (
            <div>
              <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                <Gauge className="w-3 h-3" /> Throughput (tok/s)
              </div>
              <ResponsiveContainer width="100%" height={compact ? 75 : 95}>
                <AreaChart data={chartData} margin={{ top: 2, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="histTps" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a855f7" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#a855f7" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9 }}
                    stroke="hsl(var(--muted-foreground))"
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 9 }}
                    stroke="hsl(var(--muted-foreground))"
                    width={52}
                    tickCount={compact ? 3 : 5}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                    formatter={(v: any) => [`${v} tok/s`, "throughput"]}
                  />
                  <Area type="monotone" dataKey="tps" stroke="#a855f7" fill="url(#histTps)" strokeWidth={1.5} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {!compact && totals && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <Stat icon={Activity} label="Requests" value={fmtNum(totals.req)} />
              <Stat
                icon={CheckCircle2}
                label="Success"
                value={totals.successRate != null ? `${totals.successRate}%` : "—"}
                tone={
                  totals.successRate == null
                    ? ""
                    : totals.successRate >= 99
                      ? "text-green-400"
                      : totals.successRate >= 95
                        ? "text-amber-400"
                        : "text-red-400"
                }
              />
              <Stat icon={Clock} label="p50 / p95" value={`${fmtMs(totals.p50)} / ${fmtMs(totals.p95)}`} />
              <Stat
                icon={TrendingUp}
                label="Tokens in / out"
                value={`${fmtNum(totals.inTok)} / ${fmtNum(totals.outTok)}`}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = "",
}: {
  icon: any;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-start gap-1.5 rounded border border-border/40 bg-background/30 px-2 py-1.5">
      <Icon className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`font-mono tabular-nums text-[11px] truncate ${tone || "text-foreground"}`}>
          {value}
        </div>
      </div>
    </div>
  );
}
