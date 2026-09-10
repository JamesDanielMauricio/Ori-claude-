import { useState } from "react";

import { inputClassName } from "@/components/reference-data/form-field";
import { StatusPill, type StatusTone } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";

import {
  allocationFor,
  formatPallets,
  splitCustomersByVariety,
  type CustomerDemand,
  type CustomerOrderLine,
  type LineAllocation,
  type PickSelection,
  type SelectedPickLine,
} from "./board-data";

// The reference design's left-hand area: every customer's order as its own
// card, split by a dashed rule into those who ordered the selected product
// and those who did not.
//
// That split is the screen's working method. With one grower's pick line
// selected in the column opposite, the group above the rule is the work in
// front of you — each of those customers asked for this product, and each
// gets a quantity box and a ✓ to commit pallets off that line. The group
// below is everyone else trading today: they didn't ask for it, but if the
// grower brought more than the orders cover, the + button moves one of them
// up and offers them some.
//
// Nothing about + touches the database. A customer who is promoted and then
// left alone has had nothing done to them; it is ✓ that writes, and only
// then does an order line get created — at zero pallets, because they never
// ordered it — alongside the arrangement record. That is one RPC,
// arrange_to_customer (migration 0040), not two round trips the UI would
// have to keep consistent.

export interface AllocationPatch {
  id: string;
  quantityPallets: number;
  price: number | null;
  priceType: string | null;
}

/** What the ✓ button asks the route to do. */
export interface ArrangeRequest {
  customerId: string;
  quantityPallets: number;
  existing: LineAllocation | null;
}

const ORDER_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "פתוחה", tone: "neutral" },
  submitted: { label: "נשלחה", tone: "accent" },
  closed: { label: "סגורה", tone: "brass" },
};

export function CustomerDemandBoard({
  customers,
  selection,
  selected,
  promoted,
  editable,
  saving,
  onPromote,
  onEditOrders,
  onArrange,
  onSave,
  onDelete,
}: {
  customers: CustomerDemand[];
  selection: PickSelection | null;
  selected: SelectedPickLine | null;
  promoted: ReadonlySet<string>;
  editable: boolean;
  saving: boolean;
  onPromote: (customerId: string) => void;
  onEditOrders: (customerId: string) => void;
  onArrange: (request: ArrangeRequest) => Promise<boolean>;
  onSave: (patch: AllocationPatch) => Promise<boolean>;
  onDelete: (recordId: string) => void;
}) {
  const { ordering, other } = splitCustomersByVariety(
    customers,
    selection?.varietyId ?? null,
    promoted,
  );

  const shared = {
    selection,
    selected,
    editable,
    saving,
    onEditOrders,
    onArrange,
    onSave,
    onDelete,
    onPromote,
  };

  return (
    <section className="animate-rise-in overflow-hidden rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-muted/60 px-5 py-3.5">
        <h2 className="font-display text-lg text-ink">לקוחות</h2>
        {/* Counts what is on screen, not what came back from the query — the
            two differ while nothing is selected, because customers who
            ordered nothing are held back until there is a product to offer
            them. */}
        <span className="text-xs text-ink-muted">{ordering.length + other.length}</span>
      </header>

      {ordering.length + other.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-muted">אין ביקוש רשום עדיין.</p>
      ) : (
        <>
          {ordering.length > 0 ? (
            // Two cards abreast from `xl` only. The reference runs two
            // columns on a wide desktop, but these cards hold a customer's
            // whole order and an editable row inside it — squeezed to half of
            // a 1024px screen they wrap into unreadable ribbons.
            <div className="grid gap-4 p-4 xl:grid-cols-2">
              {ordering.map((customer, index) => (
                <CustomerCard
                  key={customer.customerId}
                  {...shared}
                  customer={customer}
                  index={index}
                  section="ordering"
                  promoted={promoted.has(customer.customerId)}
                />
              ))}
            </div>
          ) : (
            selection && (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                אף לקוח לא הזמין את המוצר הנבחר. השתמש ב־+ כדי להציע אותו למישהו.
              </p>
            )
          )}

          {/* The reference's dashed rule. Dashed rather than solid on
              purpose: a solid divider inside a card reads as "two cards",
              and these are two halves of one list whose membership changes
              every time the selection opposite does. */}
          {selection && other.length > 0 && (
            <>
              <div className="flex items-center gap-3 px-5 py-1">
                <span
                  aria-hidden
                  className="h-0 flex-1 border-t-2 border-dashed border-border-strong"
                />
                <span className="shrink-0 text-[11px] font-semibold tracking-[0.08em] text-ink-subtle">
                  לא הזמינו את המוצר הנבחר
                </span>
                <span
                  aria-hidden
                  className="h-0 flex-1 border-t-2 border-dashed border-border-strong"
                />
              </div>

              <div className="grid gap-4 p-4 xl:grid-cols-2">
                {other.map((customer, index) => (
                  <CustomerCard
                    key={customer.customerId}
                    {...shared}
                    customer={customer}
                    index={index}
                    section="other"
                    promoted={false}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

interface CardProps {
  customer: CustomerDemand;
  index: number;
  section: "ordering" | "other";
  promoted: boolean;
  selection: PickSelection | null;
  selected: SelectedPickLine | null;
  editable: boolean;
  saving: boolean;
  onPromote: (customerId: string) => void;
  onEditOrders: (customerId: string) => void;
  onArrange: (request: ArrangeRequest) => Promise<boolean>;
  onSave: (patch: AllocationPatch) => Promise<boolean>;
  onDelete: (recordId: string) => void;
}

function CustomerCard({
  customer,
  index,
  section,
  promoted,
  selection,
  selected,
  editable,
  saving,
  onPromote,
  onEditOrders,
  onArrange,
  onSave,
  onDelete,
}: CardProps) {
  // Which lines have their per-grower allocation list open. Local to the
  // card: expanding a line on one customer says nothing about any other.
  const [openLines, setOpenLines] = useState<Set<string>>(new Set());
  const toggleLine = (lineId: string) =>
    setOpenLines((open) => {
      const next = new Set(open);
      if (!next.delete(lineId)) next.add(lineId);
      return next;
    });

  const status = ORDER_STATUS[customer.status] ?? { label: customer.status, tone: "neutral" };
  const outstanding = customer.ordered - customer.allocated;
  const inOrderingSection = section === "ordering";

  // A promoted customer has no order line for the selected variety yet — by
  // design, since + writes nothing — so the row they are being offered has
  // to be synthesised here rather than read off the query result.
  const syntheticLine: CustomerOrderLine | null =
    promoted &&
    selection &&
    selected &&
    !customer.lines.some((l) => l.varietyId === selection.varietyId)
      ? {
          orderLineId: `pending:${customer.customerId}:${selection.varietyId}`,
          varietyId: selection.varietyId,
          varietyName: selected.line.varietyName,
          familyName: selected.family.familyName,
          ordered: 0,
          previousOrdered: null,
          allocated: 0,
          outstanding: 0,
          comment: null,
          allocations: [],
        }
      : null;

  const lines = syntheticLine ? [syntheticLine, ...customer.lines] : customer.lines;

  return (
    <article
      // Named, so the grid reads as a list of customers rather than as a run
      // of anonymous "article" landmarks.
      aria-label={customer.customerName}
      className={`animate-stagger-in flex flex-col overflow-hidden rounded-lg bg-surface shadow-card ring-1 ring-inset transition-shadow duration-200 ${
        customer.hasSelected || promoted ? "ring-accent/45" : "ring-border/70"
      }`}
      style={{ "--stagger-index": Math.min(index, 8) } as React.CSSProperties}
    >
      <header className="flex items-center gap-2 border-b border-border bg-surface-muted/40 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink" title={customer.customerName}>
            {customer.customerName}
          </p>
          {/* Only the fraction is forced LTR — the unit stays in the page's
              RTL flow, so this reads "0/11 משטחים" right-to-left rather than
              stranding the Hebrew word on the wrong side of the numbers. */}
          <p className="mt-0.5 text-[11px] text-ink-subtle">
            <span dir="ltr">
              {formatPallets(customer.allocated)} / {formatPallets(customer.ordered)}
            </span>{" "}
            משטחים
          </p>
        </div>

        {/* Only shown when something is still owed. A "0 חסר" chip on every
            settled customer is noise on a grid of thirty cards; the absence
            of the chip is the "done" signal. */}
        {outstanding > 0 && (
          <StatusPill tone="warning">חסר {formatPallets(outstanding)}</StatusPill>
        )}
        <StatusPill tone={status.tone}>{status.label}</StatusPill>

        {/* The lower section's + : offer this customer the selected product.
            Client-side only — see the note at the top of this file. */}
        {!inOrderingSection && selection && editable && (
          <button
            type="button"
            onClick={() => onPromote(customer.customerId)}
            aria-label={`הצע את המוצר הנבחר ל${customer.customerName}`}
            title="הוסף את המוצר הנבחר ללקוח זה"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent ring-1 ring-inset ring-accent/25 transition-colors duration-200 hover:bg-accent hover:text-accent-ink"
          >
            <Icon name="plusCircle" className="h-4 w-4" />
          </button>
        )}

        {/* Card-level pencil: edits the customer's ORDER, in a popup. Not to
            be confused with the pencil on a product row below, which edits
            the ARRANGEMENT for that row. Different objects, so they sit at
            different levels — this one beside the customer's name, that one
            beside the product it belongs to. */}
        <button
          type="button"
          onClick={() => onEditOrders(customer.customerId)}
          aria-label={`ערוך את הזמנת ${customer.customerName}`}
          title="ערוך הזמנת לקוח"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-200 hover:bg-accent-soft hover:text-accent"
        >
          <Icon name="pencil" className="h-3.5 w-3.5" />
        </button>
      </header>

      <ul className="flex-1">
        {lines.map((line) => (
          <OrderLineRow
            key={line.orderLineId}
            line={line}
            customerId={customer.customerId}
            customerName={customer.customerName}
            selection={selection}
            open={openLines.has(line.orderLineId)}
            onToggle={() => toggleLine(line.orderLineId)}
            editable={editable}
            saving={saving}
            onArrange={onArrange}
            onSave={onSave}
            onDelete={onDelete}
          />
        ))}
        {lines.length === 0 && (
          <li className="px-3 py-3 text-[11px] text-ink-muted">אין שורות בהזמנה.</li>
        )}
      </ul>
    </article>
  );
}

function OrderLineRow({
  line,
  customerId,
  customerName,
  selection,
  open,
  onToggle,
  editable,
  saving,
  onArrange,
  onSave,
  onDelete,
}: {
  line: CustomerOrderLine;
  customerId: string;
  customerName: string;
  selection: PickSelection | null;
  open: boolean;
  onToggle: () => void;
  editable: boolean;
  saving: boolean;
  onArrange: (request: ArrangeRequest) => Promise<boolean>;
  onSave: (patch: AllocationPatch) => Promise<boolean>;
  onDelete: (recordId: string) => void;
}) {
  const isSelected = selection?.varietyId === line.varietyId;
  const covered = line.allocated >= line.ordered && line.ordered > 0;
  const expandable = line.allocations.length > 0;

  return (
    <li
      className={`border-b border-border/60 last:border-b-0 ${
        isSelected
          ? "bg-accent-soft/45 shadow-[inset_3px_0_0_var(--color-accent)]"
          : // Fully covered lines get their own background, not just the
            // green arranged figure — a row a distributor doesn't need to
            // act on should be findable at a glance, not just on close
            // reading. Loses to selection above: mid-arrangement is a more
            // urgent state than already-done.
            covered
            ? "bg-warning-soft"
            : ""
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`הצג שיוכים עבור ${line.varietyName}`}
            className="group shrink-0"
          >
            <Icon
              name="chevronDown"
              className={`h-3.5 w-3.5 transition-[transform,color] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
                open ? "rotate-180 text-accent" : "text-ink-subtle group-hover:text-accent"
              }`}
            />
          </button>
        ) : (
          <span aria-hidden className="w-3.5 shrink-0" />
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-ink">
            {line.familyName && <span className="text-ink-muted">{line.familyName} · </span>}
            <span className="font-medium">{line.varietyName}</span>
          </span>
          {line.comment && (
            <span className="mt-0.5 block truncate text-[11px] italic text-ink-subtle">
              {line.comment}
            </span>
          )}
        </span>

        {/* The line's whole story: what we're giving them (allocated) and
            what they're asking for (ordered), always adjacent — arranged
            first, current order second, no arrow between the two. The arrow
            is reserved for order HISTORY: it only appears, with a third
            number, when the customer's current figure differs from their
            previous submission. Deliberately left in the page's RTL flow
            rather than forced dir="ltr" — DOM order is [before?, arrow?,
            ordered, allocated], which an RTL parent renders right-to-left as
            "before → current → allocated" and, read as pixels left-to-right,
            comes out "allocated current ← before" (arranged, current order,
            then what it changed from). */}
        <span
          className="shrink-0 text-xs tabular-nums"
          title={
            line.previousOrdered !== null
              ? `הוזמן ${formatPallets(line.ordered)} (היה ${formatPallets(line.previousOrdered)}), חולק ${formatPallets(line.allocated)}`
              : `הוזמן ${formatPallets(line.ordered)}, חולק ${formatPallets(line.allocated)}`
          }
        >
          {line.previousOrdered !== null && (
            <>
              <span className="text-ink-subtle">{formatPallets(line.previousOrdered)}</span>
              <span aria-hidden className="mx-1 text-ink-subtle">
                &#8592;
              </span>
            </>
          )}
          <span className="font-semibold text-ink">{formatPallets(line.ordered)}</span>
          <span aria-hidden className="whitespace-pre">   </span>
          {/* Green only once this line is fully covered — the one status
              worth a distinct color. Short of that, arranged and
              not-yet-arranged both read as the same dark orange: still
              needs attention, whether that's "partially done" or "not
              started" is a distinction this readout no longer draws. */}
          <span className={`font-semibold ${covered ? "text-accent" : "text-warning"}`}>
            {formatPallets(line.allocated)}
          </span>
        </span>

        {/* The arrangement editor, and ONLY on the row whose product is the
            one selected in the growers column. Every other row on the card
            stays a plain read-out — the reference's own rule, and the reason
            the screen never leaves any doubt about which pick line a ✓ is
            going to draw from. */}
        {isSelected && selection && editable && (
          <ArrangementCell
            // Keyed by pick line, so switching to another grower's lot
            // rebuilds the control from that lot's own allocation instead of
            // carrying the previous one's draft across.
            key={selection.pickLineId}
            customerId={customerId}
            customerName={customerName}
            existing={allocationFor(line, selection.pickLineId)}
            saving={saving}
            onArrange={onArrange}
          />
        )}
      </div>

      <div className="accordion-panel" data-open={open}>
        <div>
          <div className="border-t border-border/60 bg-surface-muted/40 px-3 py-2" inert={!open}>
            <ul className="flex flex-col gap-1.5">
              {line.allocations.map((allocation) => (
                <AllocationRow
                  key={allocation.recordId}
                  allocation={allocation}
                  editable={editable}
                  saving={saving}
                  onSave={onSave}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </li>
  );
}

// The ✓ / ✎ control from the reference: a quantity box and one button that
// commits it.
//
// The button is a two-state toggle rather than an always-live save. With a
// record already written the row is idle and shows a pencil; pressing it
// opens the box and the pencil becomes a ✓; pressing ✓ writes and it goes
// back to a pencil. A row with nothing arranged yet starts open, because
// there is nothing to protect and the distributor's next act is obviously to
// type a number.
function ArrangementCell({
  customerId,
  customerName,
  existing,
  saving,
  onArrange,
}: {
  customerId: string;
  customerName: string;
  existing: LineAllocation | null;
  saving: boolean;
  onArrange: (request: ArrangeRequest) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(existing === null);
  const [draft, setDraft] = useState(existing ? String(existing.quantity) : "");

  // Re-seed when the server's copy of this allocation changes under us,
  // tracking the last-seen value rather than syncing in an effect — an
  // effect would paint the stale number first and correct it a frame later.
  const serverQuantity = existing?.quantity ?? null;
  const [lastSeen, setLastSeen] = useState(serverQuantity);
  if (lastSeen !== serverQuantity) {
    setLastSeen(serverQuantity);
    setDraft(serverQuantity === null ? "" : String(serverQuantity));
    setEditing(serverQuantity === null);
  }

  const parsed = Number(draft);
  // Pallets are always whole units — never a fractional pallet.
  const valid = draft.trim() !== "" && Number.isInteger(parsed) && parsed > 0;
  const invalidDraft = editing && draft.trim() !== "" && !valid;
  // Compared as the number that would be SENT, not as typed, so re-entering
  // the same figure ("5" over a stored 5, or "05") is correctly nothing to
  // save. AllocationRow just below has always worked this way — it hides its
  // ✓ until the quantity differs — and this control now agrees with it.
  const dirty = parsed !== serverQuantity;

  const commit = async () => {
    if (!valid || !dirty) return;
    const saved = await onArrange({ customerId, quantityPallets: parsed, existing });
    // A refused write has to put the number back itself: a rejection leaves
    // the stored quantity exactly as it was, so the re-seed above sees no
    // change and would otherwise leave the box showing a figure the database
    // turned down, beside a "חולק" total that disagrees with it.
    if (saved) setEditing(false);
    else setDraft(serverQuantity === null ? "" : String(serverQuantity));
  };

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <input
        type="number"
        step="1"
        min={0}
        disabled={!editing || saving}
        aria-label={`כמות לסידור עבור ${customerName}`}
        aria-invalid={invalidDraft}
        className={`${inputClassName} h-7 w-16 px-2 text-xs ${
          invalidDraft ? "ring-danger focus:ring-danger" : ""
        }`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(serverQuantity === null ? "" : String(serverQuantity));
            if (serverQuantity !== null) setEditing(false);
          }
        }}
      />

      {editing ? (
        <button
          type="button"
          disabled={saving || !valid || !dirty}
          onClick={() => void commit()}
          aria-label={`שמור סידור עבור ${customerName}`}
          // Reopening a written row and pressing ✓ without touching the
          // number used to re-run arrange_to_customer for the value already
          // stored. Greyed out instead — but that leaves the box open with no
          // button to close it, so the tooltip names the key that does. Esc
          // was already the way out (see onKeyDown); it just never said so
          // while ✓ was always available.
          title={valid && !dirty ? "אין שינוי לשמירה — Esc לסגירה" : "שמור סידור (Enter)"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink shadow-card transition-colors duration-200 hover:bg-accent-hover disabled:bg-surface-muted disabled:text-ink-subtle disabled:shadow-none"
        >
          <Icon name="checkCircle" className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`ערוך סידור עבור ${customerName}`}
          title="ערוך סידור"
          className="animate-pop-in flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-accent ring-1 ring-inset ring-accent/35 transition-colors duration-200 hover:bg-accent-soft"
        >
          <Icon name="pencil" className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

// One existing arrangement record, inside a line's expanded list. This is
// where allocations from OTHER growers are read and removed — the ✓ control
// above only ever touches the selected pick line.
function AllocationRow({
  allocation,
  editable,
  saving,
  onSave,
  onDelete,
}: {
  allocation: LineAllocation;
  editable: boolean;
  saving: boolean;
  onSave: (patch: AllocationPatch) => Promise<boolean>;
  onDelete: (recordId: string) => void;
}) {
  const [draft, setDraft] = useState(String(allocation.quantity));

  const [lastServerQuantity, setLastServerQuantity] = useState(allocation.quantity);
  if (lastServerQuantity !== allocation.quantity) {
    setLastServerQuantity(allocation.quantity);
    setDraft(String(allocation.quantity));
  }

  const parsed = Number(draft);
  const dirty = draft !== String(allocation.quantity);
  // Pallets are always whole units — never a fractional pallet.
  const valid = draft.trim() !== "" && Number.isInteger(parsed) && parsed > 0;

  const revert = () => setDraft(String(allocation.quantity));

  const commit = async () => {
    if (!dirty || !valid) return;
    const saved = await onSave({
      id: allocation.recordId,
      quantityPallets: parsed,
      // Sent back unchanged on purpose: update_arrangement_record assigns
      // price and price_type unconditionally, so passing null here would
      // silently wipe the price off an already-priced record.
      price: allocation.price,
      priceType: allocation.priceType,
    });
    if (!saved) revert();
  };

  return (
    <li className="flex items-center gap-2 rounded-md bg-surface px-2 py-1.5 ring-1 ring-inset ring-border/70">
      <span
        className="min-w-0 flex-1 truncate text-[11px] text-ink-muted"
        title={allocation.growerName}
      >
        {allocation.growerName}
      </span>

      {editable ? (
        <>
          <input
            type="number"
            step="1"
            min={0}
            aria-label={`כמות משטחים מ${allocation.growerName}`}
            aria-invalid={!valid}
            className={`${inputClassName} h-7 w-20 px-2 text-xs ${
              !valid ? "ring-danger focus:ring-danger" : ""
            }`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter commits, Escape abandons. Never saved on blur: tabbing
              // between allocations while rebalancing them would fire a write
              // per stop, and each of those can be rejected for
              // over-allocation mid-way through a change that would have been
              // valid once finished.
              if (event.key === "Enter") {
                event.preventDefault();
                void commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                revert();
              }
            }}
          />

          {dirty && (
            <button
              type="button"
              disabled={saving || !valid}
              onClick={() => void commit()}
              aria-label="שמור כמות"
              title="שמור (Enter)"
              className="animate-pop-in flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink shadow-card transition-colors duration-200 hover:bg-accent-hover disabled:bg-surface-muted disabled:text-ink-subtle disabled:shadow-none"
            >
              <Icon name="checkCircle" className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            disabled={saving}
            onClick={() => onDelete(allocation.recordId)}
            aria-label={`מחק שיוך מ${allocation.growerName}`}
            title="מחק שיוך"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-200 hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:text-border-strong"
          >
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <span className="text-xs font-semibold tabular-nums text-ink" dir="ltr">
          {formatPallets(allocation.quantity)}
        </span>
      )}
    </li>
  );
}
