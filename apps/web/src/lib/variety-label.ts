// A variety's name and its size (product_varieties.sizes, free text like "5"
// or "7") are separate catalog fields but always meant to be read together —
// otherwise two same-named varieties of different sizes are indistinguishable
// anywhere they're listed. Blank/null sizes contribute nothing, matching the
// backoffice catalog table's own "row.sizes || —" convention for "no size
// recorded" (products.tsx) — just omitted here rather than shown as a dash,
// since there's no separate column to fill in these call sites.
export function formatVarietyName(name: string, sizes: string | null | undefined): string {
  return sizes ? `${name} ${sizes}` : name;
}
