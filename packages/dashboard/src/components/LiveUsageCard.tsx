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
}: {
  label: string;
  value: number;
  max: number;
  remaining: number | null;
  sublabel?: string;
  source?: string;
  reset?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const danger = pct > 85;
  const warn = pct > 65;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className={danger ? "text-red-400" : warn ? "text-yellow-400" : "text-foreground"}>
          {formatNumber(value)} / {formatNumber(max)}
          {sublabel && <span className="text-muted-foreground ml-1">{sublabel}</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            danger ? "bg-red-400" : warn ? "bg-yellow-400" : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {remaining != null ? (
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
  } = live;

  const bars: Array<{
    label: string;
    value: number;
    max: number;
    remaining: number | null;
    sublabel?: string;
    source?: string;
    reset?: string;
  }> = [];

  if (limits.promptLimit > 0) {
    bars.push({
      label: `Prompts (${limits.promptLimitWindow})`,
      value: usageToday.promptCount ?? 0,
      max: limits.promptLimit,
      remaining: remaining.prompt,
      sublabel: "1 per user prompt",
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
          ? `${formatNumber(usageToday.hopCount || 0)} hops today`
          : "every upstream hop",
      source: sourceLabel(limits.apiCallLimitSource),
      reset: formatReset(apiCallResetAt),
    });
  }
  if (limits.dailyInputTokenLimit > 0 && !(dailyTokenBreakdown?.bypassIo)) {
    const inputBd = formatInputBreakdown(
      usageToday.billablePromptTokens,
      usageToday.cachedTokens,
      usageToday.promptTokens,
    );
    const full = Number(usageToday.fullInputTokens) || 0;
    const peak = Number(usageToday.promptTokens) || 0;
    const fullNote =
      full > peak * 1.5
        ? ` · full ${formatNumber(full)} (amanai-style)`
        : "";
    bars.push({
      label: "Input Tokens (peak)",
      value: usageToday.promptTokens,
      max: limits.dailyInputTokenLimit,
      remaining: remaining.input,
      sublabel:
        (inputBd.label !== inputBd.total ? inputBd.label : "tokens") + fullNote,
      source: sourceLabel(limits.dailyInputTokenLimitSource),
      reset: formatReset(dailyResetAt),
    });
  }
  if (limits.dailyOutputTokenLimit > 0 && !(dailyTokenBreakdown?.bypassIo)) {
    bars.push({
      label: "Output Tokens",
      value: usageToday.completionTokens,
      max: limits.dailyOutputTokenLimit,
      remaining: remaining.output,
      sublabel: "tokens",
      source: sourceLabel(limits.dailyOutputTokenLimitSource),
      reset: formatReset(dailyResetAt),
    });
  }
  if (limits.dailyTokenLimit > 0) {
    const stack =
      dailyTokenBreakdown && dailyTokenBreakdown.addonBonus > 0
        ? `base ${formatNumber(dailyTokenBreakdown.base)} + pack ${formatNumber(dailyTokenBreakdown.addonBonus)}`
        : "tokens";
    bars.push({
      label: "Daily Total",
      value: usageToday.totalTokens,
      max: limits.dailyTokenLimit,
      remaining: remaining.daily,
      sublabel: stack,
      source:
        dailyTokenBreakdown && dailyTokenBreakdown.addonBonus > 0
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

  if (!bars.length && !modelLimits.length) {
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
          />
        ))}
      </div>
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
              Daily stack: {formatNumber(dailyTokenBreakdown.base)} + {formatNumber(dailyTokenBreakdown.addonBonus)} ={" "}
              <span className="text-foreground font-medium">{formatNumber(dailyTokenBreakdown.effective)}</span>
            </p>
          )}
          {perModelPromptsBypassedByAddon && (
            <p className="text-[10px] text-muted-foreground">
              Per-model prompt caps bypassed · Input/Output unlimited while add-on active · global Prompts still apply · daily pool only
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
          Daily token limit: first hop of each prompt at 100% In+Out (cache included); later tool hops at Settings weight % (default 10%). Logs still store 100%.
          Peak display {formatNumber(usageToday.promptTokens)}; amanai-style full In{" "}
          {formatNumber(usageToday.fullInputTokens || 0)}. API calls{" "}
          {formatNumber(usageToday.hopCount || 0)}; prompts {formatNumber(usageToday.requests)}.
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
