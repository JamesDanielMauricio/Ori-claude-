// A number from the database as the text an <input> holds: "" for nothing
// (null), otherwise the number's own string form — "8", "117.25".
//
// The number fields here are controlled by string state, because what is
// being typed ("12.", "") isn't always a number yet; the save converts it
// back with Number(). Seeding that state straight from a database number
// only looked right because React prints a number the same way String()
// does — it left a number in a field typed as a string until the first
// keystroke. Rendering is identical either way: React sets an input's value
// with the same string conversion.
export function toInputText(value: number | null): string {
  return value === null ? "" : String(value);
}
