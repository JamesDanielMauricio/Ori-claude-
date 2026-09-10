import { checkboxClassName } from "./form-field";

// The shared shape behind three different business rules that are all,
// mechanically, "pick a subset of the product catalog": a grower's
// in-season selection, a user's product blacklist, and (rendered
// differently, so not reused here) a product's per-customer pallet caps.
export function CheckboxList({
  options,
  selectedIds,
  onToggle,
  disabled = false,
  emptyLabel = "אין פריטים זמינים.",
}: {
  options: Array<{ id: string; label: string }>;
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  if (options.length === 0) {
    return <p className="text-sm text-ink-muted">{emptyLabel}</p>;
  }

  return (
    <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-lg bg-surface-muted/60 p-2 ring-1 ring-inset ring-border">
      {options.map((option) => {
        const checked = selectedIds.has(option.id);
        return (
          <label
            key={option.id}
            // The whole row tints when checked, not just the box. In a list
            // of a dozen near-identical product names, a 16px tick at the
            // start of the line is very easy to lose; a tinted row is not.
            // `cursor-default` while disabled so the row doesn't advertise
            // itself as clickable when it isn't.
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm transition-colors ${
              disabled ? "cursor-default" : "cursor-pointer"
            } ${
              checked
                ? "bg-accent-soft font-medium text-accent"
                : "text-ink hover:bg-surface"
            }`}
          >
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={checked}
              disabled={disabled}
              onChange={() => onToggle(option.id)}
            />
            <span className="min-w-0 truncate">{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
