import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";

type ToastKind = "success" | "error" | "info";

type ToastItem = { id: number; kind: ToastKind; message: string };

type ConfirmOpts = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type NotifyApi = {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
};

const NotifyContext = createContext<NotifyApi | null>(null);
let toastSeq = 0;

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOpts & {
    resolve: (v: boolean) => void;
  }) | null>(null);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = ++toastSeq;
      setToasts((t) => [...t, { id, kind, message }]);
      window.setTimeout(() => dismissToast(id), 4200);
    },
    [dismissToast],
  );

  const api = useMemo<NotifyApi>(
    () => ({
      toast,
      success: (m) => toast(m, "success"),
      error: (m) => toast(m, "error"),
      info: (m) => toast(m, "info"),
      confirm: (opts) =>
        new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve })),
    }),
    [toast],
  );

  const icon = (kind: ToastKind) => {
    if (kind === "success") return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    if (kind === "error") return <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />;
    return <Info className="w-4 h-4 text-sky-400 shrink-0" />;
  };

  return (
    <NotifyContext.Provider value={api}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] pointer-events-none">
              {toasts.map((t) => (
                <div
                  key={t.id}
                  className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 shadow-lg text-sm bg-card text-foreground ${
                    t.kind === "success"
                      ? "border-emerald-500/30"
                      : t.kind === "error"
                        ? "border-red-500/30"
                        : "border-border"
                  }`}
                >
                  {icon(t.kind)}
                  <p className="flex-1 leading-snug">{t.message}</p>
                  <button
                    type="button"
                    className="p-0.5 text-muted-foreground hover:text-foreground"
                    onClick={() => dismissToast(t.id)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {confirmState && (
              <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
                <div
                  className="absolute inset-0 bg-black/60"
                  onClick={() => {
                    confirmState.resolve(false);
                    setConfirmState(null);
                  }}
                />
                <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl space-y-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle
                      className={`w-5 h-5 shrink-0 mt-0.5 ${
                        confirmState.danger ? "text-red-400" : "text-amber-400"
                      }`}
                    />
                    <div>
                      <h3 className="text-base font-semibold text-foreground">{confirmState.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                        {confirmState.message}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-accent transition-colors"
                      onClick={() => {
                        confirmState.resolve(false);
                        setConfirmState(null);
                      }}
                    >
                      {confirmState.cancelLabel || "Cancel"}
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                        confirmState.danger
                          ? "bg-red-500 text-white hover:bg-red-600"
                          : "bg-primary text-primary-foreground hover:bg-primary/90"
                      }`}
                      onClick={() => {
                        confirmState.resolve(true);
                        setConfirmState(null);
                      }}
                    >
                      {confirmState.confirmLabel || "Confirm"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>,
          document.body,
        )}
    </NotifyContext.Provider>
  );
}

export function useNotify(): NotifyApi {
  const ctx = useContext(NotifyContext);
  if (!ctx) {
    return {
      toast: (m) => console.log(m),
      success: (m) => console.log(m),
      error: (m) => console.error(m),
      info: (m) => console.log(m),
      confirm: async () => false,
    };
  }
  return ctx;
}
