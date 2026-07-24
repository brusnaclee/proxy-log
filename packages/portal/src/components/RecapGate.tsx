import { useCallback, useEffect, useState } from "react";
import { Gift, X, Sparkles } from "lucide-react";
import { api, type RecapStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const STAGES = [
  "Mengumpulkan jejak ngoding…",
  "Menghitung token & request…",
  "Meramu persona…",
  "Menyiapkan animasi…",
  "Hampir siap…",
];

function storageKey(kind: "tease" | "open", yearMonth: string) {
  return `portal_recap_${kind}_dismissed:${yearMonth}`;
}

function isDismissed(kind: "tease" | "open", yearMonth: string) {
  try {
    return localStorage.getItem(storageKey(kind, yearMonth)) === "1";
  } catch {
    return false;
  }
}

function dismiss(kind: "tease" | "open", yearMonth: string) {
  try {
    localStorage.setItem(storageKey(kind, yearMonth), "1");
  } catch {
    /* ignore */
  }
}

export default function RecapGate() {
  const { t } = useI18n();
  const [status, setStatus] = useState<RecapStatus | null>(null);
  const [modal, setModal] = useState<"tease" | "open" | null>(null);
  const [loading, setLoading] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.recap
      .status()
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        const ym = s.yearMonth || "unknown";
        if (s.phase === "countdown" && !isDismissed("tease", ym)) {
          setModal("tease");
        } else if (s.phase === "open" && !isDismissed("open", ym)) {
          setModal("open");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const runOpen = useCallback(async () => {
    setErr(null);
    setLoading(true);
    setFadeOut(false);
    setStageIdx(0);
    const timer = window.setInterval(() => {
      setStageIdx((i) => Math.min(i + 1, STAGES.length - 1));
    }, 900);

    try {
      const res = await api.recap.open();
      clearInterval(timer);
      setStageIdx(STAGES.length - 1);
      setFadeOut(true);
      await new Promise((r) => setTimeout(r, 700));
      window.location.assign(res.recapUrl);
    } catch (e: any) {
      clearInterval(timer);
      setLoading(false);
      setErr(e?.message || t("Failed to open recap"));
    }
  }, [t]);

  const closeModal = () => {
    if (!status?.yearMonth) {
      setModal(null);
      return;
    }
    if (modal === "tease") dismiss("tease", status.yearMonth);
    if (modal === "open") dismiss("open", status.yearMonth);
    setModal(null);
  };

  const showButton = status?.phase === "open";

  return (
    <>
      {showButton && (
        <div className="fixed top-3 right-3 lg:top-4 lg:right-4 z-[70]">
          <button
            type="button"
            onClick={() => void runOpen()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium shadow-lg
              bg-gradient-to-r from-pink-500/90 to-violet-500/90 text-white
              hover:opacity-95 transition-all border border-white/10"
          >
            <Gift className="w-3.5 h-3.5" />
            {t("View Recap")}
          </button>
        </div>
      )}

      {modal && !loading && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[recapFadeIn_280ms_ease-out]"
            onClick={closeModal}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#12141c] shadow-2xl
            p-6 animate-[recapPop_320ms_cubic-bezier(0.16,1,0.3,1)]">
            <button
              type="button"
              onClick={closeModal}
              className="absolute top-3 right-3 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 text-pink-300 mb-3">
              <Sparkles className="w-5 h-5" />
              <span className="text-xs font-semibold tracking-wider uppercase">
                {status?.monthLabel || "Wrapped"}
              </span>
            </div>

            {modal === "tease" ? (
              <>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  {t("Recap is almost ready")}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-5">
                  {status?.daysUntilOpen != null && status.daysUntilOpen > 0
                    ? t("Recap ready in days").replace(
                        "{n}",
                        String(status.daysUntilOpen),
                      )
                    : status?.message || t("Recap opens soon")}
                </p>
                <p className="text-xs text-muted-foreground/80 mb-5">
                  {t("Opens on")} {status?.openDay} {status?.openMonthLabel} —{" "}
                  {t("until")} 5 {status?.closeMonthLabel}
                </p>
                <button
                  type="button"
                  onClick={closeModal}
                  className="w-full py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium transition-colors"
                >
                  {t("Got it")}
                </button>
              </>
            ) : (
              <>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  {t("Your monthly recap is ready")}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-5">
                  {status?.message ||
                    t("Open your Wrapped-style coding story for this month.")}
                </p>
                {err && (
                  <p className="text-xs text-red-400 mb-3">{err}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium transition-colors"
                  >
                    {t("Close")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runOpen()}
                    className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-pink-500 to-violet-500
                      text-white text-sm font-semibold shadow-lg shadow-pink-500/20 hover:opacity-95 transition-opacity"
                  >
                    {t("Show now")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div
          className={`fixed inset-0 z-[90] flex flex-col items-center justify-center
            bg-[#0b0d14] transition-opacity duration-700 ${fadeOut ? "opacity-0" : "opacity-100"}`}
        >
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[480px] h-[480px] rounded-full
              bg-pink-500/20 blur-3xl animate-pulse" />
            <div className="absolute bottom-0 right-0 w-[360px] h-[360px] rounded-full
              bg-violet-500/15 blur-3xl animate-pulse" style={{ animationDelay: "400ms" }} />
          </div>
          <div className="relative flex flex-col items-center gap-5 px-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pink-500 to-violet-600
              flex items-center justify-center shadow-xl shadow-pink-500/30 animate-[recapSpinSlow_3s_linear_infinite]">
              <Gift className="w-7 h-7 text-white" />
            </div>
            <div>
              <p className="text-lg font-semibold text-white mb-1">
                {status?.monthLabel || "Wrapped"}
              </p>
              <p className="text-sm text-white/70 min-h-[1.25rem] transition-all">
                {STAGES[stageIdx]}
              </p>
            </div>
            <div className="w-56 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-pink-400 to-violet-400 transition-all duration-700 ease-out"
                style={{ width: `${((stageIdx + 1) / STAGES.length) * 100}%` }}
              />
            </div>
            {err && <p className="text-xs text-red-400 max-w-xs">{err}</p>}
          </div>
        </div>
      )}

      <style>{`
        @keyframes recapFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes recapPop {
          from { opacity: 0; transform: translateY(12px) scale(0.96) }
          to { opacity: 1; transform: translateY(0) scale(1) }
        }
        @keyframes recapSpinSlow {
          from { transform: rotate(0deg) }
          to { transform: rotate(360deg) }
        }
      `}</style>
    </>
  );
}
