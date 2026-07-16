import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Activity, MessageSquare, Download, DollarSign, Users, Wrench, Zap,
  Copy, Check, ChevronDown, ChevronUp, Bell, AlertTriangle, TrendingUp,
  ExternalLink, Info,
} from "lucide-react";
import { PeriodSelector, type PeriodKey } from "@/components/PeriodSelector";
import { api, type MeResponse, type TopError, type RecapStatus } from "@/lib/api";
import { formatNumber, formatCost } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

const CHART_COLORS = {
  primary: "#14b8a6",
  primaryOpacity: "rgba(20, 184, 166, 0.1)",
  secondary: "#475569",
  grid: "hsl(208, 12%, 15%)",
  text: "hsl(210, 14%, 60%)",
};

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "hsl(208, 14%, 9%)",
    border: "1px solid hsl(208, 12%, 15%)",
    borderRadius: "0.5rem",
    fontSize: "12px",
  },
  labelStyle: { color: "hsl(210, 14%, 94%)" },
};

function ProgressBar({ value, max, label, sublabel }: { value: number; max: number; label: string; sublabel?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const danger = pct > 85;
  const warn = pct > 65;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={danger ? "text-red-400" : warn ? "text-yellow-400" : "text-foreground"}>
          {formatNumber(value)} / {formatNumber(max)}
          {sublabel && <span className="text-muted-foreground ml-1">{sublabel}</span>}
        </span>
      </div>
      <div className="progress-bar-track">
        <div
          className={`progress-bar-fill ${danger ? "bg-red-400" : warn ? "bg-yellow-400" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();
  const handleCopy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors"
      title={t("Copy")}
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      {label && <span>{copied ? t("Copied!") : label}</span>}
    </button>
  );
}

export default function OverviewPage() {
  const { t } = useI18n();
  const [period, setPeriod] = useState<PeriodKey>("7d");

  const [stats, setStats] = useState<any>(null);
  const [timeseries, setTimeseries] = useState<any[]>([]);
  const [modelUsage, setModelUsage] = useState<any[]>([]);
  const [ideUsage, setIdeUsage] = useState<any[]>([]);
  const [topErrors, setTopErrors] = useState<TopError[]>([]);
  const [compare, setCompare] = useState<{ today: any; yesterday: any } | null>(null);
  const [forecast, setForecast] = useState<any>(null);
  const [user, setUser] = useState<MeResponse | null>(null);
  const [recap, setRecap] = useState<RecapStatus | null>(null);
  const [expandedError, setExpandedError] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  const fetchPeriodData = useCallback((p: string) => {
    return Promise.all([
      api.stats.overview(p),
      api.stats.timeseries(p),
      api.stats.byModel(p),
      api.stats.byIde(p),
    ]);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");

    Promise.all([
      fetchPeriodData(period),
      api.me().catch(() => null),
      api.stats.topErrors(period).catch(() => []),
      api.stats.compare().catch(() => null),
      api.stats.forecast().catch(() => null),
      api.recap.status().catch(() => null),
    ])
      .then(([periodData, userData, errorsData, compareData, forecastData, recapData]) => {
        const [statsRes, tsRes, modelRes, ideRes] = periodData as [any, any[], any[], any[]];
        setStats(statsRes);
        setTimeseries(tsRes);
        setModelUsage(modelRes);
        setIdeUsage(ideRes);
        setUser(userData as MeResponse | null);
        setTopErrors(errorsData as TopError[]);
        setCompare(compareData as any);
        setForecast(forecastData as any);
        setRecap(recapData as RecapStatus | null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load data"))
      .finally(() => setLoading(false));
  }, [period, fetchPeriodData]);

  const copySnippet = (key: string, text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedSnippet(key);
    setTimeout(() => setCopiedSnippet(null), 1800);
  };

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const renderAccountBadge = () => {
    if (!user) return null;
    const isPhantom = user.accountType === "phantom";
    return (
      <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${
        isPhantom
          ? "bg-primary/15 text-primary border border-primary/30"
          : "bg-yellow-400/15 text-yellow-400 border border-yellow-400/30"
      }`}>
        {isPhantom ? t("Phantom") : t("Trial")}
      </span>
    );
  };

  const renderTrialCountdown = () => {
    if (!user?.trialExpiresAt) return null;
    const diff = new Date(user.trialExpiresAt).getTime() - Date.now();
    if (diff <= 0) return (
      <div className="p-3 bg-red-400/10 border border-red-400/20 rounded-lg text-sm text-red-400 flex items-center gap-2 animate-fade-in">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        Trial expired
      </div>
    );
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return (
      <div className="p-3 bg-yellow-400/10 border border-yellow-400/20 rounded-lg text-sm text-yellow-400 flex items-center gap-2 animate-fade-in">
        <Info className="w-4 h-4 flex-shrink-0" />
        {t("Trial expires in")}: {days > 0 ? `${days} ${t("days")}` : `${hours} ${t("hours")}`}
      </div>
    );
  };

  const renderNotificationBanner = () => {
    if (!user?.pendingNotifications?.length) return null;
    return (
      <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg text-sm flex items-center gap-2 animate-fade-in">
        <Bell className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="text-foreground">
          {user.pendingNotifications.length} {t("Notifications")}:{" "}
          {user.pendingNotifications[0]?.type?.replace(/_/g, " ")}
          {user.pendingNotifications.length > 1 && ` +${user.pendingNotifications.length - 1} more`}
        </span>
      </div>
    );
  };

  const renderRecapCTA = () => {
    if (!recap) return null;
    if (recap.isOpen && recap.recapUrl) {
      return (
        <a
          href={recap.recapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary text-sm font-medium rounded-lg hover:bg-primary/20 transition-colors animate-fade-in"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {t("View Recap")}
        </a>
      );
    }
    if (!recap.isOpen && recap.openDate) {
      return (
        <span className="text-xs text-muted-foreground">
          {t("Recap opens on")} {new Date(recap.openDate).toLocaleDateString()}
        </span>
      );
    }
    return null;
  };

  const renderLimitsCard = () => {
    if (!user) return null;
    const { limits, usageToday, usageMonth } = user;
    const sourceLabel = (src?: string) => {
      if (src === "override") return t("override");
      if (src === "global") return t("global");
      return "";
    };

    const bars: Array<{ label: string; value: number; max: number; sublabel?: string; source?: string }> = [];
    if (limits.dailyTokenLimit > 0) {
      bars.push({
        label: t("Daily Limit"),
        value: (usageToday.totalTokens ?? usageToday.promptTokens + usageToday.completionTokens),
        max: limits.dailyTokenLimit,
        sublabel: "tokens",
        source: sourceLabel(limits.dailyTokenLimitSource),
      });
    }
    if (limits.dailyInputTokenLimit > 0) {
      bars.push({
        label: t("Input Tokens"),
        value: usageToday.promptTokens,
        max: limits.dailyInputTokenLimit,
        sublabel: "tokens",
        source: sourceLabel(limits.dailyInputTokenLimitSource),
      });
    }
    if (limits.dailyOutputTokenLimit > 0) {
      bars.push({
        label: t("Output Tokens"),
        value: usageToday.completionTokens,
        max: limits.dailyOutputTokenLimit,
        sublabel: "tokens",
        source: sourceLabel(limits.dailyOutputTokenLimitSource),
      });
    }
    if (limits.monthlyTokenLimit > 0) {
      bars.push({
        label: t("Monthly Limit"),
        value: usageMonth?.totalTokens ?? 0,
        max: limits.monthlyTokenLimit,
        sublabel: "tokens",
        source: sourceLabel(limits.monthlyTokenLimitSource),
      });
    }
    if (limits.promptLimit > 0) {
      bars.push({
        label: `${t("Prompt Limit")} (${limits.promptLimitWindow})`,
        value: usageToday.promptCount ?? usageToday.requests,
        max: limits.promptLimit,
        sublabel: "prompts",
        source: sourceLabel(limits.promptLimitSource),
      });
    }

    const hasRate = limits.rateLimit > 0;
    if (!bars.length && !hasRate) return null;

    return (
      <div className="bg-card border border-border rounded-xl p-4 space-y-3 animate-fade-in">
        <h3 className="text-sm font-medium text-foreground">{t("Usage Today")}</h3>
        <div className="space-y-2">
          {bars.map((b) => (
            <div key={b.label}>
              <ProgressBar label={b.label} value={b.value} max={b.max} sublabel={b.sublabel} />
              {b.source && (
                <p className="text-[10px] text-muted-foreground mt-0.5 pl-0.5">
                  {t("Source")}: {b.source}
                </p>
              )}
            </div>
          ))}
          {hasRate && (
            <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
              <span className="text-muted-foreground">{t("Rate Limit")}</span>
              <span className="text-foreground">
                {formatNumber(limits.rateLimit)} / {limits.rateLimitWindow}
                {limits.rateLimitSource && limits.rateLimitSource !== "none" && (
                  <span className="text-muted-foreground ml-1.5">({sourceLabel(limits.rateLimitSource)})</span>
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderCompareStrip = () => {
    if (!compare) return null;
    const { today, yesterday } = compare;
    const pct = (cur: number, prev: number) =>
      prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;

    const DiffBadge = ({ val }: { val: number }) => (
      <span className={`text-xs font-medium ${val > 0 ? "text-green-400" : val < 0 ? "text-red-400" : "text-muted-foreground"}`}>
        {val > 0 ? "+" : ""}{val}%
      </span>
    );

    const cells = [
      { label: t("Requests"), today: today.requests, yesterday: yesterday.requests, format: formatNumber, diff: pct(today.requests, yesterday.requests) },
      { label: t("Input Tokens"), today: today.promptTokens, yesterday: yesterday.promptTokens, format: formatNumber, diff: pct(today.promptTokens, yesterday.promptTokens) },
      { label: t("Output Tokens"), today: today.completionTokens, yesterday: yesterday.completionTokens, format: formatNumber, diff: pct(today.completionTokens, yesterday.completionTokens) },
      { label: t("Est. Cost"), today: today.cost.total, yesterday: yesterday.cost.total, format: formatCost, diff: pct(today.cost.total, yesterday.cost.total) },
    ];

    return (
      <div className="bg-card border border-border rounded-xl p-4 animate-fade-in">
        <h3 className="text-sm font-medium text-foreground mb-3">{t("Today vs Yesterday")}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {cells.map((c) => (
            <div key={c.label}>
              <p className="text-xs text-muted-foreground mb-0.5">{c.label}</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-semibold">{c.format(c.today)}</span>
                <DiffBadge val={c.diff} />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{c.format(c.yesterday)} yesterday</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderForecast = () => {
    if (!forecast?.forecast) return null;
    const { daily, monthly } = forecast.forecast;
    const items = [
      daily?.status === "ok" && daily.etaUtc && { label: t("Daily Limit"), ...daily },
      monthly?.status === "ok" && monthly.etaUtc && { label: t("Monthly Limit"), ...monthly },
    ].filter(Boolean) as any[];
    if (!items.length) return null;

    return (
      <div className="bg-card border border-border rounded-xl p-4 animate-fade-in">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium text-foreground">{t("Forecast ETA")}</h3>
        </div>
        <div className="space-y-2">
          {items.map((item: any) => (
            <div key={item.label} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="text-foreground">
                {item.hoursRemaining != null
                  ? `${item.hoursRemaining}h remaining`
                  : item.daysRemaining != null
                    ? `${item.daysRemaining}d remaining`
                    : "—"
                }
                <span className="text-muted-foreground ml-1">({t("at current rate")})</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTopErrors = () => {
    if (!topErrors.length) return null;

    const buildDebugPaste = (err: TopError) => {
      return [
        `Status: ${err.statusCode}`,
        `Count: ×${err.count}`,
        err.model ? `Model: ${err.model}` : null,
        err.ideDetected ? `IDE: ${err.ideDetected}` : null,
        err.endpointPath ? `Endpoint: ${err.endpointPath}` : null,
        "",
        "=== Error ===",
        err.errorMessage || err.errorSnippet || "(none)",
        "",
        "=== Request preview ===",
        err.requestPreview || "(none)",
        "",
        "=== Upstream / response preview ===",
        err.responsePreview || "(none)",
      ].filter((l) => l !== null).join("\n");
    };

    return (
      <div className="bg-card border border-border rounded-xl p-4 animate-fade-in">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
          <h3 className="text-sm font-medium text-foreground">{t("Top Errors")}</h3>
          <span className="text-[10px] text-muted-foreground ml-auto">{t("Click for details")}</span>
        </div>
        <div className="space-y-2">
          {topErrors.slice(0, 8).map((err, i) => {
            const open = expandedError === i;
            return (
              <div key={i} className="rounded-lg border border-border/60 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedError(open ? null : i)}
                  className="w-full flex items-start gap-3 text-xs p-2.5 hover:bg-accent/40 transition-colors text-left"
                >
                  <span className={`px-1.5 py-0.5 rounded font-mono font-medium flex-shrink-0 ${
                    err.statusCode >= 500 ? "bg-red-400/10 text-red-400" : "bg-yellow-400/10 text-yellow-400"
                  }`}>
                    {err.statusCode}
                  </span>
                  <span className="text-muted-foreground truncate flex-1">
                    {err.errorSnippet || err.errorMessage || "—"}
                  </span>
                  <span className="text-foreground font-medium flex-shrink-0">×{err.count}</span>
                  {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                </button>
                {open && (
                  <div className="px-3 pb-3 space-y-2 border-t border-border/50 bg-accent/20">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground pt-2">
                      {err.model && <span>Model: <span className="text-foreground font-mono">{err.model}</span></span>}
                      {err.ideDetected && <span>IDE: <span className="text-foreground">{err.ideDetected}</span></span>}
                      {err.endpointPath && <span>Endpoint: <span className="font-mono text-foreground">{err.endpointPath}</span></span>}
                    </div>
                    {err.requestPreview && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{t("Request")}</p>
                        <pre className="text-[11px] font-mono text-foreground/90 bg-background/60 border border-border rounded p-2 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                          {err.requestPreview}
                        </pre>
                      </div>
                    )}
                    {(err.responsePreview || err.errorMessage) && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{t("Upstream response")}</p>
                        <pre className="text-[11px] font-mono text-red-300/90 bg-red-400/5 border border-red-400/10 rounded p-2 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                          {err.responsePreview || err.errorMessage}
                        </pre>
                      </div>
                    )}
                    <CopyButton text={buildDebugPaste(err)} label={t("Copy for AI")} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCheatSheet = () => {
    const baseUrl = "https://api.tokito.xyz/v1";
    const openaiSnippet = `import openai\nclient = openai.OpenAI(\n  base_url="${baseUrl}",\n  api_key="YOUR_KEY"\n)\nresp = client.chat.completions.create(\n  model="tokito/glm-5.1",\n  messages=[{"role":"user","content":"Hello"}]\n)`;
    const anthropicSnippet = `import anthropic\nclient = anthropic.Anthropic(\n  base_url="${baseUrl}",\n  api_key="YOUR_KEY"\n)\nresp = client.messages.create(\n  model="tokito/claude-sonnet",\n  max_tokens=1024,\n  messages=[{"role":"user","content":"Hello"}]\n)`;

    return (
      <div className="bg-card border border-border rounded-xl overflow-hidden animate-fade-in">
        <button
          onClick={() => setCheatSheetOpen(!cheatSheetOpen)}
          className="w-full flex items-center justify-between p-4 text-sm font-medium text-foreground hover:bg-accent/30 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            {t("Endpoint Cheat Sheet")}
          </span>
          {cheatSheetOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {cheatSheetOpen && (
          <div className="border-t border-border p-4 space-y-4 animate-fade-in">
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("Base URL")}</p>
              <div className="flex items-center gap-2">
                <code className="text-xs text-primary bg-primary/10 px-2 py-1 rounded font-mono">{baseUrl}</code>
                <CopyButton text={baseUrl} label={t("Copy")} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">OpenAI SDK (Python)</p>
                <button
                  onClick={() => copySnippet("openai", openaiSnippet)}
                  className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                >
                  {copiedSnippet === "openai" ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copiedSnippet === "openai" ? t("Copied!") : t("Copy")}
                </button>
              </div>
              <pre className="text-xs bg-background rounded-lg p-3 overflow-x-auto text-muted-foreground leading-relaxed">{openaiSnippet}</pre>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">Anthropic SDK (Python)</p>
                <button
                  onClick={() => copySnippet("anthropic", anthropicSnippet)}
                  className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                >
                  {copiedSnippet === "anthropic" ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copiedSnippet === "anthropic" ? t("Copied!") : t("Copy")}
                </button>
              </div>
              <pre className="text-xs bg-background rounded-lg p-3 overflow-x-auto text-muted-foreground leading-relaxed">{anthropicSnippet}</pre>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderStatCards = () => {
    if (!stats) return null;
    const cards = [
      { key: "requests", label: t("Requests"), icon: Activity, value: stats.requests, format: formatNumber },
      { key: "promptTokens", label: t("Input Tokens"), icon: MessageSquare, value: stats.promptTokens, format: formatNumber },
      { key: "completionTokens", label: t("Output Tokens"), icon: Download, value: stats.completionTokens, format: formatNumber },
      { key: "cost", label: t("Est. Cost"), icon: DollarSign, value: stats.cost.total, format: formatCost },
      { key: "sessions", label: t("Sessions"), icon: Users, value: stats.sessions, format: formatNumber },
      { key: "toolCalls", label: t("Tool Calls"), icon: Wrench, value: stats.toolCalls, format: formatNumber },
    ];
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 animate-fade-in">
        {cards.map(({ key, label, icon: Icon, value, format }) => (
          <div key={key} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <p className="text-xl font-semibold text-foreground">{format(value)}</p>
          </div>
        ))}
      </div>
    );
  };

  const renderTimeseriesChart = () => {
    if (!timeseries.length) return null;
    const data = timeseries.map((item) => ({ ...item, date: item.period.slice(5) }));
    return (
      <div className="bg-card border border-border rounded-xl p-4 animate-fade-in">
        <h3 className="text-sm font-medium text-foreground mb-4">{t("Requests Over Time")}</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
              <XAxis dataKey="date" stroke={CHART_COLORS.text} fontSize={11} tickLine={false} />
              <YAxis stroke={CHART_COLORS.text} fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatNumber} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Line
                type="monotone" dataKey="requests"
                stroke={CHART_COLORS.primary} strokeWidth={2}
                dot={false} activeDot={{ r: 4, fill: CHART_COLORS.primary }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  const renderModelChart = () => {
    if (!modelUsage.length) return null;
    const data = modelUsage.slice(0, 10).map((item) => ({
      name: item.model.length > 15 ? item.model.slice(0, 15) + "…" : item.model,
      fullName: item.model,
      tokens: item.tokens,
    }));
    return (
      <div className="bg-card border border-border rounded-xl p-4 animate-fade-in">
        <h3 className="text-sm font-medium text-foreground mb-4">{t("Token Usage by Model")}</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} horizontal={false} />
              <XAxis type="number" stroke={CHART_COLORS.text} fontSize={11} tickLine={false} tickFormatter={formatNumber} />
              <YAxis type="category" dataKey="name" stroke={CHART_COLORS.text} fontSize={10} tickLine={false} axisLine={false} width={100} />
              <Tooltip
                {...TOOLTIP_STYLE}
                formatter={(value: number, _name: string, props: { payload?: { fullName: string } }) => [
                  formatNumber(value), props.payload?.fullName || "",
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
    const total = ideUsage.reduce((sum, item) => sum + item.requests, 0);
    return (
      <div className="bg-card border border-border rounded-xl p-4 animate-fade-in">
        <h3 className="text-sm font-medium text-foreground mb-4">{t("IDE Breakdown")}</h3>
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
                  {total > 0 ? ((item.requests / total) * 100).toFixed(0) : 0}%
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
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">{t("Overview")}</h1>
              {renderAccountBadge()}
            </div>
            <p className="text-sm text-muted-foreground">{t("Your usage at a glance")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {renderRecapCTA()}
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      </div>

      {/* Trial countdown + notifications */}
      {renderTrialCountdown()}
      {renderNotificationBanner()}

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
          {/* Limits card */}
          {renderLimitsCard()}

          {/* Stat cards */}
          {renderStatCards()}

          {/* Today vs Yesterday compare */}
          {renderCompareStrip()}

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-6">
            {renderTimeseriesChart()}
            {renderModelChart()}
          </div>

          {/* IDE breakdown */}
          {renderIdeBreakdown()}

          {/* Forecast ETA */}
          {renderForecast()}

          {/* Top errors */}
          {renderTopErrors()}

          {/* Cheat sheet */}
          {renderCheatSheet()}
        </>
      )}
    </div>
  );
}
