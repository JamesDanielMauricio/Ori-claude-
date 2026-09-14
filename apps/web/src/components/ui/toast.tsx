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

// How long a toast stays up. Named because the countdown bar's animation has
// to run for exactly this long — if the two drift apart, the bar either
// empties early or is cut off mid-sweep, which looks broken.
const TOAST_DURATION_MS = 4000;

// Filled semantic backgrounds, kept from the original: a toast appears over
// whatever screen the user was already reading, so it has to win on contrast
// immediately rather than blend into the page as a bordered white card would.
// The inset top highlight is the same trick the filled buttons use — it keeps
// a saturated block of color from reading as flat.
const VARIANT_CLASSES: Record<ToastVariant, string> = {
  default: "border-border-strong bg-surface text-ink",
  success:
    "border-accent-hover bg-accent text-accent-ink shadow-[inset_0_1px_0_0_rgb(255_255_255/0.18)]",
  error:
    "border-danger-hover bg-danger text-danger-ink shadow-[inset_0_1px_0_0_rgb(255_255_255/0.18)]",
};

// The countdown bar's own color, per variant — it has to sit on top of the
// toast's fill, so it can't just reuse the border token. On the filled
// variants it is the label's own ink, faded: white on the light theme's deep
// fills, near-black on the dark theme's bright ones.
const VARIANT_BAR_CLASSES: Record<ToastVariant, string> = {
  default: "bg-accent/55",
  success: "bg-accent-ink/45",
  error: "bg-danger-ink/45",
};

// A tinted disc behind the icon, so the glyph reads as a deliberate status
// mark rather than as punctuation floating next to the sentence.
const VARIANT_ICON_WRAP_CLASSES: Record<ToastVariant, string> = {
  default: "bg-accent-soft text-accent",
  success: "bg-accent-ink/20 text-accent-ink",
  error: "bg-danger-ink/20 text-danger-ink",
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
    }, TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* `flex-col-reverse` so a second toast pushes the stack upward from the
          bottom edge — new messages appear nearest the bottom where the eye
          already is, instead of shoving the existing one down out of view. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col-reverse items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`animate-toast-in pointer-events-auto relative flex w-full max-w-md items-center gap-3 overflow-hidden rounded-lg border py-3 pe-4 ps-3 text-sm font-medium shadow-overlay ${VARIANT_CLASSES[toast.variant]}`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${VARIANT_ICON_WRAP_CLASSES[toast.variant]}`}
            >
              <Icon name={VARIANT_ICONS[toast.variant]} className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">{toast.message}</span>

            {/* A depleting bar along the bottom edge showing the remaining
                dwell time, so the toast's disappearance is predicted rather
                than sudden. It animates `transform: scaleX()` from a keyframe
                declared inline — the duration has to match TOAST_DURATION_MS,
                and the compositor handles scaleX without repainting. The
                inline style is the one honest way to bind a CSS duration to a
                JS constant; a Tailwind class would hardcode it twice. */}
            <span
              aria-hidden
              className={`absolute inset-x-0 bottom-0 h-0.5 origin-right ${VARIANT_BAR_CLASSES[toast.variant]}`}
              style={{ animation: `toast-countdown ${TOAST_DURATION_MS}ms linear forwards` }}
            />
          </div>
        ))}
      </div>

      {/* Declared here rather than in globals.css because the keyframe exists
          only to serve the bar above, and keeping it adjacent is what stops
          the two from drifting apart. */}
      <style>{`@keyframes toast-countdown { from { transform: scaleX(1) } to { transform: scaleX(0) } }`}</style>
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
