import React, { createContext, useContext, useEffect, useState } from "react";

const KEY = "dashboard_realtime_enabled";

interface RealtimeCtx {
  realtimeEnabled: boolean;
  setRealtimeEnabled: (v: boolean) => void;
}

const RealtimeContext = createContext<RealtimeCtx>({
  realtimeEnabled: false,
  setRealtimeEnabled: () => {},
});

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [realtimeEnabled, setRealtimeEnabledState] = useState<boolean>(
    () => localStorage.getItem(KEY) === "true"
  );

  const setRealtimeEnabled = (v: boolean) => {
    localStorage.setItem(KEY, String(v));
    setRealtimeEnabledState(v);
    window.dispatchEvent(new CustomEvent("dashboardRealtimeChanged", { detail: { enabled: v } }));
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ enabled: boolean }>;
      setRealtimeEnabledState(ev.detail.enabled);
    };
    window.addEventListener("dashboardRealtimeChanged", handler);
    return () => window.removeEventListener("dashboardRealtimeChanged", handler);
  }, []);

  return (
    <RealtimeContext.Provider value={{ realtimeEnabled, setRealtimeEnabled }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
