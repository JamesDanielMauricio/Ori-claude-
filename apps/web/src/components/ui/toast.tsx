"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { Icon, type IconName } from "./icon";

type ToastVariant = "default" | "success" | "error";

interface ToastMessage {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Filled semantic backgrounds, kept from the original: a toast appears over
// whatever screen the user was already reading, so it has to win on contrast
// immediately rather than blend into the page as a bordered white card would.
const VARIANT_CLASSES: Record<ToastVariant, string> = {
  default: "border-border-strong bg-surface text-ink",
  success: "border-accent-hover bg-accent text-accent-ink",
  error: "border-danger-hover bg-danger text-white",
};

// An icon alongside the text so the outcome is legible before the sentence
// is read — and so success/failure isn't carried by color alone, which is
// the same reason the message itself always states what happened.
const VARIANT_ICONS: Record<ToastVariant, IconName> = {
  default: "infoCircle",
  success: "checkCircle",
  error: "alertCircle",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, variant: ToastVariant = "default") => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, variant }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`animate-toast-in pointer-events-auto flex max-w-md items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-overlay ${VARIANT_CLASSES[toast.variant]}`}
          >
            <Icon name={VARIANT_ICONS[toast.variant]} className="h-[18px] w-[18px] shrink-0" />
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
