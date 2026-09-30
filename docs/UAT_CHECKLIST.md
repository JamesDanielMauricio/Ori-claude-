# UAT Checklist — pre-cutover sign-off

For a human to run through against the deployed rebuild before retiring the Bubble app. Derived
directly from the six PRD user flows named for this prompt (`reference/prd/sign-in.md`,
`edit-profile.md`, `manage-today-s-daily-pick.md`, `place-edit-today-s-order.md`, `reset-password-
admin-mediated.md`, `daily-trading-lifecycle.md`), plus the source's own documented performance
findings. Each item is something a person clicks through and observes — not a re-statement of the
automated test suite (`pnpm test`, `pnpm test:e2e`), which already covers the same ground
mechanically. Run this against a real deployed build, signed in as real (or realistic test) users
of each role — not against `localhost` with seeded fixtures only.

Legend: ☐ not yet run · ✅ passed · ❌ failed (file it before cutover) · ⚠️ known gap, see note

---

## 0. Before you start

- [ ] Confirm which environment you're testing (staging vs. the post-cutover production project) —
      the Supabase project ref and `.env` values in use.
- [ ] Confirm `WHATSAPP_ENV` is `dev` unless this is an intentional, sign-off-approved live-send
      test (`docs/ARCHITECTURE.md` § notifications module). **Never run this checklist's lifecycle
      flow (§ 6) against `WHATSAPP_ENV=live` casually** — it sends real WhatsApp messages to real
      recipients if the two toggles are also on.
- [ ] Have at least one real login for each role ready: backoffice, grower, customer.

---

## 1. Sign In (`reference/prd/sign-in.md`)

- [ ] Backoffice user + correct password → lands on `/backoffice/shop`, sidebar visible with all
      nav items, own name/company shown in the sidebar header.
- [ ] Grower user + correct password → lands on their grower home, own name/company shown.
- [ ] Customer user + correct password → lands on `/customer/order`, own name/company shown.
- [ ] Wrong password, any role → stays on `/login`, a visible error appears, no navigation happens.
- [ ] A customer navigating directly to a `/backoffice/*` URL while signed in → signed out and
      redirected to `/login` (cross-role access must not silently render).
- [ ] A user created via bulk import / admin reset, signing in for the first time → forced to
      `/change-password` before reaching their home page; cannot navigate away from it first.
- [ ] Already-signed-in user pastes `/login` into the address bar → confirm the actual behavior
      (redirected home, or shown the login form again) and that it's not a broken/blank state.

## 2. Edit Profile (`reference/prd/user-profile.md`, `edit-profile.md`)

`/profile` — self-service edit of the signed-in user's own `display_name`/`phone_number`. Not
role-scoped (any authenticated user can reach it). Email is deliberately **not** editable here —
it lives in `auth.users`, not `profiles`, and the PRD's own source flow persists email changes with
no verification step at all; this prompt's scope is `profiles` fields only, not a port of that
unverified behavior. Password change already lives at `/change-password` (Prompt 2), out of scope
here.

- [ ] A user can change their display name and phone without being asked for their password first.
- [ ] Saving persists — reload the page and confirm the new values are still there (not just held
      in local state). Automated: `apps/web/e2e/profile.spec.ts`.
- [ ] Pressing Cancel after typing into a field discards the edit — reload confirms the *original*
      value survived.

## 3. Submit / Manage Today's Pick (grower) (`reference/prd/manage-today-s-daily-pick.md`)

- [ ] A grower with in-season products, on a day the distributor has initiated, sees today's pick
      line(s) pre-populated (not blank) — the bootstrap ran.
- [ ] Editing pallet count and comment on a line and pressing Save persists — reload
      the page and confirm the values are still there (not just held in local state).
- [ ] Pressing Cancel after typing into a field discards the edit — reload confirms the *original*
      value survived, not the typed-but-uncancelled one.
- [ ] Submitting a pick moves its visible status forward (Draft → Submitted); the grower can still
      edit line items afterward (per the PRD, editing after submit is allowed and doesn't reverse
      status).
- [ ] Pickup time is a per-grower setting, not per-product: set a grower's default pickup time in
      `/backoffice/growers`, submit their pick for the day, then change the grower's default again —
      the already-submitted pick's collection time (shown on the arrangement board and on
      `/backoffice/distributor-grower`) stays at the value it had when submitted, not the new default.
- [ ] On `/backoffice/arrangement` (requires migration 0062), the truck icon beside a grower's pencil
      closes that grower's pick: pressing it lights it (tooltip "החזר למצב הקודם"), the pick's status
      becomes Closed ("סגור" on the grower's screen and on `/backoffice/distributor-grower`), and the
      state survives a reload. Pressing it again unlights it and puts the pick back the way it was —
      Submitted if the grower had sent it, Draft if not, never the other one. While it is closed the
      grower's own screen and both pencil popups are read-only, and the bell (reminder) is disabled;
      arranging against that grower's stock still works. The icon is left off once the trading day has
      ended, and the toggle is disabled while a past day is pinned.
- [ ] Saving or sending a pick never lights the truck: the grower's "שמור" on their own screen, and
      the distributor's "שמור" on `/backoffice/distributor-grower`, both submit the pick (the name
      turns green) while that grower's truck on `/backoffice/arrangement` stays unlit. Only closing
      a pick — pressing the truck — lights it.
- [ ] Closing the trading day's arrangement (sidebar's "סגירת יום עסקים") force-finalizes any pick
      still in Draft (a no-show) straight to Closed — it should not get stuck, and its pickup time
      still reflects the grower's default at that moment.
- [ ] A grower with **no** Daily Pick for today (distributor hasn't initiated a day yet) sees a
      sensible empty state, not an error or a blank screen.
- [ ] **Backoffice-as-grower** (`/backoffice/distributor-grower`): a backoffice user can open any
      grower's pick, edit a line on their behalf, and it persists — same underlying editor as the
      grower's own screen.
- [ ] On `/backoffice/distributor-grower`, pressing "שמור" in a grower's pencil popup and then
      "שמור ושלח" also submits that grower's pick: the toast says "הליקוט נשמר ונשלח.", and the
      grower's name turns green with "נשלח ב-…" under it. Opening the pencil on a draft pick and
      pressing "שמור" with nothing changed sends it too. (The pencil on `/backoffice/arrangement`
      only saves; the truck icon there closes the pick and does not send it.)
- [ ] Backoffice can add a grower's in-season products mid-day (via "ערוך מוצרים בעונה") and see a
      new pick line appear immediately for that grower without needing a full day restart.

## 4. Place / Edit Today's Order (customer) (`reference/prd/place-edit-today-s-order.md`)

- [ ] A customer sees today's orderable catalog grouped by product family; a variety with no
      picking across all growers (pallets picked + leftover = 0) does not appear, but its family still
      shows if a sibling variety in that family has picking.
- [ ] Leftover counts as picking: a variety with 0 pallets picked but some leftover appears. A
      variety that has picking at only one of two growers appears once, not twice.
- [ ] An overbooking allowance alone does not put a product in the shop: a variety with 0 picked, 0
      leftover and an overbooking allowance of 3 does not appear. The moment a grower picks 1 pallet
      of it, it appears (live, without a reload) and the customer can order up to 4 (1 + 3).
- [ ] The distributor's "בשם לקוח" order screen for a customer lists every product that has picking,
      including fully ordered ones (flagged "אזל מהמלאי", quantity typed freely), and every line already
      in that customer's order even when its picking is 0. Saving there never removes a line.
- [ ] Setting a pallet count and comment, then Save, opens a confirmation dialog showing the
      correct family/variety/pallet count summary before anything is actually submitted.
- [ ] Pressing "שלח הזמנה" (Send Order) submits without a visible page freeze or reload — the
      pallets input still shows the submitted value immediately, and it survives a manual page
      reload (proves it round-tripped to the server, not just local state).
- [ ] The customer can continue editing and re-submitting after the first submission, on the same
      open day.
- [ ] A variety that has picking but becomes fully ordered (picking + overbooking <= everything
      ordered, someone else's order plus this customer's own combined) **after** this customer
      already added it to their own cart stays visible to them, flagged "אזל מהמלאי" (the per-customer
      carve-out) — a customer who hasn't got it in their order does not see it at all.
- [ ] If the grower later lowers a product's picking to 0, it disappears from the screen of the
      customer who ordered it too. Their next save removes that order line (agreed). If the grower
      raises picking again before they save, the product is back with their quantity on it.
- [ ] Once the distributor closes the shop for the day, attempting to submit/edit the order fails
      with a visible, sensible error — never a silent accept into a shop that's actually closed.
- [ ] `/customer/history` shows past orders, newest first; clicking one shows its line items with
      correct pallet counts and comments; clicking a second-then-back-to-the-first previously-
      viewed order does not show a loading flicker (see § 7 for the underlying measured claim).

## 5. Admin-Mediated Reset (`reference/prd/reset-password-admin-mediated.md`)

- [ ] From `/backoffice/users/reset`, picking a user by name and submitting shows a success
      confirmation naming the last four digits of their phone — the recovery link itself is
      **never displayed to the admin**; it is sent to the target's own WhatsApp (the phone on
      their profile).
- [ ] With `WHATSAPP_ENV` other than `live`, the confirmation says the link went to the test
      phone (`notification_settings.whatsapp_dev_override_phone`) instead of the user.
- [ ] A user with no phone number on their profile cannot be submitted, and the screen says to add
      one on the Users screen.
- [ ] The target is signed out of every device they were logged in on, and at their next sign-in
      (or via the link) must set a new password.
- [ ] The target user can complete the recovery flow and sign in with their new password
      afterward.
- [ ] The admin who performed the reset remains signed in as themselves throughout — no session
      hand-off, no re-entering their own password mid-flow. The admin's own account isn't offered
      in the picker.

## 6. The Full Daily Lifecycle (`reference/prd/daily-trading-lifecycle.md`, `lifecycle-invariants.md`)

Run this against a **non-production** environment, or coordinate an explicit real-day window with
the distributor — this exercises the actual close-out sequence.

- [ ] **Initiate Business Day** — every active grower with in-season products gets a blank pick
      line automatically; no customer-visible catalog yet.
- [ ] **Open Shop** — customers see the catalog; growers can keep editing picks in parallel.
- [ ] **Close Shop** — customers can no longer submit/edit orders; growers can still revise picks
      (correcting counts, recording what's left).
- [ ] **Arrangement workspace** (`/backoffice/arrangement`) — pooled supply and pooled demand by
      variety are both visible and correct; a variety where demand exceeds supply is visually
      flagged. An expanded grower card lists only the products that grower has picking for
      (pallets picked + leftover), or has pallets arranged from — not the blank 0 / 0 line every
      in-season product starts the day with; a grower with none shows "אין מוצרים שנקטפו או
      עודפים". The "who has this?" filter and the green highlight follow the same rule, and the
      pencil's pick editor still lists every line.
- [ ] **New Arrangement** (`/backoffice/new-arrangement`) — pairing a grower's pick line to a
      customer's order line succeeds within each line's own remaining ceiling, and is rejected
      (with a clear message, not a silent no-op) if it would exceed either side's ceiling.
- [ ] **Close Arrangement** — pressing it is disabled until the day has actually reached
      "shop closed"; once pressed, every grower's pick locks (no further edits possible), prices
      populate on every arrangement record whose product has a price or a full price range, and
      the day drops out of the "currently open" view. A product with no price does not block the
      close: its record simply closes with no price (and no amount in the customer's message).
- [ ] **Customer Order Status** (`/backoffice/distributor-customer`): a backoffice user can see
      every active customer's order status for the day, open a customer, edit or create their order
      on their behalf (same underlying editor as the customer's own order screen), and send a
      reminder — the reminder is disabled once that customer's order is already submitted.
- [ ] **Order History** (`/backoffice/order-history`, read-only): picking a past date shows every
      customer order for that date; drilling into one shows ordered-vs-arranged pallets per line
      side by side — a mismatch (dispute case) is visible, not hidden. A date with no trading day
      shows a sensible empty state, not an error.
- [ ] **In-app alerts** — after closing, the affected growers/customers see a new unread alert
      (bell badge) the next time they're signed in, and tapping it navigates to the right screen
      (their order history / pick screen) with the badge clearing.
- [ ] **WhatsApp dispatch** (only if `WHATSAPP_ENV`/toggles are deliberately set for this test) —
      the correct recipients receive a message listing what was arranged for them; a company with a
      configured WhatsApp group gets one group message, a company without one gets individual
      per-user messages.
- [ ] **A new day can be initiated immediately after**, with no stale state left over from the
      previous day (no leftover picks/orders bleeding into the new day's catalog).
- [ ] **Double-click resilience**: rapidly clicking Close Shop or Close Arrangement twice does not
      produce two audit-log entries or double-send WhatsApp messages (the rebuild's own guarantee —
      the source's own documented double-click bug does not reproduce here).

## 7. Performance — measured, not just observed

These have an automated, numeric answer already (`apps/web/e2e/performance-verification.spec.ts`,
run via `pnpm test:e2e`) — use this section to confirm the *feel* matches the measured numbers on
whatever device/network the real users will actually use, since a fast dev machine on localhost
can mask something the automated run wouldn't catch (e.g. a slow real network).

- [ ] Switching between backoffice screens (e.g. ניהול חנות → מוצרים) feels instant — no visible
      white flash or multi-second pause. (Automated: measured 230-250ms warm, comfortably under
      the source's own 1-second acceptance criterion.)
- [ ] Re-opening a customer order-history row you already viewed earlier in the session shows
      instantly, no spinner. (Automated: confirmed exactly one network request on first view, zero
      additional requests on revisit within the cache window — this was a real, measured regression
      caught and fixed during this same verification pass; see `docs/ARCHITECTURE.md` §
      Performance verification.)
- [ ] Re-selecting a customer you already viewed this session on
      `/backoffice/distributor-customer` shows instantly, no spinner — the same cache-reuse
      guarantee as customer order-history, now verified against the screen the source's Issue 3
      (Expand/Collapse Lag) actually named. (Automated: `apps/web/e2e/distributor-customer.spec.ts`
      confirms one request per customer's first view, zero additional requests on revisit.)
- [ ] Submitting a customer order does not freeze the page or trigger a visible full-page reload.
      (Automated: confirmed via an in-memory marker that a real reload would have wiped — it
      didn't.)

---

## Sign-off

| Section | Result | Notes |
| --- | --- | --- |
| 1. Sign In | | |
| 2. Edit Profile | | |
| 3. Submit/Manage Pick | | |
| 4. Place/Edit Order | | |
| 5. Admin-Mediated Reset | | |
| 6. Full Daily Lifecycle | | |
| 7. Performance | | |

Tester: ________________  Date: ________________  Environment tested: ________________
