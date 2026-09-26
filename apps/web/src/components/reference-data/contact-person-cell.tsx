import { useMemo, useState } from "react";

import { CellPopover } from "@/components/reference-data/cell-popover";
import { inputClassName } from "@/components/reference-data/form-field";
import { Icon } from "@/components/ui/icon";

// One entry in the contact-person directory — every profile in the system,
// not just the ones belonging to the company being edited. See
// use-contact-person-directory.ts for why the picker has to be global
// rather than scoped to "this company's own users".
export interface ContactPersonOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
}

// The secondary line under a contact's name, wherever one is shown: email
// and phone side by side, whichever of the two exist. Shared between the
// read cell and the picker's option rows so they can never drift apart.
function contactDetailLine(option: ContactPersonOption): string {
  return [option.email, option.phone].filter(Boolean).join(" · ") || "—";
}

// The read-only half of the "contact person" cell — the grower/customer/
// transporter screens' new column. Shows the three fields the field was
// asked to surface (name, email, phone) stacked in one compact cell rather
// than three separate columns, since only one of the three is ever the
// thing being scanned for.
export function ContactPersonSummary({ option }: { option: ContactPersonOption | null }) {
  if (!option) {
    return <span className="text-sm text-ink-subtle">— ללא —</span>;
  }
  return (
    <div className="flex min-w-0 max-w-[14rem] flex-col">
      <span className="truncate text-sm font-medium text-ink">{option.name}</span>
      <span className="truncate text-xs text-ink-subtle">{contactDetailLine(option)}</span>
    </div>
  );
}

// One selectable row in the picker panel — a radio-style option (only one
// contact person per company), not a checkbox: CheckboxList's multi-select
// look would wrongly suggest more than one could be picked.
function ContactPersonOptionRow({
  option,
  selected,
  onSelect,
}: {
  option: ContactPersonOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={`flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-start text-sm transition-colors ${
        selected ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-surface"
      }`}
    >
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-border">
        {selected && <Icon name="check" className="h-3 w-3" />}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{option.name}</span>
        <span className="truncate text-xs text-ink-subtle">{contactDetailLine(option)}</span>
        {option.companyName && (
          <span className="truncate text-xs text-ink-muted">{option.companyName}</span>
        )}
      </span>
    </button>
  );
}

// The editable half — a search box over the full user directory, plus a
// "— ללא —" row to clear the field. Only ever mounted while its popover is
// open (see CellPopover), so a directory of a few hundred users isn't kept
// in the DOM for every row of the table at once.
export function ContactPersonEditCell({
  options,
  selectedId,
  onSelect,
}: {
  options: ContactPersonOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("he");
    if (!needle) return options;
    return options.filter((option) =>
      [option.name, option.email, option.phone, option.companyName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase("he").includes(needle)),
    );
  }, [options, query]);

  return (
    <CellPopover label="איש קשר" summary={selected ? selected.name : "— ללא —"} panelClassName="w-80">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="חיפוש איש קשר"
        aria-label="חיפוש איש קשר"
        className={`${inputClassName} mb-2 w-full`}
      />
      <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-lg bg-surface-muted/60 p-2 ring-1 ring-inset ring-border">
        <button
          type="button"
          role="option"
          aria-selected={selectedId === null}
          onClick={() => onSelect(null)}
          className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm transition-colors ${
            selectedId === null ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-surface"
          }`}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-border">
            {selectedId === null && <Icon name="check" className="h-3 w-3" />}
          </span>
          — ללא —
        </button>
        {filtered.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-ink-muted">
            {query ? `אין תוצאות עבור "${query.trim()}"` : "אין משתמשים זמינים."}
          </p>
        ) : (
          filtered.map((option) => (
            <ContactPersonOptionRow
              key={option.id}
              option={option}
              selected={option.id === selectedId}
              onSelect={() => onSelect(option.id)}
            />
          ))
        )}
      </div>
    </CellPopover>
  );
}
