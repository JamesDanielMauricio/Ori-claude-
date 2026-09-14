import { useMemo, useState, type CSSProperties } from "react";

import { Icon, type IconName } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";

export interface RecordListItem {
  id: string;
  // The row's primary line.
  label: string;
  // Secondary line under the label — a company name, a family name, a phone.
  // Rendered on its OWN line rather than appended in parentheses after the
  // label, which is what produced rows reading "Customer 01(Customer 01)".
  meta?: string | null;
  // Optional trailing pill: a role, a status, a type.
  badge?: string | null;
}

// The record picker all five Backoffice management screens share (users,
// products, growers, customers, transporters). Each of them had its own
// copy of the same hand-rolled <ul> of buttons — same markup, same bugs,
// five times over (R1). This is that list as one component, with the three
// things every copy was missing: a search box, a row that can hold two
// lines without colliding, and an empty state.
//
// Filtering is client-side and deliberately so: these tables are reference
// data in the low hundreds of rows, already fetched in full by the parent
// for the detail pane. A server round-trip per keystroke would be slower
// and would need debouncing, cancellation and a loading state to match.
export function RecordList({
  items,
  selectedId,
  onSelect,
  loading = false,
  searchPlaceholder = "חיפוש",
  emptyLabel = "אין רשומות עדיין.",
  icon = "user",
}: {
  items: RecordListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  // Drawn in the avatar disc when a row has no usable initial, and in the
  // "nothing here" state.
  icon?: IconName;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("he");
    if (!needle) return items;
    return items.filter((item) =>
      `${item.label} ${item.meta ?? ""} ${item.badge ?? ""}`
        .toLocaleLowerCase("he")
        .includes(needle),
    );
  }, [items, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
      {/* Search + count share one bar. The count is what tells you whether a
          search actually narrowed anything, so it lives next to the input
          rather than under the list where it would be scrolled away. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-muted/60 px-3 py-2.5">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="search"
            className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-4 w-4 text-ink-subtle"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-9 w-full rounded-md bg-surface ps-8 pe-3 text-sm text-ink ring-1 ring-inset ring-border transition-[box-shadow] duration-200 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        {!loading && (
          <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-muted ring-1 ring-inset ring-border">
            {filtered.length}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <Icon name={query ? "search" : icon} className="h-6 w-6 text-ink-subtle" />
            <p className="text-sm text-ink-muted">
              {query ? `אין תוצאות עבור "${query.trim()}"` : emptyLabel}
            </p>
          </div>
        ) : (
          <ul>
            {filtered.map((item, index) => {
              const active = item.id === selectedId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    aria-current={active ? "true" : undefined}
                    // The divider is drawn as an inset pseudo-element rather
                    // than a full-bleed `border-b`, so it starts where the
                    // text starts. A rule running edge to edge under every row
                    // is what makes a list look like a spreadsheet; one that
                    // aligns to the content reads as a considered list.
                    className={`animate-stagger-in relative flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors duration-150 after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-border after:content-[''] last:after:hidden ${
                      active
                        ? "bg-accent-soft before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-accent before:content-['']"
                        : "hover:bg-surface-muted"
                    }`}
                    style={{ "--stagger-index": Math.min(index, 8) } as CSSProperties}
                  >
                    <Avatar label={item.label} icon={icon} active={active} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm ${active ? "font-semibold text-accent" : "font-medium text-ink"}`}
                      >
                        {item.label}
                      </span>
                      {/* Suppressed when it would just repeat the label. A
                          user's display name and their company name are
                          frequently the same string in this data, and a row
                          that prints it twice looks like a rendering bug
                          rather than like two facts. */}
                      {item.meta && item.meta !== item.label && (
                        <span className="mt-0.5 block truncate text-xs text-ink-muted">
                          {item.meta}
                        </span>
                      )}
                    </span>
                    {item.badge && (
                      <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-inset ring-border">
                        {item.badge}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// An initial in a disc. Same reasoning as the shells' identity strip: the
// circle is a placeholder for an avatar this app has no image source for, so
// it may as well carry the one identifying thing available. Falls back to the
// list's icon when the label starts with something that isn't a letter (a
// product code, a leading digit).
function Avatar({ label, icon, active }: { label: string; icon: IconName; active: boolean }) {
  const initial = label.trim().charAt(0);
  const hasLetter = /\p{L}/u.test(initial);

  return (
    <span
      aria-hidden
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1 ring-inset transition-colors ${
        active
          ? "bg-accent text-accent-ink ring-accent"
          : "bg-surface-muted text-ink-muted ring-border"
      }`}
    >
      {hasLetter ? initial : <Icon name={icon} className="h-4 w-4" />}
    </span>
  );
}
