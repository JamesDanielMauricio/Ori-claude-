import { Button } from "./button";
import { Icon } from "./icon";

// The counterpart to EmptyState, for when a screen has no data because the
// FETCH FAILED rather than because there is nothing to show.
//
// Every screen here reads its query as `data ?? []` and falls straight through
// to an empty state, so a failed request was reported to the user as a
// confident statement of fact: "there is no open trading day", "no products
// are available to order today", "you have no orders yet". Those are the same
// sentences the app shows when the answer really is nothing, and on this
// product they are operationally significant — a grower who reads "no pick
// list for you today" stops working for the day. A request that never
// completed cannot support any of those claims.
//
// React Query already retries a few times with backoff before a query settles
// into `isError`, so reaching this component means the failure persisted, not
// that one packet dropped. That makes an explicit retry worth offering: it is
// the only recovery short of reloading the page, since the query is no longer
// refetching on its own.
export function QueryError({
  // What the screen was trying to load, in Hebrew, as a noun phrase: the
  // message reads "טעינת <this> נכשלה".
  what,
  onRetry,
  retrying,
}: {
  what: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      // role="alert" so a screen reader announces the failure rather than
      // leaving the user to notice that content simply never appeared.
      role="alert"
      className="animate-rise-in flex flex-col items-center justify-center gap-4 rounded-xl bg-surface px-6 py-10 text-center shadow-card ring-1 ring-inset ring-border/70"
    >
      <span
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger ring-1 ring-inset ring-danger/20"
      >
        <Icon name="alertCircle" className="h-5 w-5" />
      </span>
      <div>
        <h2 className="text-sm font-semibold text-ink">טעינת {what} נכשלה</h2>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-muted">
          לא הצלחנו לקבל את הנתונים מהשרת. ייתכן שיש בעיית חיבור — הנתונים המוצגים אינם בהכרח מלאים.
        </p>
      </div>
      {onRetry && (
        <Button type="button" variant="secondary" onClick={onRetry} disabled={retrying}>
          {retrying ? "מנסה שוב…" : "נסה שוב"}
        </Button>
      )}
    </div>
  );
}
