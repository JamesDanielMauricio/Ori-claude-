// Supabase caps how many rows one PostgREST response may return (the
// project's `db-max-rows`, 1000 by default), and it does it by TRUNCATING,
// not erroring — so a whole-table read that outgrows the cap silently comes
// back short. The backoffice tables read three join tables whole
// (grower_products, profile_blocked_products, product_customer_caps) to
// render one column per row without a query per row, and grower_products is
// already 611 rows on its own — a single grower carrying the full ~616-item
// catalog accounts for all of them, so a second such grower crosses the cap.
// A truncated read there wouldn't look like a failure; it would look like
// growers who stopped being in season for anything.
//
// Pages explicitly instead, stopping on the first short page.
//
// The query each caller passes MUST be ordered by something unique — the
// table's primary key. Pages are cut with OFFSET, and without an ORDER BY
// Postgres may return rows in a different order on each request, so a row
// can appear on two pages while another is skipped altogether.
const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}
