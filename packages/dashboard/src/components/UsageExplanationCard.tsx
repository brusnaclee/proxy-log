import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Calculator, Database, RefreshCw } from "lucide-react";
import { keys, type UsageExplanation, type UsageExplanationPeriod, type UsageExplanationRow } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const PERIODS: Array<{ value: UsageExplanationPeriod; label: string }> = [
  { value: "1d", label: "1 day" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

const value = (n: number | null | undefined) => formatNumber(Number(n) || 0);

function dateTime(input: string, timezone: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function BreakdownTable({ title, rows, nameKey }: {
  title: string;
  rows: UsageExplanationRow[];
  nameKey: "label" | "model";
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="text-[11px] text-muted-foreground">{rows.length} rows</span>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
          No usage in this breakdown.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full min-w-[940px] text-xs">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-10 bg-muted px-3 py-2.5 font-medium">{nameKey === "label" ? "IDE" : "Model"}</th>
                <th className="px-3 py-2.5 text-right font-medium">Turns</th>
                <th className="px-3 py-2.5 text-right font-medium">API calls</th>
                <th className="px-3 py-2.5 text-right font-medium">Hops (OK / failed)</th>
                <th className="px-3 py-2.5 text-right font-medium">Billable input</th>
                <th className="px-3 py-2.5 text-right font-medium">Cached input</th>
                <th className="px-3 py-2.5 text-right font-medium">Output</th>
                <th className="px-3 py-2.5 text-right font-medium">Raw total</th>
                <th className="px-3 py-2.5 text-right font-medium">Upstream credits (in / out)</th>
                <th className="px-3 py-2.5 text-right font-semibold text-primary">Toward limit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((row, index) => (
                <tr key={`${row[nameKey] || "unknown"}-${index}`} className="hover:bg-muted/20">
                  <td className="sticky left-0 max-w-[220px] truncate bg-card px-3 py-2.5 font-medium" title={row[nameKey] || "Unknown"}>
                    {row[nameKey] || "Unknown"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{value(row.turns)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{value(row.apiCalls)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{value(row.successfulHops)} / {value(row.failedHops)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{value(row.billableInputTokens)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{value(row.cachedInputTokens)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{value(row.outputTokens)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{value(row.rawTotalTokens)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{value(row.upstreamInputCredits)} / {value(row.upstreamOutputCredits)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-primary">{value(row.amountTowardLimit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function UsageExplanationCard({ keyId }: { keyId: number }) {
  const [period, setPeriod] = useState<UsageExplanationPeriod>("1d");
  const [data, setData] = useState<UsageExplanation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await keys.getUsageExplanation(keyId, period));
    } catch (err: any) {
      setData(null);
      setError(err?.message || "Could not load the usage explanation.");
    } finally {
      setLoading(false);
    }
  }, [keyId, period]);

  useEffect(() => { void load(); }, [load]);

  const totals = data?.totals;
  const hopMultiplier = totals?.turns ? (totals.successfulHops + totals.failedHops) / totals.turns : 0;
  const highHop = Boolean(totals && totals.turns > 0 && (totals.failedHops > 0 || hopMultiplier >= 2));

  return (
    <Card className="overflow-hidden border-cyan-500/25 bg-gradient-to-br from-cyan-500/[0.06] via-card to-card">
      <CardHeader className="gap-4 border-b border-border/50 pb-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-4 w-4 text-cyan-400" />
            Transparent usage explanation
          </CardTitle>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Canonical metering values from the backend, with every total broken down by IDE and model.
          </p>
        </div>
        <div className="period-toggle shrink-0" aria-label="Usage explanation period">
          {PERIODS.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={period === item.value ? "default" : "outline"}
              className="h-8"
              onClick={() => setPeriod(item.value)}
              aria-pressed={period === item.value}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-6">
        {loading ? (
          <div className="space-y-4" aria-live="polite">
            <div className="h-16 animate-pulse rounded-lg bg-muted/70" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/50" />)}
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-8 text-center">
            <AlertTriangle className="mb-2 h-5 w-5 text-destructive" />
            <p className="text-sm font-medium">Usage explanation unavailable</p>
            <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            <Button className="mt-4 gap-2" size="sm" variant="outline" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </Button>
          </div>
        ) : data && totals ? (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 rounded-lg border border-cyan-500/20 bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">{data.meter.source}</Badge>
                  <span className="text-[11px] text-muted-foreground">{dateTime(data.from, data.timezone)} — {dateTime(data.to, data.timezone)} ({data.timezone})</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{data.meter.explanation}</p>
              </div>
              <div className="shrink-0 sm:text-right">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Amount toward limit</p>
                <p className="text-2xl font-bold tabular-nums text-cyan-300">{value(totals.amountTowardLimit)}</p>
              </div>
            </div>

            {totals.turns === 0 && totals.apiCalls === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
                <Database className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-medium">No metered usage in this period</p>
                <p className="mt-1 text-xs text-muted-foreground">Choose a longer period to inspect previous activity.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    ["Turns", totals.turns],
                    ["API calls", totals.apiCalls],
                    ["Successful hops", totals.successfulHops],
                    ["Failed hops", totals.failedHops],
                    ["Billable input", totals.billableInputTokens],
                    ["Cached input", totals.cachedInputTokens],
                    ["Output tokens", totals.outputTokens],
                    ["Raw total tokens", totals.rawTotalTokens],
                  ].map(([label, amount]) => (
                    <div key={label} className="rounded-lg border border-border/60 bg-background/35 p-3">
                      <p className="text-[11px] text-muted-foreground">{label}</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums">{value(amount as number)}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.4fr)]">
                  <div className="rounded-lg border border-border/60 bg-background/35 p-4">
                    <p className="text-xs font-semibold">Canonical formula</p>
                    <p className="mt-2 break-words font-mono text-xs leading-6 text-muted-foreground">
                      upstream input credits ({value(totals.upstreamInputCredits)}) + upstream output credits ({value(totals.upstreamOutputCredits)}) → amount toward limit <strong className="text-foreground">({value(totals.amountTowardLimit)})</strong>
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">Displayed exactly as returned; the dashboard does not recompute the meter.</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/35 p-4">
                    <p className="text-xs text-muted-foreground">Upstream input / output credits</p>
                    <p className="mt-2 text-lg font-semibold tabular-nums">{value(totals.upstreamInputCredits)} <span className="text-muted-foreground">/</span> {value(totals.upstreamOutputCredits)}</p>
                  </div>
                </div>

                {highHop && (
                  <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] p-3 text-amber-100">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <div>
                      <p className="text-xs font-semibold">High-hop activity detected</p>
                      <p className="mt-1 text-xs leading-relaxed text-amber-100/70">
                        {value(totals.successfulHops + totals.failedHops)} upstream hops were recorded for {value(totals.turns)} turns, including {value(totals.failedHops)} failed hops. Retries or fallback routing can make API calls exceed turns.
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid min-w-0 gap-6 xl:grid-cols-2">
                  <BreakdownTable title="By IDE" rows={data.byIde || []} nameKey="label" />
                  <BreakdownTable title="By Model" rows={data.byModel || []} nameKey="model" />
                </div>
              </>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
