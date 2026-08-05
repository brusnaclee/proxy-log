import { formatNumber, formatInputBreakdown } from "@/lib/utils";
import type { LiveUsagePayload } from "@/lib/api";

function formatReset(iso?: string | null, windowFallback?: string | null) {
  if (iso) {
    try {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) {
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        const diffMs = d.getTime() - Date.now();
        let rel = "";
        if (diffMs > 60_000) {
          const mins = Math.round(diffMs / 60_000);
          rel = mins < 60 ? ` · in ${mins}m` : ` · in ${(mins / 60).toFixed(mins % 60 === 0 ? 0 : 1)}h`;
        } else if (diffMs > 0) {
          rel = " · soon";
        }
        return `Resets ${hh}:${mm}${rel}`;
      }
    } catch {
      /* fall through */
    }
  }
  if (windowFallback) return `Resets ${windowFallback} after first use`;
  return "";
}

function sourceLabel(src?: string) {
  if (src === "override") return "key override";
  if (src === "global") return "global";
  if (src === "addon") return "base + add-on";
  return "";
}

function ProgressBar({
  label,
  value,
  max,
  remaining,
  sublabel,
  source,
  reset,
  footerLeft,
  softMode,
}: {
  label: string;
  value: number;
  max: number;
  remaining: number | null;
  sublabel?: string;
  source?: string;
  reset?: string;
  /** Override the default Remaining / No limit line */
  footerLeft?: string;
  /** Soft base + exceed-until-daily mode (add-on) */
  softMode?: boolean;
}) {
  const overSoft = softMode && max > 0 && value > max;
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const danger = !softMode && pct > 85;
  const warn = softMode ? overSoft || pct > 85 : pct > 65;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className={danger ? "text-red-400" : warn ? "text-amber-400" : "text-foreground"}>
          {formatNumber(value)} / {formatNumber(max)}
          {softMode && <span className="text-muted-foreground ml-1">soft</span>}
          {overSoft && (
            <span className="text-amber-400 ml-1">
              · +{formatNumber(value - max)} exceed
            </span>
          )}
          {sublabel && <span className="text-muted-foreground ml-1">{sublabel}</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            danger ? "bg-red-400" : warn ? "bg-amber-400" : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {footerLeft != null ? (
            footerLeft
          ) : remaining != null ? (
            <>
              Remaining: <span className="text-foreground font-medium">{formatNumber(remaining)}</span>
            </>
          ) : (
            "No limit"
          )}
          {source ? ` · ${source}` : ""}
        </span>
        {reset && <span>{reset}</span>}
      </div>
    </div>
  );
}

/** Portal-parity live usage card for admin key detail / list headers. */
export function LiveUsageCard({
  live,
  compact = false,
}: {
  live: LiveUsagePayload | null | undefined;
  compact?: boolean;
}) {
  if (!live) return null;
  const {
    limits,
    usageToday,
    usageMonth,
    remaining,
    dailyResetAt,
    monthlyResetAt,
    promptResetAt,
    apiCallResetAt,
    scope,
    accountKeyCount,
    modelUsageLimits,
    dailyTokenBreakdown,
    activeAddons,
    addonModelTokenCaps,
    perModelPromptsBypassedByAddon,
    dedicatedPools,
  } = live;
  const pools = live.blockedWithoutAddon
    ? []
    : (dedicatedPools || []).filter((p) => p.limit > 0);

  const bars: Array<{
    label: string;
    value: number;
    max: number;
    remaining: number | null;
    sublabel?: string;
    source?: string;
    reset?: string;
    softMode?: boolean;
    footerLeft?: string;
  }> = [];

  if (limits.promptLimit > 0) {
    bars.push({
      label: `Prompts (${limits.promptLimitWindow})`,
      value: usageToday.promptCount ?? 0,
      max: limits.promptLimit,
      remaining: remaining.prompt,
      sublabel: "1 per user prompt · last window",
      source: sourceLabel(limits.promptLimitSource),
      reset: formatReset(promptResetAt, limits.promptLimitWindow),
    });
  }
  if ((limits.apiCallLimit || 0) > 0) {
    bars.push({
      label: `API calls (${limits.apiCallLimitWindow || "5h"})`,
      value: usageToday.apiCallCount ?? 0,
      max: limits.apiCallLimit || 0,
      remaining: remaining.apiCalls ?? null,
      sublabel:
        (usageToday.hopCount || 0) > 0
          ? `${formatNumber(usageToday.apiCallCount ?? 0)} in window · ${formatNumber(usageToday.hopCount || 0)} hops today`
          : "every upstream hop · last window",
      source: sourceLabel(limits.apiCallLimitSource),
      reset: formatReset(apiCallResetAt, limits.apiCallLimitWindow || "5h"),
    });
  }
  if (limits.dailyInputTokenLimit > 0) {
    const used = usageToday.promptTokens;
    const max = limits.dailyInputTokenLimit;
    const ib = live.inputBreakdown;
    const bd = dailyTokenBreakdown;
    let stackNote = "toward daily limit (hop-weighted)";
    if (ib && ib.apiCallCount > 0) {
      stackNote =
        `${ib.promptCount} prompts × ~${formatNumber(ib.avgInPerPrompt)} @100%` +
        ` + ${ib.followUpCount} follow-ups × ~${formatNumber(ib.avgInPerFollowUp)} @${ib.weightPercent}%` +
        (ib.peakFullIn > 0 ? ` · chat peak ~${formatNumber(ib.peakFullIn)} (info)` : "");
    }
    if (bd && bd.addonBonus > 0) {
      stackNote = `base ${formatNumber(bd.inputBase || bd.base || 0)} + pack ${formatNumber(bd.addonBonus)} · ${stackNote}`;
    }
    bars.push({
      label: "Input Tokens (limit)",
      value: used,
      max,
      remaining: remaining.input,
      softMode: false,
      sublabel: stackNote,
      source:
        bd && bd.addonBonus > 0
          ? "base + pack → input"
          : sourceLabel(limits.dailyInputTokenLimitSource),
      reset: formatReset(dailyResetAt),
    });
  }
  if (limits.dailyOutputTokenLimit > 0) {
    const used = usageToday.completionTokens;
    bars.push({
      label: "Output Tokens",
      value: used,
      max: limits.dailyOutputTokenLimit,
      remaining: remaining.output,
      softMode: false,
      sublabel: "always 100% (no hop weight)",
      source: sourceLabel(limits.dailyOutputTokenLimitSource),
      reset: formatReset(dailyResetAt),
    });
  }
  if (limits.dailyTokenLimit > 0) {
    bars.push({
      label: "Daily Total",
      value: usageToday.totalTokens,
      max: limits.dailyTokenLimit,
      remaining: remaining.daily,
      sublabel: "custom key daily",
      source: sourceLabel(limits.dailyTokenLimitSource),
      reset: formatReset(dailyResetAt),
    });
  }
  if (limits.monthlyTokenLimit > 0) {
    bars.push({
      label: "Monthly Total",
      value: usageMonth.totalTokens,
      max: limits.monthlyTokenLimit,
      remaining: remaining.monthly,
      sublabel: "tokens",
      source: sourceLabel(limits.monthlyTokenLimitSource),
      reset: formatReset(monthlyResetAt),
    });
  }

  const modelLimits = (perModelPromptsBypassedByAddon
    ? []
    : modelUsageLimits || []
  ).filter((m) => m.limit > 0 || m.used > 0);

  if (compact) {
    const chips: string[] = [];
    if (remaining.prompt != null) {
      chips.push(`Prompts ${formatNumber(remaining.prompt)} left (${limits.promptLimitWindow})`);
    }
    if (remaining.apiCalls != null) {
      chips.push(`API calls ${formatNumber(remaining.apiCalls)} left (${limits.apiCallLimitWindow || "5h"})`);
    }
    if (remaining.input != null) chips.push(`In ${formatNumber(remaining.input)} left`);
    if (remaining.output != null) chips.push(`Out ${formatNumber(remaining.output)} left`);
    if (remaining.daily != null && remaining.input == null && remaining.output == null) {
      chips.push(`${formatNumber(remaining.daily)} daily left`);
    }
    if (!chips.length) {
      const inLabel = formatInputBreakdown(
        usageToday.billablePromptTokens,
        usageToday.cachedTokens,
        usageToday.promptTokens,
      ).compact;
      chips.push(
        `Today ${inLabel} in / ${formatNumber(usageToday.completionTokens)} out`,
      );
    }
    const overrideBits: string[] = [];
    if (limits.promptLimitSource === "override") overrideBits.push("prompt");
    if (limits.dailyInputTokenLimitSource === "override") overrideBits.push("in");
    if (limits.dailyOutputTokenLimitSource === "override") overrideBits.push("out");
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
        <span className="text-foreground/80">{chips.join(" · ")}</span>
        <span>
          · used {formatNumber(usageToday.totalTokens)} today
          {scope === "account" && accountKeyCount > 1 ? ` · ${accountKeyCount} keys` : ""}
          {overrideBits.length > 0 ? ` · override: ${overrideBits.join("/")}` : ""}
        </span>
      </div>
    );
  }

  if (!bars.length && !modelLimits.length && !pools.length) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Usage Today</h3>
          <span className="text-[10px] text-muted-foreground">
            {scope === "account" ? `Account · ${accountKeyCount} key(s)` : "This key only"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          No prompt/token limits configured on this key (or global). Today:{" "}
          <span className="text-foreground font-mono">
            {formatInputBreakdown(
              usageToday.billablePromptTokens,
              usageToday.cachedTokens,
              usageToday.promptTokens,
            ).label}{" "}
            in / {formatNumber(usageToday.completionTokens)} out
          </span>{" "}
          ({formatNumber(usageToday.requests)} prompts
          {(usageToday.hopCount || 0) > 0
            ? ` · ${formatNumber(usageToday.hopCount || 0)} API calls`
            : ""}
          {(usageToday.fullInputTokens || 0) > (usageToday.promptTokens || 0) * 1.5
            ? ` · full In ${formatNumber(usageToday.fullInputTokens || 0)}`
            : ""}
          ).
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Usage Today</h3>
        <span className="text-[10px] text-muted-foreground text-right">
          Limits from this key
          {scope === "account"
            ? ` · usage shared across ${accountKeyCount} Discord key(s)`
            : " · this key only"}
        </span>
      </div>
      <div className="space-y-3">
        {bars.map((b) => (
          <ProgressBar
            key={b.label}
            label={b.label}
            value={b.value}
            max={b.max}
            remaining={b.remaining}
            sublabel={b.sublabel}
            source={b.source}
            reset={b.reset}
            softMode={b.softMode}
            footerLeft={b.footerLeft}
          />
        ))}
      </div>
      {pools.length > 0 && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 space-y-2 text-xs">
          <p className="font-medium text-foreground">Dedicated model pools</p>
          <p className="text-[10px] text-muted-foreground">
            Outside account daily / input / output
          </p>
          {pools.map((p) => {
            const ioBits: string[] = [];
            if ((p.inputLimit || 0) > 0) {
              ioBits.push(`In ${formatNumber(p.inputUsed || 0)}/${formatNumber(p.inputLimit || 0)}`);
            } else if ((p.inputUsed || 0) > 0) {
              ioBits.push(`In (limit) ${formatNumber(p.inputUsed || 0)}`);
            }
            if ((p.outputLimit || 0) > 0) {
              ioBits.push(`Out ${formatNumber(p.outputUsed || 0)}/${formatNumber(p.outputLimit || 0)}`);
            } else if ((p.outputUsed || 0) > 0) {
              ioBits.push(`Out ${formatNumber(p.outputUsed || 0)}`);
            }
            if ((p.fullInputTokens || 0) > 0) {
              ioBits.push(`full In ${formatNumber(p.fullInputTokens || 0)} (amanai)`);
            }
            return (
              <ProgressBar
                key={`${p.scope}:${p.model}:${p.isPattern}`}
                label={`${p.model}${p.isPattern ? " (pattern)" : ""} · ${p.scope}`}
                value={p.used}
                max={p.limit}
                remaining={p.remaining}
                sublabel={ioBits.length ? ioBits.join(" · ") : "total (in+out) limit credit"}
                reset={formatReset(p.resetAt)}
              />
            );
          })}
        </div>
      )}
      {(activeAddons && activeAddons.length > 0) && (
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1.5 text-xs">
          <p className="font-medium text-foreground">Active add-on</p>
          {activeAddons.map((a) => (
            <div key={a.name} className="flex justify-between gap-2 text-muted-foreground">
              <span className="font-mono text-foreground">{a.name}</span>
              <span>
                +{formatNumber(a.dailyTokenLimit)}/day
                {a.expiresAt ? ` · exp ${new Date(a.expiresAt).toLocaleDateString()}` : ""}
              </span>
            </div>
          ))}
          {dailyTokenBreakdown && dailyTokenBreakdown.addonBonus > 0 && (
            <p className="text-muted-foreground">
              Daily stack:{" "}
              {(dailyTokenBreakdown.inputBase || 0) > 0 || (dailyTokenBreakdown.outputBase || 0) > 0 ? (
                <>
                  in {formatNumber(dailyTokenBreakdown.inputBase || 0)} + out{" "}
                  {formatNumber(dailyTokenBreakdown.outputBase || 0)} + pack{" "}
                  {formatNumber(dailyTokenBreakdown.addonBonus)} ={" "}
                </>
              ) : (
                <>
                  {formatNumber(dailyTokenBreakdown.base)} + {formatNumber(dailyTokenBreakdown.addonBonus)} ={" "}
                </>
              )}
              <span className="text-foreground font-medium">{formatNumber(dailyTokenBreakdown.effective)}</span>
            </p>
          )}
          {perModelPromptsBypassedByAddon && (
            <p className="text-[10px] text-muted-foreground">
              Per-model prompt caps bypassed · Input/Output soft base can exceed via add-on until Daily Total · global Prompts still apply
            </p>
          )}
          {(addonModelTokenCaps || []).length > 0 && (
            <div className="pt-1 space-y-0.5">
              <p className="text-[10px] text-muted-foreground">Pack token subcaps</p>
              {addonModelTokenCaps!.map((c) => (
                <div key={c.pattern} className="flex justify-between font-mono text-[10px]">
                  <span>{c.pattern}</span>
                  <span>{formatNumber(c.dailyLimit)}/day</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {(usageToday.fullInputTokens || 0) > 0 && (
        <p className="text-[10px] text-muted-foreground leading-relaxed border-t border-border/40 pt-2">
          Admin note — Input bar = hop-weighted <span className="text-foreground">toward limit</span>{" "}
          ({formatNumber(usageToday.promptTokens)}; hop1=100%, hops 2+=
          {live.inputBreakdown?.weightPercent ?? "—"}%).
          Output always 100%.{" "}
          Chat peak is informational and does <span className="text-foreground">not</span> sum into the limit number.
          {live.inputBreakdown?.peakFullIn
            ? ` Typical peak ~${formatNumber(live.inputBreakdown.peakFullIn)}.`
            : ""}{" "}
          Prompts/API bars = <span className="text-foreground">fixed window</span> from first request
          (cliff reset to 0 after {limits.promptLimitWindow || "5h"}). Today:{" "}
          {formatNumber(usageToday.requests)} prompts · {formatNumber(usageToday.hopCount || 0)} API hops.
        </p>
      )}
      {modelLimits.length > 0 && (
        <div className="pt-2 border-t border-border/50 space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Per-model prompt
            {limits.perModelPromptLimitSource !== "none"
              ? ` · ${sourceLabel(limits.perModelPromptLimitSource)} default ${formatNumber(limits.perModelPromptLimit)}/${limits.perModelPromptLimitWindow}`
              : ""}
          </p>
          {modelLimits.slice(0, 8).map((m) => (
            <div key={m.model} className="flex items-center justify-between text-xs gap-2">
              <span className="font-mono text-foreground truncate flex-1 min-w-0">{m.model}</span>
              <span
                className={
                  m.limit > 0 && m.used >= m.limit
                    ? "text-red-400 shrink-0 text-right"
                    : "text-muted-foreground shrink-0 text-right"
                }
              >
                {m.used} / {m.limit > 0 ? m.limit : "∞"}
                {m.remaining != null ? ` · ${m.remaining} left` : ""}
                {(() => {
                  // Per-model = 00:00 WIB (same as daily tokens), not rolling "after first use"
                  const r = formatReset(m.resetAt || dailyResetAt);
                  return r ? ` · ${r}` : "";
                })()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
