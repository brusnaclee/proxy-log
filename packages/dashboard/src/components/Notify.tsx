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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";

type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

type ConfirmOpts = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PromptOpts = {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type NotifyApi = {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
};

const NotifyContext = createContext<NotifyApi | null>(null);

let toastSeq = 0;

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOpts & {
    resolve: (v: boolean) => void;
  }) | null>(null);
  const [promptState, setPromptState] = useState<(PromptOpts & {
    resolve: (v: string | null) => void;
    value: string;
  }) | null>(null);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, kind, message }]);
    window.setTimeout(() => dismissToast(id), 4200);
  }, [dismissToast]);

  const api = useMemo<NotifyApi>(
    () => ({
      toast,
      success: (m) => toast(m, "success"),
      error: (m) => toast(m, "error"),
      info: (m) => toast(m, "info"),
      confirm: (opts) =>
        new Promise<boolean>((resolve) => {
          setConfirmState({ ...opts, resolve });
        }),
      prompt: (opts) =>
        new Promise<string | null>((resolve) => {
          setPromptState({
            ...opts,
            value: opts.defaultValue || "",
            resolve,
          });
        }),
    }),
    [toast],
  );

  const toastIcon = (kind: ToastKind) => {
    if (kind === "success") return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
    if (kind === "error") return <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />;
    return <Info className="h-4 w-4 text-sky-400 shrink-0" />;
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
                  className={cn(
                    "pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 shadow-lg text-sm bg-card text-foreground",
                    t.kind === "success" && "border-emerald-500/30",
                    t.kind === "error" && "border-red-500/30",
                    t.kind === "info" && "border-border",
                  )}
                >
                  {toastIcon(t.kind)}
                  <p className="flex-1 leading-snug">{t.message}</p>
                  <button
                    type="button"
                    className="p-0.5 text-muted-foreground hover:text-foreground"
                    onClick={() => dismissToast(t.id)}
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
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
                      className={cn(
                        "h-5 w-5 shrink-0 mt-0.5",
                        confirmState.danger ? "text-red-400" : "text-amber-400",
                      )}
                    />
                    <div>
                      <h3 className="text-base font-semibold">{confirmState.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                        {confirmState.message}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        confirmState.resolve(false);
                        setConfirmState(null);
                      }}
                    >
                      {confirmState.cancelLabel || "Cancel"}
                    </Button>
                    <Button
                      size="sm"
                      variant={confirmState.danger ? "destructive" : "default"}
                      onClick={() => {
                        confirmState.resolve(true);
                        setConfirmState(null);
                      }}
                    >
                      {confirmState.confirmLabel || "Confirm"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {promptState && (
              <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
                <div
                  className="absolute inset-0 bg-black/60"
                  onClick={() => {
                    promptState.resolve(null);
                    setPromptState(null);
                  }}
                />
                <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl space-y-4">
                  <div>
                    <h3 className="text-base font-semibold">{promptState.title}</h3>
                    {promptState.message && (
                      <p className="text-sm text-muted-foreground mt-1">{promptState.message}</p>
                    )}
                  </div>
                  <Input
                    autoFocus
                    value={promptState.value}
                    placeholder={promptState.placeholder}
                    onChange={(e) =>
                      setPromptState((s) => (s ? { ...s, value: e.target.value } : s))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        promptState.resolve(promptState.value);
                        setPromptState(null);
                      }
                    }}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        promptState.resolve(null);
                        setPromptState(null);
                      }}
                    >
                      {promptState.cancelLabel || "Cancel"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        promptState.resolve(promptState.value);
                        setPromptState(null);
                      }}
                    >
                      {promptState.confirmLabel || "OK"}
                    </Button>
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
    // Fallback so non-wrapped callers don't crash during HMR
    return {
      toast: (m) => console.log(m),
      success: (m) => console.log(m),
      error: (m) => console.error(m),
      info: (m) => console.log(m),
      confirm: async () => false,
      prompt: async () => null,
    };
  }
  return ctx;
}
