import { useEffect, useState } from "react";
import {
  AlertTriangle, Braces, ChevronDown, CircleHelp, Database, Gauge,
  MessageSquareText, RefreshCw, Sparkles, type LucideIcon,
} from "lucide-react";
import {
  api,
  type UsageExplanationBreakdown,
  type UsageExplanationPeriod,
  type UsageExplanationResponse,
} from "@/lib/api";
import { formatNumber } from "@/lib/utils";

const PERIODS: Array<{ value: UsageExplanationPeriod; label: string }> = [
  { value: "1d", label: "1 day" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

const n = (value?: number) => formatNumber(value ?? 0);

function dateRange(data: UsageExplanationResponse) {
  try {
    const format = new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: data.timezone,
    });
    return `${format.format(new Date(data.from))} – ${format.format(new Date(data.to))} (${data.timezone})`;
  } catch {
    return `${data.from} – ${data.to}`;
  }
}

function BreakdownTable({
  rows,
  kind,
}: {
  rows: UsageExplanationBreakdown[];
  kind: "IDE" | "Model";
}) {
  if (!rows.length) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No {kind.toLowerCase()} usage in this period.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">{kind}</th>
            <th className="pb-2 text-right font-medium">Prompts</th>
            <th className="pb-2 text-right font-medium">API calls</th>
            <th className="pb-2 text-right font-medium">Raw tokens</th>
            <th className="pb-2 text-right font-medium">Toward limit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const label = row.ide ?? row.model ?? row.name ?? row.label ?? `Unknown ${kind}`;
            return (
              <tr key={`${label}-${index}`} className="border-b border-border/60 last:border-0">
                <td className="max-w-[220px] truncate py-3 pr-4 font-medium text-foreground" title={label}>{label}</td>
                <td className="py-3 text-right tabular-nums text-muted-foreground">{n(row.turns)}</td>
                <td className="py-3 text-right tabular-nums text-muted-foreground">{n(row.apiCalls)}</td>
                <td className="py-3 text-right tabular-nums text-muted-foreground">{n(row.rawTotalTokens)}</td>
                <td className="py-3 text-right tabular-nums font-medium text-foreground">{n(row.amountTowardLimit)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function UsageExplanationCard() {
  const [period, setPeriod] = useState<UsageExplanationPeriod>("7d");
  const [data, setData] = useState<UsageExplanationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"ide" | "model">("ide");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.usage.explanation(period)
      .then((result) => active && setData(result))
      .catch((err) => active && setError(err instanceof Error ? err.message : "Unable to load usage"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [period, retry]);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm" aria-labelledby="usage-explanation-title">
      <div className="border-b border-border bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-primary/10 p-2 text-primary"><Gauge className="h-4 w-4" /></span>
              <div>
                <h2 id="usage-explanation-title" className="font-semibold text-foreground">How your usage is counted</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Account-wide totals from the usage meter</p>
              </div>
            </div>
          </div>
          <div className="flex w-full rounded-lg border border-border bg-background/60 p-1 sm:w-auto" aria-label="Usage period">
            {PERIODS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPeriod(option.value)}
                className={`min-h-9 flex-1 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors sm:flex-none ${
                  period === option.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                aria-pressed={period === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4 p-4 sm:p-6" aria-busy="true">
          <div className="h-28 animate-pulse rounded-xl bg-muted" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-muted" />)}
          </div>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center px-4 py-12 text-center">
          <AlertTriangle className="mb-3 h-7 w-7 text-destructive" />
          <p className="font-medium text-foreground">Usage details are unavailable</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-accent">
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : data ? (
        <div className="space-y-5 p-4 sm:p-6">
          <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-primary">Amount toward your limit</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground sm:text-4xl">{n(data.totals.amountTowardLimit)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{dateRange(data)}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Database className="h-3.5 w-3.5" />
                Meter source: <span className="font-medium text-foreground">{data.meter.source || "Account usage"}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ["Prompts", data.totals.turns, MessageSquareText, "User turns"],
              ["API calls", data.totals.apiCalls, Braces, "All request hops"],
              ["Raw tokens", data.totals.rawTotalTokens, Sparkles, "Before metering"],
              ["Successful hops", data.totals.successfulHops, Gauge, `${n(data.totals.failedHops)} failed`],
            ] satisfies Array<[string, number, LucideIcon, string]>).map(([label, value, Icon, hint]) => (
              <div key={label} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
                <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">{n(value)}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>

          {data.totals.apiCalls > data.totals.turns * 2 && data.totals.turns > 0 && (
            <div className="flex gap-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div>
                <p className="font-medium text-foreground">Higher request-hop activity</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Some prompts made several API calls, such as retries or tool steps. This is why API calls are higher than prompts.
                </p>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border">
            <button type="button" onClick={() => setDetailsOpen((open) => !open)} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground"><CircleHelp className="h-4 w-4 text-primary" />See the token breakdown and formula</span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
            </button>
            {detailsOpen && (
              <div className="space-y-4 border-t border-border p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {[
                    ["Billable input", data.totals.billableInputTokens],
                    ["Cached input", data.totals.cachedInputTokens],
                    ["Output", data.totals.outputTokens],
                  ].map(([label, value]) => (
                    <div key={label as string} className="rounded-lg bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground">{label as string}</p>
                      <p className="mt-1 font-semibold tabular-nums text-foreground">{n(value as number)}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg bg-background/60 p-3 font-mono text-xs leading-relaxed text-foreground">
                  {n(data.totals.billableInputTokens)} billable input + {n(data.totals.cachedInputTokens)} cached input + {n(data.totals.outputTokens)} output = {n(data.totals.rawTotalTokens)} raw tokens
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{data.meter.explanation}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The amount toward your limit is supplied by the account meter. Raw token totals help explain activity, but are not a second limit calculation.
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="mb-3 flex border-b border-border">
              {(["ide", "model"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setTab(value)} className={`min-h-10 border-b-2 px-4 text-sm font-medium transition-colors ${tab === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  By {value === "ide" ? "IDE" : "Model"}
                </button>
              ))}
            </div>
            <BreakdownTable rows={tab === "ide" ? data.byIde : data.byModel} kind={tab === "ide" ? "IDE" : "Model"} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
