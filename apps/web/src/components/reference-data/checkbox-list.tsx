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
    <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
      {options.map((option) => (
        <label
          key={option.id}
          className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-canvas"
        >
          <input
            type="checkbox"
            checked={selectedIds.has(option.id)}
            disabled={disabled}
            onChange={() => onToggle(option.id)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
