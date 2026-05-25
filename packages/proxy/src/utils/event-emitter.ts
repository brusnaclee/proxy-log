/**
 * Simple typed event emitter for SSE log streaming
 */
type Listener<T> = (data: T) => void;

class EventEmitter<T = any> {
  private listeners: Set<Listener<T>> = new Set();

  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(data: T): void {
    for (const listener of this.listeners) {
      try {
        listener(data);
      } catch (err) {
        console.error("Event listener error:", err);
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}

// Global log event emitter — emits new request log entries
export const logEmitter = new EventEmitter<any>();
