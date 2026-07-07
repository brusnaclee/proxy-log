import { cn } from "@/lib/utils";

export type PeriodKey = "today" | "3d" | "7d" | "30d" | "thisMonth" | "lastMonth" | "allTime";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "today",     label: "Today" },
  { key: "3d",        label: "3 Days" },
  { key: "7d",        label: "7 Days" },
  { key: "30d",       label: "30 Days" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "allTime",   label: "All Time" },
];

interface PeriodSelectorProps {
  value: PeriodKey;
  onChange: (value: PeriodKey) => void;
  className?: string;
}

export function PeriodSelector({ value, onChange, className }: PeriodSelectorProps) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {PERIOD_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={cn(
            "px-3 py-1.5 text-xs rounded-md transition-colors font-medium",
            value === opt.key
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
