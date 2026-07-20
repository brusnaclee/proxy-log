import { formatNumber } from "@/lib/utils";
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
  const { limits, usageToday, usageMonth, remaining, dailyResetAt, monthlyResetAt, scope, accountKeyCount } =
    live;

  const bars: Array<{
    label: string;
    value: number;
    max: number;
    remaining: number | null;
    source?: string;
    reset?: string;
  }> = [];

  if (limits.dailyInputTokenLimit > 0) {
    bars.push({
      label: "Input Tokens",
      value: usageToday.promptTokens,
      max: limits.dailyInputTokenLimit,
      remaining: remaining.input,
      source: sourceLabel(limits.dailyInputTokenLimitSource),
      reset: formatReset(dailyResetAt),
    });
  }
  if (limits.dailyOutputTokenLimit > 0) {
    bars.push({
      label: "Output Tokens",
      value: usageToday.completionTokens,
      max: limits.dailyOutputTokenLimit,
      remaining: remaining.output,
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
      source: sourceLabel(limits.monthlyTokenLimitSource),
      reset: formatReset(monthlyResetAt),
    });
  }

  if (compact) {
    const chips: string[] = [];
    if (remaining.input != null) chips.push(`In ${formatNumber(remaining.input)} left`);
    if (remaining.output != null) chips.push(`Out ${formatNumber(remaining.output)} left`);
    if (remaining.daily != null && remaining.input == null && remaining.output == null) {
      chips.push(`${formatNumber(remaining.daily)} daily left`);
    }
    if (!chips.length) {
      chips.push(
        `Today ${formatNumber(usageToday.promptTokens)} in / ${formatNumber(usageToday.completionTokens)} out`,
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
        <span className="text-foreground/80">{chips.join(" · ")}</span>
        <span>
          · used {formatNumber(usageToday.totalTokens)} today
          {scope === "account" && accountKeyCount > 1 ? ` · ${accountKeyCount} keys` : ""}
        </span>
      </div>
    );
  }

  if (!bars.length) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Usage Today</h3>
          <span className="text-[10px] text-muted-foreground">
            {scope === "account" ? `Account · ${accountKeyCount} key(s)` : "This key only"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          No daily/monthly token limits configured (key or global). Today:{" "}
          <span className="text-foreground font-mono">
            {formatNumber(usageToday.promptTokens)} in / {formatNumber(usageToday.completionTokens)} out
          </span>{" "}
          ({formatNumber(usageToday.requests)} requests).
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Usage Today</h3>
        <span className="text-[10px] text-muted-foreground">
          {scope === "account"
            ? `Shared across Discord account · ${accountKeyCount} key(s)`
            : "This key only"}
          {" · "}
          {formatReset(dailyResetAt)}
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
            sublabel="tokens"
            source={b.source}
            reset={b.reset}
          />
        ))}
      </div>
    </div>
  );
}
