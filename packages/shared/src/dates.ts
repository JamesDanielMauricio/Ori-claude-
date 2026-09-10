// Calendar-date helpers.
//
// The rule this file exists to enforce: a `date` column (trading_days.trade_date)
// names a day on the *user's* calendar, not an instant, so it must never be
// derived from a UTC timestamp.
//
// `new Date().toISOString().slice(0, 10)` is the tempting one-liner and it is
// wrong here. It converts to UTC first, so for any timezone ahead of UTC — Israel
// is UTC+2/+3, and this app is Hebrew-only — every local moment between midnight
// and the offset still reports *yesterday*. A distributor opening the business day
// at 01:00 on the 9th would have stamped it the 8th, and that wrong date is what
// growers, customers, and Order History all display afterwards. Nothing rejects
// it either: trading_days has no unique constraint on trade_date (only the partial
// "one non-closed day" index, see 0009_lifecycle-schema.sql), so the bad date
// commits silently.
//
// Reading the local getFullYear/getMonth/getDate components keeps the answer on
// the calendar the person clicking the button is actually looking at.
export function todayIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// The read side of the same rule, for code that needs a `Date` back out of a
// `YYYY-MM-DD` string — a calendar widget building a month grid, say. Never
// `new Date(isoString)`: a date-only ISO string parses as UTC midnight per
// spec, and the local `Date` constructed from that reads back one calendar
// day earlier in every timezone behind UTC. Building the `Date` from the
// parsed y/m/d components directly, the way the constructor's (year, month,
// day) overload works, keeps it a local-midnight `Date` for that same
// calendar day everywhere.
export function parseIsoDate(isoDate: string): Date {
  const parts = isoDate.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return new Date(year, month - 1, day);
}
