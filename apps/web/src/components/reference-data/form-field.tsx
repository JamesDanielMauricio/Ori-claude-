import type { ReactNode } from "react";

export function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

export const inputClassName =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-muted";
