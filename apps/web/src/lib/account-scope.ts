// Every account gets a cache of its own.
//
// The app keeps what it has read in one React Query cache for the whole tab,
// and most of its keys don't name the account — the customer's catalog is
// ["customer", "catalog", day, "self"] whoever is signed in. So when one
// person signed out and another signed in on the same tab (a shared office
// computer, a phone handed over), the second one was shown the first one's
// cached order, profile and alerts — for up to 30 seconds without even a
// re-read, long enough to press Save and send the first person's quantities
// as their own.
//
// lib/providers.tsx therefore throws the whole cache away, and remounts every
// screen, whenever the signed-in account changes. This decides when that is.
//
// SECURITY: this ALLOWS a cache to carry over in exactly one case — from
// nobody signed in to someone (the page loading, or signing in on the login
// screen), when it can only hold what a signed-out screen read, which is
// nothing private. It PROTECTS AGAINST any account seeing or saving data
// cached for a different account: signing out, or one account replacing
// another without a sign-out in between (signing in as someone else in a
// second tab), always starts a fresh cache. The database's own row-level
// rules are untouched by this — they still decide what each account may
// read; this only stops the browser re-showing what it read for someone else.
export function startsNewAccountScope(
  previousUserId: string | null,
  userId: string | null,
): boolean {
  return previousUserId !== null && previousUserId !== userId;
}
