import { useEffect } from "react";
import { useRealtime } from "./realtime-context";

export function useRealtimeSSE(onMessage: (data: any) => void, debounceMs = 500) {
  const { realtimeEnabled } = useRealtime();

  useEffect(() => {
    if (!realtimeEnabled) return;
    
    const eventSource = new EventSource("/admin/logs/stream");
    let timer: ReturnType<typeof setTimeout> | null = null;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => onMessage(data), debounceMs);
      } catch {
        // ignore
      }
    };

    return () => {
      if (timer) clearTimeout(timer);
      eventSource.close();
    };
  }, [realtimeEnabled, onMessage, debounceMs]);
}