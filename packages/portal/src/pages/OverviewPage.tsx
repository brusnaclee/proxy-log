import { useState, useEffect, useCallback, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from "recharts";
import {
  Activity, MessageSquare, Download, DollarSign, Users, Wrench, Zap,
  Copy, Check, ChevronDown, ChevronUp, AlertTriangle, TrendingUp,
  Info,
} from "lucide-react";
import { PeriodSelector, type PeriodKey } from "@/components/PeriodSelector";
import { ChartBox } from "@/components/ChartBox";
import { UsageExplanationCard } from "@/components/UsageExplanationCard";
import { api, type MeResponse, type TopError } from "@/lib/api";
import { formatNumber, formatCost, formatInputBreakdown } from "@/lib/utils";
import { badgeClass, badgeLabel, resolveDisplayBadges, formatAddonExpiry } from "@/lib/account-badge";
import { useI18n, hydrateLangFromServer } from "@/lib/i18n";

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

function ProgressBar({
  value,
  max,
  label,
  sublabel,
  softMode,
}: {
  value: number;
  max: number;
  label: string;
  sublabel?: string;
  softMode?: boolean;
}) {
  const overSoft = !!(softMode && max > 0 && value > max);
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const danger = !softMode && pct > 85;
  const warn = softMode ? overSoft || pct > 85 : pct > 65;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className={danger ? "text-red-400" : warn ? "text-yellow-400" : "text-foreground"}>
          {formatNumber(value)} / {formatNumber(max)}
          {softMode && <span className="text-muted-foreground ml-1">soft</span>}
          {overSoft && (
            <span className="text-yellow-400 ml-1">
              · +{formatNumber(value - max)} exceed
            </span>
          )}
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
  const { t, lang } = useI18n();
  const [period, setPeriod] = useState<PeriodKey>("7d");

  const [stats, setStats] = useState<any>(null);
  const [timeseries, setTimeseries] = useState<any[]>([]);
  const [modelUsage, setModelUsage] = useState<any[]>([]);
  const [ideUsage, setIdeUsage] = useState<any[]>([]);
  const [topErrors, setTopErrors] = useState<TopError[]>([]);
  const [compare, setCompare] = useState<{ today: any; yesterday: any } | null>(null);
  const [forecast, setForecast] = useState<any>(null);
  const [user, setUser] = useState<MeResponse | null>(null);
  const [expandedError, setExpandedError] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [chartMetric, setChartMetric] = useState<"prompts" | "apiCalls">("prompts");
  const hasLoadedRef = useRef(false);

  const fetchPeriodData = useCallback((p: string) => {
    return Promise.all([
      api.stats.overview(p),
      api.stats.timeseries(p),
      api.stats.byModel(p),
      api.stats.byIde(p),
    ]);
  }, []);

  useEffect(() => {
    if (hasLoadedRef.current) setRefreshing(true);
    else setLoading(true);
    setError("");

    Promise.all([
      fetchPeriodData(period),
      api.me().catch(() => null),
      api.stats.topErrors(period).catch(() => []),
      api.stats.compare().catch(() => null),
      api.stats.forecast().catch(() => null),
    ])
      .then(([periodData, userData, errorsData, compareData, forecastData]) => {
        const [statsRes, tsRes, modelRes, ideRes] = periodData as [any, any[], any[], any[]];
        setStats(statsRes);
        setTimeseries(tsRes);
        setModelUsage(modelRes);
        setIdeUsage(ideRes);
        setUser(userData as MeResponse | null);
        if (userData && (userData as MeResponse).preferredLang) {
          hydrateLangFromServer((userData as MeResponse).preferredLang);
        }
        setTopErrors(errorsData as TopError[]);
        setCompare(compareData as any);
        setForecast(forecastData as any);
        hasLoadedRef.current = true;
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load data"))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [period, fetchPeriodData]);

  const copySnippet = (key: string, text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedSnippet(key);
    setTimeout(() => setCopiedSnippet(null), 1800);
  };

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const renderTrialCountdown = () => {
    if (!user || user.accountType !== "trial") return null;
    const limitsNote = (
      <p className="text-xs text-muted-foreground mt-1">
        Trial: all models + auto · {(user.limits.dailyTokenLimit || 0).toLocaleString()} tokens/day · global prompts apply
      </p>
    );
    if (!user.trialExpiresAt) {
      return (
        <div className="p-3 bg-yellow-400/10 border border-yellow-400/20 rounded-lg text-sm text-yellow-400">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 flex-shrink-0" />
            Trial account
          </div>
          {limitsNote}
        </div>
      );
    }
    const diff = new Date(user.trialExpiresAt).getTime() - Date.now();
    if (diff <= 0) return (
      <div className="p-3 bg-red-400/10 border border-red-400/20 rounded-lg text-sm text-red-400 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        Trial expired
      </div>
    );
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return (
      <div className="p-3 bg-yellow-400/10 border border-yellow-400/20 rounded-lg text-sm text-yellow-400">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 flex-shrink-0" />
          {t("Trial expires in")}: {days > 0 ? `${days} ${t("days")}` : `${hours} ${t("hours")}`}
        </div>
        {limitsNote}
      </div>
    );
  };

  const renderAccountBadge = () => {
    if (!user) return null;
    const addons = user.activeAddons || [];
    const badges = resolveDisplayBadges(user.accountType, user.accountBadges, {
      hasAddon: addons.length > 0,
      addons,
    });
    return (
      <span className="inline-flex flex-wrap gap-1">
        {badges.map((b) => (
          <span
            key={b}
            className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${badgeClass(b)}`}
          >
            {t(badgeLabel(b))}
            {b === "addon" && addons[0]?.expiresAt
              ? ` · ${formatAddonExpiry(addons[0].expiresAt)}`
              : ""}
          </span>
        ))}
      </span>
    );
  };

  const renderLimitsCard = () => {
    if (!user) return null;
    const { limits, usageToday, usageMonth } = user;
    const sourceLabel = (src?: string) => {
      if (src === "override") return t("override");
      if (src === "global") return t("global");
      if (src === "addon") return "base + add-on";
      return "";
    };
    const formatReset = (iso?: string | null, windowFallback?: string | null) => {
      if (iso) {
        try {
          const d = new Date(iso);
          if (!Number.isNaN(d.getTime())) {
            const diffMs = d.getTime() - Date.now();
            if (diffMs <= 0) {
              if (windowFallback) return `${t("Resets")} ${windowFallback} ${t("after first use")}`;
              return "";
            }
            const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
            const hh = String(wib.getUTCHours()).padStart(2, "0");
            const mm = String(wib.getUTCMinutes()).padStart(2, "0");
            let rel = "";
            if (diffMs > 60_000) {
              const mins = Math.round(diffMs / 60_000);
              rel = mins < 60 ? ` · in ${mins}m` : ` · in ${(mins / 60).toFixed(mins % 60 === 0 ? 0 : 1)}h`;
            } else {
              rel = " · soon";
            }
            return `${t("Resets")} ≈ ${hh}:${mm} WIB${rel}`;
          }
        } catch { /* fall through */ }
      }
      if (windowFallback) return `${t("Resets")} ${windowFallback} ${t("after first use")}`;
      return "";
    };

    const dailyUsed =
      usageToday.totalTokens ?? usageToday.promptTokens + usageToday.completionTokens;
    const bars: Array<{
      label: string;
      value: number;
      max: number;
      sublabel?: string;
      source?: string;
      reset?: string;
      softMode?: boolean;
      footer?: string;
    }> = [];
    if (limits.dailyInputTokenLimit > 0) {
      const used = usageToday.promptTokens;
      const inputMax = limits.dailyInputTokenLimit;
      const bd = user.dailyTokenBreakdown;
      const ib = user.inputBreakdown;
      let ctxIn = "toward daily limit";
      if (ib && ib.apiCallCount > 0) {
        ctxIn =
          lang === "id"
            ? `${ib.promptCount} prompt × ~${formatNumber(ib.avgInPerPrompt)} @100% + ${ib.followUpCount} lanjutan × ~${formatNumber(ib.avgInPerFollowUp)} @${ib.weightPercent}%`
            : `${ib.promptCount} prompts × ~${formatNumber(ib.avgInPerPrompt)} @100% + ${ib.followUpCount} follow-ups × ~${formatNumber(ib.avgInPerFollowUp)} @${ib.weightPercent}%`;
        if (ib.peakFullIn > 0) {
          ctxIn +=
            lang === "id"
              ? ` · puncak chat ~${formatNumber(ib.peakFullIn)} (info)`
              : ` · chat peak ~${formatNumber(ib.peakFullIn)} (info)`;
        }
      }
      const stack =
        bd && bd.addonBonus > 0
          ? `base ${formatNumber(bd.inputBase || bd.base || 0)} + pack ${formatNumber(bd.addonBonus)}`
          : ctxIn;
      bars.push({
        label: t("Input Tokens"),
        value: used,
        max: inputMax,
        softMode: false,
        sublabel: bd && bd.addonBonus > 0 ? `${stack} · ${ctxIn}` : ctxIn,
        source: bd && bd.addonBonus > 0
          ? "base + pack → input"
          : sourceLabel(limits.dailyInputTokenLimitSource),
        reset: formatReset(user.dailyResetAt),
      });
    }
    if (limits.dailyOutputTokenLimit > 0) {
      bars.push({
        label: t("Output Tokens"),
        value: usageToday.completionTokens,
        max: limits.dailyOutputTokenLimit,
        softMode: false,
        sublabel: "tokens",
        source: sourceLabel(limits.dailyOutputTokenLimitSource),
        reset: formatReset(user.dailyResetAt),
      });
    }
    if (limits.dailyTokenLimit > 0) {
      bars.push({
        label: t("Daily Limit"),
        value: dailyUsed,
        max: limits.dailyTokenLimit,
        sublabel: "custom key daily",
        source: sourceLabel(limits.dailyTokenLimitSource),
        reset: formatReset(user.dailyResetAt),
      });
    }
    if (limits.monthlyTokenLimit > 0) {
      bars.push({
        label: t("Monthly Limit"),
        value: usageMonth?.totalTokens ?? 0,
        max: limits.monthlyTokenLimit,
        sublabel: "tokens",
        source: sourceLabel(limits.monthlyTokenLimitSource),
        reset: formatReset(user.monthlyResetAt),
      });
    }
    if (limits.promptLimit > 0) {
      bars.push({
        label: `${t("Prompt Limit")} (${limits.promptLimitWindow})`,
        value: usageToday.promptCount ?? 0,
        max: limits.promptLimit,
        sublabel: `${t("Prompts")} · last window`,
        source: sourceLabel(limits.promptLimitSource),
        reset: formatReset(user.promptResetAt, limits.promptLimitWindow),
      });
    }
    if (limits.rateLimit > 0) {
      bars.push({
        label: `${t("API Call Limit")} (${limits.rateLimitWindow})`,
        value: usageToday.apiCallCount ?? 0,
        max: limits.rateLimit,
        sublabel: `${t("API calls")} · last window`,
        source: sourceLabel(limits.rateLimitSource),
        reset: formatReset(user.apiCallResetAt, limits.rateLimitWindow),
      });
    }

    const modelLimits = (user.modelUsageLimits || []).filter((m) => m.limit > 0 || m.used > 0);
    const hasAddon = (user.activeAddons || []).length > 0;
    const pools =
      user.blockedWithoutAddon
        ? []
        : (user.dedicatedPools || []).filter((p) => p.limit > 0);
    if (!bars.length && !modelLimits.length && !hasAddon && !pools.length) return null;

    return (
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Current limit windows</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Live quota counters · each row follows the reset window shown beside it
          </p>
        </div>
        {(user.keyCount || 0) > 1 && (
          <p className="text-[10px] text-muted-foreground">
            {lang === "id"
              ? `Shared akun · ${user.keyCount} keys — sisa di bawah = pool bersama. Rincian per key di halaman Keys.`
              : `Shared account · ${user.keyCount} keys — bars below = shared pool. Per-key contribution on Keys page.`}
          </p>
        )}
        {pools.length > 0 && (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-2.5 space-y-2 text-xs">
            <p className="font-medium text-foreground">{t("Dedicated model pools")}</p>
            <p className="text-[10px] text-muted-foreground">
              Outside account daily / input / output
            </p>
            {pools.map((p) => {
              const ioBits: string[] = [];
              if ((p.inputLimit || 0) > 0) {
                ioBits.push(`In ${formatNumber(p.inputUsed || 0)}/${formatNumber(p.inputLimit || 0)}`);
              }
              if ((p.outputLimit || 0) > 0) {
                ioBits.push(`Out ${formatNumber(p.outputUsed || 0)}/${formatNumber(p.outputLimit || 0)}`);
              }
              return (
                <div key={`${p.scope}:${p.model}`}>
                  <ProgressBar
                    label={`${p.model}${p.isPattern ? " (pattern)" : ""}`}
                    value={p.used}
                    max={p.limit}
                    sublabel={ioBits.length ? ioBits.join(" · ") : "total (in+out)"}
                  />
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {formatNumber(p.remaining)} left
                    {p.resetAt ? ` · ${formatReset(p.resetAt)}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {hasAddon && (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 space-y-1 text-xs">
            {(user.activeAddons || []).map((a) => (
              <div key={a.name} className="flex justify-between gap-2 text-muted-foreground">
                <span className="font-mono text-foreground">{a.name}</span>
                <span>
                  +{(a.dailyTokenLimit / 1e6).toFixed(0)}M/day
                  {a.expiresAt ? ` · sampai ${formatAddonExpiry(a.expiresAt)}` : ""}
                </span>
              </div>
            ))}
            {user.perModelPromptsBypassedByAddon && (
              <p className="text-[10px] text-muted-foreground">
                Per-model prompt caps bypassed · Input/Output soft can exceed via add-on until Daily Total · global Prompts still apply
              </p>
            )}
            {(user.addonModelTokenCaps || []).length > 0 && (
              <div className="pt-1 space-y-0.5">
                {(user.addonModelTokenCaps || []).map((c) => (
                  <div key={c.pattern} className="flex justify-between font-mono text-[10px] text-muted-foreground">
                    <span>{c.pattern}</span>
                    <span>{(c.dailyLimit / 1e6).toFixed(0)}M/day</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="space-y-2">
          {bars.map((b) => (
            <div key={b.label}>
              <ProgressBar
                label={b.label}
                value={b.value}
                max={b.max}
                sublabel={b.sublabel}
                softMode={b.softMode}
              />
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 pl-0.5 flex-wrap">
                {b.footer ? (
                  <span>{b.footer}{b.source ? ` · ${b.source}` : ""}</span>
                ) : (
                  b.source && <span>{t("Source")}: {b.source}</span>
                )}
                {b.reset && <span>· {b.reset}</span>}
              </div>
            </div>
          ))}
          {modelLimits.length > 0 && (
            <div className="pt-2 border-t border-border/50 space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("Per-Model Prompt")}</p>
              {modelLimits.slice(0, 8).map((m) => {
                // Per-model = 00:00 WIB (same as daily tokens), not rolling "after first use"
                const reset = formatReset(m.resetAt || user.dailyResetAt);
                return (
                  <div key={m.model} className="flex items-center justify-between text-xs gap-2">
                    <span className="font-mono text-foreground truncate flex-1 min-w-0">{m.model}</span>
                    <span className={`shrink-0 text-right ${m.limit > 0 && m.used >= m.limit ? "text-red-400" : "text-muted-foreground"}`}>
                      {m.used} / {m.limit > 0 ? m.limit : "∞"}
                      {reset ? ` · ${reset}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderAddonHistory = () => {
    if (user?.accountType === "trial") return null;
    const history = user?.addonHistory || [];
    return (
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">{t("Add-on history")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("Past and active pack assignments")}
          </p>
        </div>
        {!history.length ? (
          <p className="text-xs text-muted-foreground py-1">{t("No add-on history yet")}</p>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 text-xs text-muted-foreground">
                <th className="text-left py-2 pr-3 font-medium">{t("Add-on")}</th>
                <th className="text-left py-2 pr-3 font-medium">{t("Started")}</th>
                <th className="text-left py-2 pr-3 font-medium">{t("Expires")}</th>
                <th className="text-left py-2 font-medium">{t("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-border/20">
                  <td className="py-2 pr-3">
                    <span className="font-mono text-xs text-foreground">{h.addonName}</span>
                    {(h.dailyTokenLimit || 0) > 0 && (
                      <span className="text-[10px] text-muted-foreground ml-1.5">
                        +{(h.dailyTokenLimit / 1e6).toFixed(0)}M/day
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {formatAddonExpiry(h.startsAt)}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {h.expiresAt ? formatAddonExpiry(h.expiresAt) : t("no expiry")}
                  </td>
                  <td className="py-2">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] rounded-full border ${
                        h.status === "active"
                          ? "bg-emerald-400/15 text-emerald-300 border-emerald-400/30"
                          : h.status === "expired"
                            ? "bg-muted text-muted-foreground border-border"
                            : "bg-amber-400/10 text-amber-300 border-amber-400/30"
                      }`}
                    >
                      {h.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
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
      { label: t("Prompts"), today: formatNumber(today.requests), yesterday: formatNumber(yesterday.requests), diff: pct(today.requests, yesterday.requests) },
      { label: t("API Calls"), today: formatNumber(today.apiCalls || 0), yesterday: formatNumber(yesterday.apiCalls || 0), diff: pct(today.apiCalls || 0, yesterday.apiCalls || 0) },
      {
        label: t("Input Tokens"),
        today: formatInputBreakdown(today.billablePromptTokens, today.cachedTokens, today.promptTokens).label,
        yesterday: formatInputBreakdown(yesterday.billablePromptTokens, yesterday.cachedTokens, yesterday.promptTokens).label,
        diff: pct(today.promptTokens, yesterday.promptTokens),
      },
      { label: t("Output Tokens"), today: formatNumber(today.completionTokens), yesterday: formatNumber(yesterday.completionTokens), diff: pct(today.completionTokens, yesterday.completionTokens) },
      { label: t("Est. Cost"), today: formatCost(today.cost.total), yesterday: formatCost(yesterday.cost.total), diff: pct(today.cost.total, yesterday.cost.total) },
    ];

    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-medium text-foreground mb-3">{t("Today vs Yesterday")}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {cells.map((c) => (
            <div key={c.label} className="transition-transform duration-200 hover:translate-y-[-1px]">
              <p className="text-xs text-muted-foreground mb-0.5">{c.label}</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-semibold tabular-nums">{c.today}</span>
                <DiffBadge val={c.diff} />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{c.yesterday} yesterday</p>
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
      <div className="bg-card border border-border rounded-xl p-4">
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
      <div className="bg-card border border-border rounded-xl p-4">
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
      <div className="bg-card border border-border rounded-xl overflow-hidden">
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
          <div className="border-t border-border p-4 space-y-4">
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
      { key: "requests", label: t("Prompts"), icon: Activity, value: stats.requests, format: formatNumber },
      { key: "apiCalls", label: t("API Calls"), icon: Zap, value: stats.apiCalls || 0, format: formatNumber, hint: t("API Calls hint") },
      {
        key: "promptTokens",
        label: "Counted Input",
        icon: MessageSquare,
        value: stats.promptTokens,
        format: (n: number) => {
          const processed = Number(stats.billablePromptTokens || 0) + Number(stats.cachedTokens || 0);
          return `${formatNumber(n)} counted · ${formatNumber(processed)} processed`;
        },
        hint: `${formatNumber(stats.billablePromptTokens || 0)} billable + ${formatNumber(stats.cachedTokens || 0)} cached before metering`,
      },
      { key: "completionTokens", label: "Counted Output", icon: Download, value: stats.completionTokens, format: formatNumber, hint: "Output counted by the canonical meter for the selected analytics period" },
      { key: "cost", label: t("Est. Cost"), icon: DollarSign, value: stats.cost.total, format: formatCost },
      { key: "sessions", label: t("Sessions"), icon: Users, value: stats.sessions, format: formatNumber },
      { key: "toolCalls", label: t("Tool Calls"), icon: Wrench, value: stats.toolCalls, format: formatNumber, hint: t("Tool Calls hint") },
    ];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {cards.map(({ key, label, icon: Icon, value, format, hint }) => (
          <div
            key={key}
            title={hint}
            className="bg-card border border-border rounded-xl p-4 sm:p-5 transition-all duration-200 hover:border-primary/30 hover:bg-accent/20"
          >
            <div className="flex items-center gap-2 mb-2">
              <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate">{label}</span>
            </div>
            <p className="text-xl font-semibold text-foreground tabular-nums">{format(value)}</p>
          </div>
        ))}
      </div>
    );
  };

  const renderTimeseriesChart = () => {
    if (!timeseries.length) return null;
    const data = timeseries.map((item) => ({ ...item, date: item.period.slice(5) }));
    const metricKey = chartMetric === "prompts" ? "requests" : "apiCalls";
    const title = chartMetric === "prompts" ? t("Prompts Over Time") : t("API Calls Over Time");
    const stroke = chartMetric === "prompts" ? CHART_COLORS.primary : "#818cf8";
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <div className="inline-flex rounded-lg border border-border/60 p-0.5 bg-accent/20">
            {([
              { key: "prompts" as const, label: t("Prompts") },
              { key: "apiCalls" as const, label: t("API Calls") },
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
        </div>
        <ChartBox>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
              <XAxis dataKey="date" stroke={CHART_COLORS.text} fontSize={11} tickLine={false} />
              <YAxis stroke={CHART_COLORS.text} fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatNumber} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Line
                type="monotone"
                dataKey={metricKey}
                name={chartMetric === "prompts" ? t("Prompts") : t("API Calls")}
                stroke={stroke}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: stroke }}
                isAnimationActive
                animationDuration={450}
              />
            </LineChart>
        </ChartBox>
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
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">{t("Token Usage by Model")}</h3>
        <ChartBox>
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
        </ChartBox>
      </div>
    );
  };

  const renderIdeBreakdown = () => {
    if (!ideUsage.length) return null;
    const total = ideUsage.reduce((sum, item) => sum + item.requests, 0);
    return (
      <div className="bg-card border border-border rounded-xl p-4">
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
    <div className="space-y-8">
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
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      </div>

      {renderTrialCountdown()}

      <UsageExplanationCard />

      {/* Loading skeleton — only first load; keep previous charts while refreshing */}
      {loading && !stats ? (
        <div className="space-y-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4 sm:p-5 animate-pulse">
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
        <div className={`space-y-8${refreshing ? " opacity-70 transition-opacity" : ""}`}>
          {/* Limits card */}
          {renderLimitsCard()}

          {/* Add-on history */}
          {renderAddonHistory()}

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
        </div>
      )}
    </div>
  );
}
