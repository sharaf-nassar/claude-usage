import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { ReactNode } from "react";

export type ToastLevel = "error" | "warning" | "info";

interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
}

interface ToastContextValue {
  toast: (level: ToastLevel, message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

const TOAST_DURATION = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const addToast = useCallback((level: ToastLevel, message: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, level, message }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setExiting(true), TOAST_DURATION);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => onDismiss(toast.id), 300);
    return () => clearTimeout(timer);
  }, [exiting, toast.id, onDismiss]);

  const icon = toast.level === "error" ? "✕" : toast.level === "warning" ? "⚠" : "ℹ";

  return (
    <div
      className={`toast toast--${toast.level}${exiting ? " toast--exit" : ""}`}
      onClick={() => setExiting(true)}
    >
      <span className="toast-icon">{icon}</span>
      <span className="toast-message">{toast.message}</span>
    </div>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
