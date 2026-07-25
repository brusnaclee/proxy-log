import { formatNumber, formatInputBreakdown } from "@/lib/utils";
import type { LiveUsagePayload } from "@/lib/api";

function formatReset(iso?: string | null) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `Resets ${hh}:${mm}`;
  } catch {
    return "";
  }
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
  const pools = (dedicatedPools || []).filter((p) => p.limit > 0);

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

  const dailyCap = limits.dailyTokenLimit || 0;
  const dailyLeft = remaining.daily;

  if (limits.promptLimit > 0) {
    bars.push({
      label: `Prompts (${limits.promptLimitWindow})`,
      value: usageToday.promptCount ?? 0,
      max: limits.promptLimit,
      remaining: remaining.prompt,
      sublabel: "1 per user prompt · last window",
      source: sourceLabel(limits.promptLimitSource),
      reset: formatReset(promptResetAt),
    });
  }
  if ((limits.apiCallLimit || 0) > 0) {
    bars.push({
      label: `API calls (${limits.apiCallLimitWindow || "5h"})`,
      value: usageToday.apiCallCount ?? 0,
      max: limits.apiCallLimit,
      remaining: remaining.apiCalls ?? null,
      sublabel:
        (usageToday.hopCount || 0) > 0
          ? `${formatNumber(usageToday.apiCallCount ?? 0)} in window · ${formatNumber(usageToday.hopCount || 0)} hops today`
          : "every upstream hop · last window",
      source: sourceLabel(limits.apiCallLimitSource),
      reset: formatReset(apiCallResetAt),
    });
  }
  if (limits.dailyInputTokenLimit > 0 || (dailyTokenBreakdown?.bypassIo && (dailyTokenBreakdown.inputBase || 0) > 0)) {
    const softMax = dailyTokenBreakdown?.bypassIo
      ? dailyTokenBreakdown.inputBase || limits.dailyInputTokenLimit
      : limits.dailyInputTokenLimit;
    const used = usageToday.promptTokens;
    const overSoft = !!(dailyTokenBreakdown?.bypassIo && softMax > 0 && used > softMax);
    const softLeft = Math.max(0, softMax - used);
    const ctx = Number(usageToday.cachedTokens) || 0;
    const inp = Number(usageToday.billablePromptTokens) || 0;
    const ctxInNote =
      ctx > 0 || inp > 0
        ? `context ${formatNumber(ctx)} + input ${formatNumber(inp)}`
        : "limit credit";
    bars.push({
      label: "Input Tokens (limit)",
      value: used,
      max: softMax,
      remaining: dailyTokenBreakdown?.bypassIo ? null : remaining.input,
      softMode: !!dailyTokenBreakdown?.bypassIo,
      sublabel:
        (dailyTokenBreakdown?.bypassIo
          ? `exceed OK until daily ${formatNumber(dailyCap)} · `
          : "") + ctxInNote,
      source: dailyTokenBreakdown?.bypassIo
        ? "add-on extends past soft"
        : sourceLabel(limits.dailyInputTokenLimitSource),
      footerLeft: dailyTokenBreakdown?.bypassIo
        ? overSoft
          ? `Exceeding soft · Daily remaining: ${dailyLeft != null ? formatNumber(dailyLeft) : "—"} / ${formatNumber(dailyCap)}`
          : `Soft left: ${formatNumber(softLeft)} · then exceed until daily ${formatNumber(dailyCap)}`
        : undefined,
      reset: formatReset(dailyResetAt),
    });
  }
  if (limits.dailyOutputTokenLimit > 0 || (dailyTokenBreakdown?.bypassIo && (dailyTokenBreakdown.outputBase || 0) > 0)) {
    const softMax = dailyTokenBreakdown?.bypassIo
      ? dailyTokenBreakdown.outputBase || limits.dailyOutputTokenLimit
      : limits.dailyOutputTokenLimit;
    const used = usageToday.completionTokens;
    const overSoft = !!(dailyTokenBreakdown?.bypassIo && softMax > 0 && used > softMax);
    const softLeft = Math.max(0, softMax - used);
    bars.push({
      label: "Output Tokens",
      value: used,
      max: softMax,
      remaining: dailyTokenBreakdown?.bypassIo ? null : remaining.output,
      softMode: !!dailyTokenBreakdown?.bypassIo,
      sublabel: dailyTokenBreakdown?.bypassIo
        ? `exceed OK until daily ${formatNumber(dailyCap)}`
        : "tokens",
      source: dailyTokenBreakdown?.bypassIo
        ? "add-on extends past soft"
        : sourceLabel(limits.dailyOutputTokenLimitSource),
      footerLeft: dailyTokenBreakdown?.bypassIo
        ? overSoft
          ? `Exceeding soft · Daily remaining: ${dailyLeft != null ? formatNumber(dailyLeft) : "—"} / ${formatNumber(dailyCap)}`
          : `Soft left: ${formatNumber(softLeft)} · then exceed until daily ${formatNumber(dailyCap)}`
        : undefined,
      reset: formatReset(dailyResetAt),
    });
  }
  if (limits.dailyTokenLimit > 0) {
    const bd = dailyTokenBreakdown;
    let stack = "tokens";
    if (bd && bd.addonBonus > 0) {
      if ((bd.inputBase || 0) > 0 || (bd.outputBase || 0) > 0) {
        stack = `in ${formatNumber(bd.inputBase || 0)} + out ${formatNumber(bd.outputBase || 0)} + pack ${formatNumber(bd.addonBonus)}`;
      } else {
        stack = `base ${formatNumber(bd.base)} + pack ${formatNumber(bd.addonBonus)}`;
      }
    }
    bars.push({
      label: "Daily Total",
      value: usageToday.totalTokens,
      max: limits.dailyTokenLimit,
      remaining: remaining.daily,
      sublabel: stack,
      source:
        bd && bd.addonBonus > 0
          ? "base + add-on"
          : sourceLabel(limits.dailyTokenLimitSource),
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
            }
            if ((p.outputLimit || 0) > 0) {
              ioBits.push(`Out ${formatNumber(p.outputUsed || 0)}/${formatNumber(p.outputLimit || 0)}`);
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
      {(usageToday.fullInputTokens || 0) > (usageToday.promptTokens || 0) * 1.5 && (
        <p className="text-[10px] text-muted-foreground leading-relaxed border-t border-border/40 pt-2">
          Daily token limit: input bar = hop schedule from Settings (default hop1=100%, later=flat %). Output always 100%.
          Limit In {formatNumber(usageToday.promptTokens)}
          {(usageToday as any).peakPromptTokens
            ? `; peak-view ${formatNumber((usageToday as any).peakPromptTokens)}`
            : ""}
          ; amanai-style full In {formatNumber(usageToday.fullInputTokens || 0)} (admin only). Prompts/API bars = sliding last{" "}
          {limits.promptLimitWindow || "5h"} (not calendar day). Today:{" "}
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
              <span className="font-mono text-foreground truncate flex-1">{m.model}</span>
              <span
                className={
                  m.limit > 0 && m.used >= m.limit ? "text-red-400 shrink-0" : "text-muted-foreground shrink-0"
                }
              >
                {m.used} / {m.limit > 0 ? m.limit : "∞"}
                {m.remaining != null ? ` · ${m.remaining} left` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
