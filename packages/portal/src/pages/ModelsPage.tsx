import { useState, useEffect, useMemo } from "react";
import { Copy, Check, ChevronDown, ChevronUp, Circle, Search } from "lucide-react";
import { PeriodSelector, PERIOD_OPTIONS, type PeriodKey } from "@/components/PeriodSelector";
import { api, type ModelEntry, type ModelUsage } from "@/lib/api";
import { formatNumber, formatRelativeTime, formatInputBreakdown } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

type SortKey = "latency" | "name" | "default";
type StatusFilter = "all" | "online" | "offline";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors"
      title={t("Copy")}
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function lastCheckLabel(m: ModelEntry, t: (k: string) => string): string {
  if (m.checkedAt) return formatRelativeTime(m.checkedAt);
  if (m.lastCheckedMinutes != null) {
    if (m.lastCheckedMinutes < 1) return t("just now");
    if (m.lastCheckedMinutes < 60) return `${m.lastCheckedMinutes} ${t("min ago")}`;
    const h = Math.floor(m.lastCheckedMinutes / 60);
    return `${h} ${t("hours")} ${t("ago")}`;
  }
  return t("Never checked");
}

function statusMeta(m: ModelEntry, t: (k: string) => string) {
  if (m.online === true) return { label: t("Online"), color: "text-green-400", dot: "bg-green-400" };
  if (m.online === false) return { label: t("Offline"), color: "text-red-400", dot: "bg-red-400/70" };
  return { label: t("Unknown"), color: "text-muted-foreground", dot: "bg-muted-foreground/40" };
}

function providerPrefix(id: string): string {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(0, slash) : id;
}

function latencyRank(m: ModelEntry): number {
  if (m.online === true && typeof m.latencyMs === "number" && Number.isFinite(m.latencyMs)) {
    return m.latencyMs;
  }
  return Number.POSITIVE_INFINITY;
}

function sortModels(list: ModelEntry[], sort: SortKey, catalogOrder: Map<string, number>): ModelEntry[] {
  const copy = [...list];
  if (sort === "default") {
    return copy.sort((a, b) => (catalogOrder.get(a.id) ?? 0) - (catalogOrder.get(b.id) ?? 0));
  }
  if (sort === "name") {
    return copy.sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: "base" }));
  }
  // latency: online with latency first (asc), then online without latency, then offline/unknown
  return copy.sort((a, b) => {
    const aOnline = a.online === true ? 0 : 1;
    const bOnline = b.online === true ? 0 : 1;
    if (aOnline !== bOnline) return aOnline - bOnline;
    const la = latencyRank(a);
    const lb = latencyRank(b);
    if (la !== lb) return la - lb;
    return a.id.localeCompare(b.id, undefined, { sensitivity: "base" });
  });
}

const selectClass =
  "h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40";

export default function ModelsPage() {
  const { t } = useI18n();
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [modelsList, setModelsList] = useState<ModelEntry[]>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("latency");
  const [provider, setProvider] = useState<string>("all");
  const [query, setQuery] = useState("");

  const periodLabel = PERIOD_OPTIONS.find((o) => o.key === period)?.label || period;

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([
      api.models.list().catch(() => [] as ModelEntry[]),
      api.stats.byModel(period).catch(() => [] as ModelUsage[]),
    ])
      .then(([models, usage]) => {
        setModelsList(models);
        setModelUsage(usage);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [period]);

  const catalogOrder = useMemo(() => {
    const map = new Map<string, number>();
    modelsList.forEach((m, i) => map.set(m.id, i));
    return map;
  }, [modelsList]);

  const providers = useMemo(() => {
    const set = new Set<string>();
    for (const m of modelsList) set.add(providerPrefix(m.id));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [modelsList]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = modelsList.filter((m) => {
      if (filter === "online" && m.online !== true) return false;
      if (filter === "offline" && m.online !== false) return false;
      if (provider !== "all" && providerPrefix(m.id) !== provider) return false;
      if (q && !m.id.toLowerCase().includes(q)) return false;
      return true;
    });
    return sortModels(base, sort, catalogOrder);
  }, [modelsList, filter, provider, query, sort, catalogOrder]);

  const displayList = expanded ? filtered : filtered.slice(0, 24);
  const onlineCount = modelsList.filter((m) => m.online === true).length;
  const offlineCount = modelsList.filter((m) => m.online === false).length;

  // Reset expand when filters change so the user starts from the top again
  useEffect(() => {
    setExpanded(false);
  }, [filter, provider, query, sort]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("Models")}</h1>
        <p className="text-sm text-muted-foreground">{t("Model status and usage")}</p>
      </div>

      {error && (
        <div className="p-3 bg-red-400/10 border border-red-400/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-4 h-40 animate-pulse" />
          <div className="bg-card border border-border rounded-xl p-4 h-40 animate-pulse" />
        </div>
      ) : (
        <>
          {/* Available models */}
          <div className="bg-card border border-border rounded-xl p-4 animate-fade-in">
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">{t("Available Models")}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {filtered.length === modelsList.length
                      ? `${modelsList.length} models · ${onlineCount} ${t("Online")} · ${offlineCount} ${t("Offline")}`
                      : `${filtered.length} ${t("shown")} · ${modelsList.length} total · ${onlineCount} ${t("Online")} · ${offlineCount} ${t("Offline")}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {(["all", "online", "offline"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                        filter === f
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                    >
                      {f === "all" ? t("All") : f === "online" ? t("Online") : t("Offline")}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                <div className="relative flex-1 min-w-[160px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("Search models")}
                    className={`${selectClass} w-full pl-8 pr-2`}
                    aria-label={t("Search models")}
                  />
                </div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className={selectClass}
                  aria-label={t("Sort")}
                >
                  <option value="latency">{t("Fastest")}</option>
                  <option value="name">{t("Name A-Z")}</option>
                  <option value="default">{t("Catalog order")}</option>
                </select>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className={selectClass}
                  aria-label={t("Provider")}
                >
                  <option value="all">{t("All providers")}</option>
                  {providers.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {displayList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">{t("No models found")}</p>
            ) : (
              <div className="space-y-1.5">
                {displayList.map((m) => {
                  const st = statusMeta(m, t);
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border/60 bg-accent/20 hover:bg-accent/40 transition-colors"
                    >
                      <Circle className={`w-2 h-2 fill-current ${st.dot} ${st.color} flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-foreground truncate font-mono">{m.id}</span>
                          <CopyButton text={m.id} />
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                          <span className={st.color}>{st.label}</span>
                          <span>·</span>
                          <span>{t("Last check")}: {lastCheckLabel(m, t)}</span>
                          {m.latencyMs != null && m.online && (
                            <>
                              <span>·</span>
                              <span>{m.latencyMs}ms</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {filtered.length > 24 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-3 text-xs text-primary hover:underline flex items-center gap-1"
              >
                {expanded ? (
                  <><ChevronUp className="w-3 h-3" /> {t("Show less")}</>
                ) : (
                  <><ChevronDown className="w-3 h-3" /> {t("Show")} {filtered.length - 24} {t("more")}</>
                )}
              </button>
            )}
          </div>

          {/* Models you've used (period-aware) */}
          <div className="bg-card border border-border rounded-xl p-4 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-medium text-foreground">{t("Models You've Used")}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("Period")}: {periodLabel}
                </p>
              </div>
              <PeriodSelector value={period} onChange={setPeriod} />
            </div>
            {modelUsage.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">{t("No usage in this period")}</p>
            ) : (
              <div className="space-y-3">
                {modelUsage.map((m) => {
                  const total = modelUsage.reduce((s, x) => s + x.tokens, 0);
                  const pct = total > 0 ? Math.round((m.tokens / total) * 100) : 0;
                  return (
                    <div key={m.model} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="text-foreground truncate font-mono flex-1">{m.model}</span>
                        <span className="text-muted-foreground flex-shrink-0" title={formatInputBreakdown(m.billablePromptTokens, m.cachedTokens, m.promptTokens).label}>
                          {formatInputBreakdown(m.billablePromptTokens, m.cachedTokens, m.promptTokens).compact}↑ / {formatNumber(m.completionTokens)}↓ · {formatNumber(m.tokens)} tok · {m.requests} req
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="progress-bar-track flex-1">
                          <div className="progress-bar-fill bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-primary w-9 text-right flex-shrink-0">{pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
