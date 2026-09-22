import { useState } from "react";

import { inputClassName } from "@/components/reference-data/form-field";

// Password field with the PRD's show/hide toggle (login.md: "a show/hide
// toggle is available (via `show_hide password` reusable)"). The toggle
// is a real button with an accessible Hebrew label, not an icon-only
// hover affordance — same reasoning as the v1.3 "(i) icon → text" rule.
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete = "current-password",
  minLength,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      {/* The input is forced LTR (passwords are latin-keyboard input), so
          its own logical pe-* would resolve to the RIGHT side — while the
          toggle button, positioned in the RTL parent, sits on the LEFT
          (end-2). Physical pl-16 keeps typed text clear of the button. */}
      <input
        id={id}
        type={visible ? "text" : "password"}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        dir="ltr"
        className={`${inputClassName} w-full pl-16 text-left`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        // h-10 (was h-9) and wider padding: at 38×36 this was under the
        // touch-target floor, and it sits inside a 40px field where a miss
        // lands in the password input instead — which on a phone means the
        // keyboard opens and the toggle appears not to have worked.
        className="absolute inset-y-0 start-auto end-1 my-auto flex h-10 items-center rounded px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
      >
        {visible ? "הסתר" : "הצג"}
      </button>
    </div>
  );
}
