import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type CollapsibleSectionProps = {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  headerActions?: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
};

function readStored(id: string | undefined, fallback: boolean): boolean {
  if (!id || typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(`portal:collapse:${id}`);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* private mode */
  }
  return fallback;
}

/** Portal settings section with open/close + height animation. Children stay mounted. */
export function CollapsibleSection({
  id,
  title,
  description,
  icon,
  headerActions,
  badge,
  defaultOpen = false,
  className = "",
  children,
}: CollapsibleSectionProps) {
  const reactId = useId();
  const panelId = `portal-collapse-${id || reactId}`;
  const [open, setOpen] = useState(() => readStored(id, defaultOpen));

  useEffect(() => {
    if (!id) return;
    try {
      localStorage.setItem(`portal:collapse:${id}`, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [id, open]);

  const toggle = () => setOpen((v) => !v);

  return (
    <div className={`bg-card border border-border rounded-xl overflow-hidden ${className}`}>
      <div className={`flex items-start gap-2 px-4 ${open ? "pt-4 pb-2" : "py-4"}`}>
        <button
          type="button"
          className="min-w-0 flex-1 text-left rounded-md -m-1 p-1 hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {icon}
            <h2 className="text-sm font-medium text-foreground">{title}</h2>
            {badge}
          </div>
          {description ? (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
          ) : null}
        </button>
        {headerActions ? (
          <div className="flex shrink-0 items-center gap-2 pt-0.5">{headerActions}</div>
        ) : null}
        <button
          type="button"
          className="mt-0.5 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Collapse" : "Expand"}
          onClick={toggle}
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-300 ease-out ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      <div
        id={panelId}
        role="region"
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-4 pb-4 pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
