// "Has this editor's draft actually diverged from what the server holds?" —
// the question behind every disabled שמור/בטל שינויים in the app (see
// components/reference-data/action-bar.tsx's `dirty`).
//
// One shared implementation rather than a hand-written field-by-field
// comparison per screen: there are seven editors, the reference-data forms
// alone carry fourteen fields between them, and a comparison that forgets a
// field fails in the worst possible direction — a real edit that leaves
// "שמור" greyed out, with no way for the user to tell that the button is
// wrong rather than their change being unimportant. A structural compare
// cannot forget a field.
//
// Both sides must be the SAME SHAPE, produced by the same function from
// different data — the draft on screen versus the draft the server's current
// values would produce. Callers that save something other than what they
// display (a numeric string typed into a text input, say) should compare the
// values they would SEND, not the ones they render; see PickLinesEditor's
// `toComparable` for that pattern.
//
// Handles the value kinds these forms actually hold: primitives, plain
// objects, arrays, Set, Map, Date. A class instance whose state is private
// would canonicalize to "{}" and so compare equal to any other — don't put
// one in a form state without teaching this function about it first.
function canonical(value: unknown): string {
  // undefined and null are folded together on purpose: an absent form field
  // and a null one both mean "no value" to every editor here, and to the
  // RPCs behind them.
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    // Sorted, so an array is compared as a SET. Every array these editors
    // hold is one — a grower's selected varieties, a user's blocked
    // varieties, a product's per-customer caps, a pick's or an order's lines
    // (each keyed by a unique id). Nothing in this app lets a user reorder a
    // list as a meaningful edit, so treating order as significant would only
    // produce false "changed" readings when a checkbox is toggled off and
    // back on. If a drag-to-reorder editor is ever added, it must not use
    // this function.
    return `[${value.map(canonical).sort().join(",")}]`;
  }

  // Set and Map are spelled out because the generic object branch below
  // CANNOT see them: Object.entries(new Set(["a"])) is [], so every Set
  // would canonicalize to the same empty string and two different sets would
  // read as unchanged. That is the one failure this whole function has to
  // avoid — UsersPage keeps its per-user product blacklist as a Set, so
  // without this, ticking a blacklist checkbox would leave "שמור" greyed
  // out. Sorted for the same reason arrays are: both are unordered.
  if (value instanceof Set) {
    return `Set[${[...value].map(canonical).sort().join(",")}]`;
  }
  if (value instanceof Map) {
    return `Map{${[...value].map(canonical).sort().join(",")}}`;
  }
  if (value instanceof Date) return `Date(${value.getTime()})`;

  // Key-sorted, so two objects built with their fields in a different order
  // still compare equal. JSON.stringify alone is key-ORDER sensitive, which
  // would make this depend on the order of literals in unrelated files.
  return `{${Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .sort()
    .join(",")}}`;
}

/**
 * True when `draft` differs from `baseline` — i.e. there is something to save
 * and something to discard.
 *
 * Errs toward `true` when in doubt (e.g. "5" and "5.0" typed into a numeric
 * field read as different), because the two mistakes are not equally bad: a
 * needlessly enabled button costs a no-op save, while a needlessly disabled
 * one silently refuses to save real work.
 */
export function hasChanges(draft: unknown, baseline: unknown): boolean {
  return canonical(draft) !== canonical(baseline);
}
