import { useEffect, useRef, useState, type ReactElement } from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactElement;
  className?: string;
  /** Explicit height class override; default uses .chart-container */
  minHeight?: number;
};

/**
 * Recharts ResponsiveContainer collapses to 0×0 on mobile (parent has only min-height)
 * and after tab switches (hidden → visible). This wrapper measures real pixels and
 * remounts the chart when the tab becomes visible again.
 */
export function ChartBox({ children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [gen, setGen] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.floor(r.width);
      const h = Math.floor(r.height);
      if (w > 0 && h > 0) setSize({ w, h });
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Force remount after tab restore — Recharts often keeps a 0-width SVG
      requestAnimationFrame(() => {
        measure();
        setGen((g) => g + 1);
      });
    };
    const onOrient = () => {
      requestAnimationFrame(() => {
        measure();
        setGen((g) => g + 1);
      });
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    window.addEventListener("orientationchange", onOrient);
    window.addEventListener("resize", measure);

    return () => {
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.removeEventListener("orientationchange", onOrient);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const ready = size.w > 10 && size.h > 10;

  return (
    <div ref={ref} className={cn("w-full h-[200px] lg:h-[250px]", className)}>
      {ready ? (
        <ResponsiveContainer key={gen} width={size.w} height={size.h}>
          {children}
        </ResponsiveContainer>
      ) : (
        <div className="w-full h-full animate-pulse rounded-md bg-muted/30" />
      )}
    </div>
  );
}
