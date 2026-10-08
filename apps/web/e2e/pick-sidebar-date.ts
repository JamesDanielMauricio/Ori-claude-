import { expect, type Page } from "@playwright/test";

// Points the backoffice sidebar's trading-day calendar
// (src/components/shell/trading-day-calendar-picker.tsx) at `isoDate` the way
// a person does: open it, step month by month to the right month, click the
// day. That pins every date-aware backoffice screen to the date — see
// lib/trading-day-view.tsx.
//
// The calendar's labels ("אוקטובר 2026" over the grid, "15 ביוני 2026" leading
// each day's label) are built in the page with the same Intl formats the
// calendar uses — in the browser rather than here, so a difference between
// Node's and Chromium's Hebrew locale data can't make them disagree. Nothing
// depends on which month the calendar opens on (the live day's, the pinned
// date's, or today's).
export async function pickSidebarDate(page: Page, isoDate: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!parts) throw new Error(`pickSidebarDate: "${isoDate}" is not a YYYY-MM-DD date`);
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const targetMonth = year * 12 + (month - 1);

  const labels = await page.evaluate(
    ({ y, m, d }) => {
      const monthFormat = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" });
      const months: Array<[string, number]> = [];
      for (let yy = y - 30; yy <= y + 30; yy++) {
        for (let mm = 0; mm < 12; mm++) months.push([monthFormat.format(new Date(yy, mm, 1)), yy * 12 + mm]);
      }
      const dayLabel = new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(y, m - 1, d));
      return { months, dayLabel };
    },
    { y: year, m: month, d: day },
  );
  const monthByLabel = new Map(labels.months);
  const labelByMonth = new Map(labels.months.map(([label, index]) => [index, label]));

  await page.getByRole("button", { name: "יום מסחר מוצג — בחר תאריך" }).click();
  const calendar = page.getByRole("dialog", { name: "בחירת יום מסחר" });
  await expect(calendar).toBeVisible();

  for (;;) {
    const texts = await calendar.getByRole("button").allTextContents();
    const shown = texts.map((text) => monthByLabel.get(text.trim())).find((value) => value !== undefined);
    if (shown === undefined) throw new Error("pickSidebarDate: the calendar's month label was not found");
    if (shown === targetMonth) break;
    const nextLabel = labelByMonth.get(shown > targetMonth ? shown - 1 : shown + 1);
    if (nextLabel === undefined) throw new Error("pickSidebarDate: stepped past the months it knows");
    await calendar.getByRole("button", { name: shown > targetMonth ? "חודש קודם" : "חודש הבא" }).click();
    // Wait for the grid to move before reading it again, so one click is
    // never counted twice.
    await expect(calendar.getByRole("button", { name: nextLabel, exact: true })).toBeVisible();
  }

  // Anchored at the start: a day's label is its date plus optional notes
  // ("… — קיים יום מסחר"), and an unanchored "1 ביוני 2026" would also match
  // the 11th, 21st and 31st.
  const dayLabel = labels.dayLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await calendar.getByRole("button", { name: new RegExp(`^${dayLabel}`) }).click();
  await expect(calendar).toBeHidden();
}
