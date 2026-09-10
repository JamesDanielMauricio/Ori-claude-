import { useMemo, useState } from "react";

import { CellPopover } from "@/components/reference-data/cell-popover";
import { CheckboxList } from "@/components/reference-data/checkbox-list";
import { inputClassName } from "@/components/reference-data/form-field";

// The editable half of a "pick varieties from the catalog" cell — a
// grower's in-season list, a user's blocked-product list. Both are a subset
// of the same ~600-item catalog, which is why this carries its own search
// box: a flat checkbox list of six hundred Hebrew variety names is not
// something anyone scrolls through to find one item.
//
// The list is only mounted while the popover is open (see CellPopover), so
// the six hundred rows aren't in the DOM for every table row — only for the
// one cell being edited, while it's open.
export function ProductMultiSelectCell({
  label,
  options,
  selectedIds,
  onToggle,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("he");
    if (!needle) return options;
    return options.filter((option) => option.label.toLocaleLowerCase("he").includes(needle));
  }, [options, query]);

  return (
    <CellPopover label={label} summary={`${selectedIds.size} נבחרו`}>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="סינון"
        aria-label={`סינון ${label}`}
        className={`${inputClassName} mb-2 w-full`}
      />
      <CheckboxList
        options={filtered}
        selectedIds={selectedIds}
        onToggle={onToggle}
        emptyLabel={query ? `אין תוצאות עבור "${query.trim()}"` : "אין פריטים זמינים."}
      />
    </CellPopover>
  );
}
