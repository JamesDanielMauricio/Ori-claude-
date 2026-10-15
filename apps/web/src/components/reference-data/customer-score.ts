// A customer's ranking score as it is typed and shown — no React, no
// Supabase. The scale is the distributor's own: 1 (lowest) to 5, to two
// decimal places (packages/domain's setCustomerScoreInputSchema, and the
// customer_scores table behind it).

/** What a typed value means: a score to save, no score at all, or neither. */
export type ParsedCustomerScore =
  { kind: "score"; value: number } | { kind: "none" } | { kind: "invalid" };

// Read as a pattern rather than handed to Number(): Number() takes "1e0",
// "+4" and "0x4" for numbers, and a ranking box should take none of them.
// The leading digit is also where the lower bound lives — nothing below 1
// can match — which leaves only "above 5" to check on the value.
const SCORE_PATTERN = /^[1-5](\.\d{1,2})?$/;

// Invisible direction marks. A number copied out of right-to-left text — a
// WhatsApp message, a spreadsheet cell — usually arrives wrapped in them,
// and they would otherwise make a perfectly good "4.35" unreadable.
const DIRECTION_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Reads what was typed into a score box.
 *
 * An empty box is "no score" — clearing a customer's ranking is a real
 * action, not an invalid entry — and anything that is not a score on the
 * scale is refused outright rather than nudged onto it: a 7 typed by mistake
 * should not quietly become a 5.
 */
export function parseCustomerScore(raw: string): ParsedCustomerScore {
  // A decimal comma is read as a decimal point: it is what a pasted
  // European-format number carries.
  const typed = raw.replace(DIRECTION_MARKS, "").trim().replace(",", ".");
  if (typed === "") return { kind: "none" };
  if (!SCORE_PATTERN.test(typed)) return { kind: "invalid" };
  const value = Number(typed);
  return value <= 5 ? { kind: "score", value } : { kind: "invalid" };
}

/** A score as the box shows it: "" for none, and no padding zeros. */
export function formatCustomerScore(score: number | null): string {
  return score === null ? "" : String(score);
}
