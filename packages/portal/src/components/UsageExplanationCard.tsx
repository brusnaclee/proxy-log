import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CircleHelp, RefreshCw, X } from "lucide-react";
import { api, type UsageExplanationBreakdown, type UsageExplanationPeriod, type UsageExplanationResponse } from "@/lib/api";
import { formatNumber } from "@/lib/utils";

const PERIODS: Array<{ value: UsageExplanationPeriod; label: string }> = [
  { value: "1d", label: "1 day" }, { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" },
];

const value = (row: UsageExplanationBreakdown, key: keyof UsageExplanationBreakdown) =>
  typeof row[key] === "number" ? row[key] as number : 0;
const inputProcessed = (row: UsageExplanationBreakdown) =>
  value(row, "rawBillableInput") + value(row, "cachedInput");

function BreakdownTable({ rows, kind }: { rows: UsageExplanationBreakdown[]; kind: "IDE" | "Model" }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">No {kind.toLowerCase()} usage in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead><tr className="border-b border-border text-left text-xs text-muted-foreground">
          <th className="pb-2 font-medium">{kind}</th><th className="pb-2 text-right font-medium">Prompts</th>
          <th className="pb-2 text-right font-medium">Upstream calls</th><th className="pb-2 text-right font-medium">Input processed</th>
          <th className="pb-2 text-right font-medium">Output generated</th><th className="pb-2 text-right font-medium">Counted toward limits</th>
        </tr></thead>
        <tbody>{rows.map((row, index) => {
          const label = row.ide ?? row.model ?? row.name ?? row.label ?? `Unknown ${kind}`;
          const c = row.composition;
          return <tr key={`${label}-${index}`} className="border-b border-border/60 last:border-0">
            <td className="py-3 font-medium text-foreground">{label}</td>
            <td className="py-3 text-right tabular-nums">{formatNumber(value(row, "turns"))}</td>
            <td className="py-3 text-right tabular-nums">{formatNumber(value(row, "apiCalls") || value(row, "hops"))}</td>
            <td className="py-3 text-right tabular-nums">{formatNumber(inputProcessed(row))}</td>
            <td className="py-3 text-right tabular-nums">{formatNumber(value(row, "output"))}</td>
            <td className="py-3 text-right font-medium tabular-nums text-primary">
              <div>{formatNumber(value(row, "amountTowardLimit"))}</div>
              <div className="mt-0.5 whitespace-nowrap text-[10px] font-normal text-muted-foreground">
                In {formatNumber(value(row, "inputTowardLimit"))} · Out {formatNumber(value(row, "outputTowardLimit"))}
              </div>
              {c && <div className="mt-0.5 whitespace-nowrap text-[10px] font-normal text-muted-foreground">
                Credits {formatNumber(c.upstreamInputBeforeWeight)} in · {formatNumber(c.upstreamOutputBeforeWeight)} out
              </div>}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

export function UsageExplanationCard() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<UsageExplanationPeriod>("7d");
  const [data, setData] = useState<UsageExplanationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"ide" | "model">("ide");
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKey); triggerRef.current?.focus(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true); setError("");
    api.usage.explanation(period).then((result) => { if (current) setData(result); })
      .catch((err) => { if (current) setError(err instanceof Error ? err.message : "Could not load usage details."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [open, period]);

  const close = () => setOpen(false);
  return <>
    <button ref={triggerRef} type="button" onClick={() => setOpen(true)}
      className="group flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <span className="flex min-w-0 items-center gap-3"><span className="rounded-lg bg-primary/10 p-2 text-primary"><CircleHelp className="h-4 w-4" /></span>
        <span><span className="block text-sm font-medium text-foreground">How your usage is counted</span>
        <span className="block text-xs text-muted-foreground">Input, output, prompts, and upstream calls explained</span></span></span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>

    {open && <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close usage details" onClick={close} />
      <section role="dialog" aria-modal="true" aria-labelledby="usage-dialog-title"
        className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:max-w-5xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <div><h2 id="usage-dialog-title" className="text-lg font-semibold text-foreground">How your usage is counted</h2>
            <p className="mt-1 text-sm text-muted-foreground">A transparent view of the canonical usage recorded by the service.</p></div>
          <button ref={closeRef} onClick={close} className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label="Close dialog"><X className="h-5 w-5" /></button>
        </header>
        <div className="overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1" aria-label="Usage period">
              {PERIODS.map(option => <button key={option.value} onClick={() => setPeriod(option.value)} aria-pressed={period === option.value}
                className={`min-h-9 flex-1 rounded-md px-3 text-xs font-medium sm:flex-none ${period === option.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent"}`}>{option.label}</button>)}
            </div>
            {data && <p className="text-xs text-muted-foreground">Rolling range: <span className="font-medium text-foreground">{new Date(data.from).toLocaleString()}</span> – <span className="font-medium text-foreground">{new Date(data.to).toLocaleString()}</span> ({data.timezone})</p>}
          </div>
          {loading ? <div className="space-y-3" aria-busy="true"><div className="h-36 animate-pulse rounded-xl bg-muted" /><div className="h-52 animate-pulse rounded-xl bg-muted" /></div>
          : error ? <div className="flex flex-col items-center rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-10 text-center"><AlertTriangle className="mb-3 h-6 w-6 text-red-400" /><p className="text-sm text-foreground">{error}</p><button onClick={() => { setOpen(false); requestAnimationFrame(() => setOpen(true)); }} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><RefreshCw className="h-4 w-4" />Retry</button></div>
          : data && <div className="space-y-5">
            <section className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Counted toward limits</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-background/70 p-4"><p className="text-xs text-muted-foreground">Input counted</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.towardLimit.input)}</p></div>
                <div className="rounded-lg border border-border bg-background/70 p-4"><p className="text-xs text-muted-foreground">Output counted</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.towardLimit.output)}</p></div>
              </div>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Upstream-metered path ({formatNumber(data.composition.creditHops)} calls):</span>{" "}
                  {formatNumber(data.composition.creditBillableInputTokens + data.composition.creditCachedInputTokens)} processed input tokens
                  {" "}were reported as {formatNumber(data.composition.upstreamInputBeforeWeight)} input credit units;
                  {" "}{formatNumber(data.composition.creditOutputTokens)} generated output tokens were reported as {formatNumber(data.composition.upstreamOutputBeforeWeight)} output credit units.
                </p>
                {data.composition.localHops > 0 && <p>
                  <span className="font-medium text-foreground">Local fallback path ({formatNumber(data.composition.localHops)} calls):</span>{" "}
                  {formatNumber(data.composition.localBillableInputTokens + data.composition.localCachedInputTokens)} processed input tokens became
                  {" "}{formatNumber(data.composition.localInputBeforeWeight)} input units after model multipliers;
                  {" "}{formatNumber(data.composition.localOutputTokens)} output tokens became {formatNumber(data.composition.localOutputBeforeWeight)} output units.
                </p>}
                <p>
                  <span className="font-medium text-foreground">Hop weighting:</span> first call per prompt is 100%
                  {data.composition.inputHopWeightMode === "first_rest_flat" ? `; later calls are ${data.composition.followUpInputWeightPercent}%` : ""}.
                  {" "}Final: {formatNumber(data.towardLimit.input)} input counted + {formatNumber(data.towardLimit.output)} output counted = {formatNumber(data.towardLimit.total)} toward limits.
                </p>
              </div>
            </section>
            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border p-4"><p className="text-sm font-medium">Input processed</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(data.totals.rawBillableInput + data.totals.cachedInput)}</p><p className="mt-2 text-xs text-muted-foreground">Billable input ({formatNumber(data.totals.rawBillableInput)}) + cached input ({formatNumber(data.totals.cachedInput)}).</p></div>
              <div className="rounded-xl border border-border p-4"><p className="text-sm font-medium">Output generated</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(data.totals.output)}</p><p className="mt-2 text-xs text-muted-foreground">Tokens generated by models. Kept separate from input.</p></div>
            </section>
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground"><strong className="text-foreground">Prompts vs upstream calls:</strong> A prompt is one request from your IDE. One prompt can create multiple upstream calls (hops), for example when retries or routing occur. Total traffic is {formatNumber(data.totals.total)} input + output tokens; it is context only, not a quota value.</div>
            <section className="rounded-xl border border-border p-4">
              <div className="mb-4 flex gap-1 border-b border-border">{(["ide", "model"] as const).map(item => <button key={item} onClick={() => setTab(item)} className={`border-b-2 px-3 pb-2 text-sm font-medium ${tab === item ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>By {item === "ide" ? "IDE" : "Model"}</button>)}</div>
              <BreakdownTable rows={tab === "ide" ? data.byIde : data.byModel} kind={tab === "ide" ? "IDE" : "Model"} />
            </section>
          </div>}
        </div>
      </section>
    </div>}
  </>;
}
