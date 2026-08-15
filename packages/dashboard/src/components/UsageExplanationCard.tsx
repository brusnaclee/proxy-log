import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Calculator, RefreshCw } from "lucide-react";
import { keys, type UsageExplanation, type UsageExplanationPeriod, type UsageExplanationRow } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const PERIODS: Array<{ value: UsageExplanationPeriod; label: string }> = [
  { value: "1d", label: "1 day" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

const number = (value: number | null | undefined) => formatNumber(Number(value) || 0);
const inputProcessed = (row: UsageExplanationRow) =>
  (Number(row.billableInputTokens) || 0) + (Number(row.cachedInputTokens) || 0);

function Metric({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${emphasis ? "border-cyan-500/30 bg-cyan-500/[0.07]" : "border-border/60 bg-muted/20"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{number(value)}</p>
    </div>
  );
}

function BreakdownTable({ title, rows, nameKey }: { title: string; rows: UsageExplanationRow[]; nameKey: "label" | "model" }) {
  return (
    <section className="min-w-0" aria-labelledby={`${nameKey}-usage-title`}>
      <h3 id={`${nameKey}-usage-title`} className="mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">No usage in this period.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">{title === "By IDE" ? "IDE" : "Model"}</th>
                <th className="px-3 py-2.5 text-right font-medium">Input processed</th>
                <th className="px-3 py-2.5 text-right font-medium">Output generated</th>
                <th className="px-3 py-2.5 text-right font-semibold">Counted toward limits</th>
                <th className="px-3 py-2.5 text-right font-medium">Prompts / calls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((row, index) => (
                <tr key={`${row[nameKey] || "unknown"}-${index}`} className="hover:bg-muted/20">
                  <td className="max-w-[220px] truncate px-3 py-2.5 font-medium" title={row[nameKey] || "Unknown"}>{row[nameKey] || "Unknown"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{number(inputProcessed(row))}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{number(row.outputTokens)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-cyan-300">{number(row.amountTowardLimit)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{number(row.turns)} / {number(row.apiCalls)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function UsageExplanationCard({ keyId }: { keyId: number }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<UsageExplanationPeriod>("1d");
  const [data, setData] = useState<UsageExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await keys.getUsageExplanation(keyId, period));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load usage calculation.");
    } finally {
      setLoading(false);
    }
  }, [keyId, period]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const totals = data?.totals;
  const totalHops = totals ? totals.successfulHops + totals.failedHops : 0;
  const highHop = Boolean(totals?.turns && (totals.failedHops > 0 || totalHops / totals.turns >= 2));

  return (
    <>
      <Card className="border-border/70">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="rounded-lg bg-cyan-500/10 p-2 text-cyan-400"><Calculator className="h-4 w-4" /></span>
            <div>
              <p className="text-sm font-semibold">How usage is calculated</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                See input, output, prompts, upstream calls, and the canonical amount counted toward limits.
              </p>
            </div>
          </div>
          <Button variant="outline" className="shrink-0" onClick={() => setOpen(true)}>View usage calculation</Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto p-0">
          <DialogHeader className="border-b border-border/60 p-5 pr-12">
            <DialogTitle className="flex items-center gap-2"><Calculator className="h-5 w-5 text-cyan-400" />Usage calculation</DialogTitle>
            <DialogDescription>Canonical backend metering, presented in clear operational terms.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 p-5">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Usage period">
              {PERIODS.map((item) => (
                <Button key={item.value} size="sm" variant={period === item.value ? "default" : "outline"} onClick={() => setPeriod(item.value)} aria-pressed={period === item.value}>
                  {item.label}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading} className="ml-auto">
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh
              </Button>
            </div>

            {loading && !data ? (
              <div className="grid gap-3 sm:grid-cols-3" aria-label="Loading usage calculation">
                {[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-muted/50" />)}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
                <AlertTriangle className="mb-2 h-5 w-5 text-destructive" />
                <p className="text-sm font-medium">Usage calculation unavailable</p>
                <p className="mt-1 text-xs text-muted-foreground">{error}</p>
                <Button size="sm" variant="outline" onClick={() => void load()} className="mt-3">Try again</Button>
              </div>
            ) : totals ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric label="Input processed" value={inputProcessed(totals)} />
                  <Metric label="Output generated" value={totals.outputTokens} />
                  <Metric label="Counted toward limits" value={totals.amountTowardLimit} emphasis />
                </div>
                <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/10 p-4 sm:grid-cols-3">
                  <div><p className="text-xs text-muted-foreground">Limit input</p><p className="font-semibold tabular-nums">{number(totals.upstreamInputCredits)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Limit output</p><p className="font-semibold tabular-nums">{number(totals.upstreamOutputCredits)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Limit total</p><p className="font-semibold tabular-nums">{number(totals.amountTowardLimit)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Prompts</p><p className="font-semibold tabular-nums">{number(totals.turns)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Upstream calls</p><p className="font-semibold tabular-nums">{number(totals.apiCalls)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Cached input</p><p className="font-semibold tabular-nums">{number(totals.cachedInputTokens)}</p></div>
                </div>
                {highHop && (
                  <div className="flex gap-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-4 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <div><p className="font-medium">More upstream calls than prompts</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">A single prompt can involve retries or multiple model steps. Those upstream calls can increase metered usage even when the prompt count stays the same.</p></div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">Backend metered</Badge>
                  <span>Input processed combines billable and cached input for presentation. Limit totals remain canonical backend values.</span>
                </div>
                <div className="grid gap-5 xl:grid-cols-2">
                  <BreakdownTable title="By IDE" rows={data.byIde || []} nameKey="label" />
                  <BreakdownTable title="By Model" rows={data.byModel || []} nameKey="model" />
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No usage data is available for this period.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
