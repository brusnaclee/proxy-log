import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type CollapsibleCardProps = {
  /** Persist open/closed in localStorage under this key (optional). */
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Shown on the right of the header; clicks do not toggle. */
  headerActions?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  titleClassName?: string;
  contentClassName?: string;
  children: ReactNode;
};

function readStored(id: string | undefined, fallback: boolean): boolean {
  if (!id || typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(`ui:collapse:${id}`);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* private mode */
  }
  return fallback;
}

/**
 * Settings / Admin Log section card with open/close + height animation.
 * Children stay mounted so form state is preserved when collapsed.
 */
export function CollapsibleCard({
  id,
  title,
  description,
  icon,
  headerActions,
  defaultOpen = false,
  className,
  titleClassName,
  contentClassName,
  children,
}: CollapsibleCardProps) {
  const reactId = useId();
  const panelId = `collapse-panel-${id || reactId}`;
  const [open, setOpen] = useState(() => readStored(id, defaultOpen));

  useEffect(() => {
    if (!id) return;
    try {
      localStorage.setItem(`ui:collapse:${id}`, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [id, open]);

  const toggle = () => setOpen((v) => !v);

  return (
    <Card className={cn("border-border/50 overflow-hidden", className)}>
      <div className={cn("flex items-start gap-2 p-6", open ? "pb-3" : "pb-6")}>
        <button
          type="button"
          className={cn(
            "min-w-0 flex-1 space-y-1.5 rounded-md text-left transition-colors",
            "hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "-m-2 p-2",
          )}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
        >
          <CardTitle
            className={cn(
              "text-base flex items-center gap-2 font-semibold leading-none tracking-tight",
              titleClassName,
            )}
          >
            {icon}
            {title}
          </CardTitle>
          {description ? (
            <CardDescription className="text-sm leading-relaxed">{description}</CardDescription>
          ) : null}
        </button>

        {headerActions ? (
          <div className="flex shrink-0 items-center gap-2 pt-0.5">{headerActions}</div>
        ) : null}

        <button
          type="button"
          className={cn(
            "mt-0.5 rounded-md p-1.5 text-muted-foreground transition-colors",
            "hover:bg-muted/40 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Collapse section" : "Expand section"}
          onClick={toggle}
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform duration-300 ease-out",
              open && "rotate-180",
            )}
          />
        </button>
      </div>

      <div
        id={panelId}
        role="region"
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={cn("px-6 pb-6 pt-0", contentClassName)}>{children}</div>
        </div>
      </div>
    </Card>
  );
}
