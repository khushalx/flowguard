"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Check, CircleAlert, X } from "lucide-react";
type Notify = (message: string, kind?: "success" | "error") => void;
const FeedbackContext = createContext<Notify>(() => {});
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{
    message: string;
    kind: "success" | "error";
    id: number;
  } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => setToast(null),
      toast.kind === "error" ? 10000 : 5000,
    );
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <FeedbackContext.Provider
      value={(message, kind = "success") =>
        setToast({ message, kind, id: Date.now() })
      }
    >
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toast && (
          <div
            className={`toast toast-${toast.kind}`}
            role={toast.kind === "error" ? "alert" : "status"}
          >
            {toast.kind === "error" ? (
              <CircleAlert size={18} />
            ) : (
              <Check size={18} />
            )}
            <span>{toast.message}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </FeedbackContext.Provider>
  );
}
export const useFeedback = () => useContext(FeedbackContext);
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
