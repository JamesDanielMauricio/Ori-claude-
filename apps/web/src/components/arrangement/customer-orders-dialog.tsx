import { OrderLinesEditor } from "@/components/customer/order-lines-editor";
import { Dialog } from "@/components/ui/dialog";

// The popup behind the pencil on a customer card's header.
//
// It edits the customer's ORDER — what they asked for — which is a different
// object from the arrangement the ✓ on a product row writes, and the reason
// the two controls sit at different levels of the card.
//
// Deliberately not a new editor: this is the same OrderLinesEditor the
// customer's own order screen and the "בשם לקוח" oversight screen already
// mount, under the same backoffice-on-behalf-of path
// (get_orderable_catalog_for_customer and submit_order both accept "the
// owning customer, or backoffice" — migration 0028). A second order editor
// would be a second place for the shop's ordering rules to drift.
//
// Opening it from here rather than navigating to /backoffice/distributor-
// customer matters for the board's whole method: the distributor is working
// one grower's pick line down a list of customers, and leaving the page to
// fix somebody's order would lose that position.
export function CustomerOrdersDialog({
  tradingDayId,
  customerId,
  customerName,
  onClose,
  onSubmitted,
  readOnly = false,
}: {
  tradingDayId: string;
  customerId: string | null;
  customerName: string;
  onClose: () => void;
  onSubmitted: () => void;
  // Forwarded straight through to OrderLinesEditor's own `readOnly`. The
  // board passes this whenever the sidebar's date picker
  // (lib/trading-day-view.tsx) has pinned a day other than the live one —
  // unlike PickLinesEditor, this editor has no status of its own to fall
  // back on, so without this prop a pinned historical order would render
  // fully live and only fail once "שמור" was actually pressed.
  readOnly?: boolean;
}) {
  return (
    <Dialog
      open={customerId !== null}
      onClose={onClose}
      title={`הזמנה — ${customerName}`}
      // The catalogue editor needs the room; at the default width its
      // price/pallets/comment row wraps into a column.
      size="lg"
    >
      {/* Keyed by customer so switching from one card's pencil to another's
          remounts the editor rather than showing the previous customer's
          draft against the new one's name. */}
      {customerId !== null && (
        <OrderLinesEditor
          key={customerId}
          tradingDayId={tradingDayId}
          customerCompanyId={customerId}
          onSubmitted={onSubmitted}
          readOnly={readOnly}
        />
      )}
    </Dialog>
  );
}
