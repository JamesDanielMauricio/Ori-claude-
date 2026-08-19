---
title: "New Arrangement (wizard)"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The screen shown when `tab=new arrangement`. Wizard-style flow for building a new Daily Arrangement Record.

## Inputs the Distributor provides

- Product variety to match.
- Grower (which grower's pick supplies the pallets).
- Customer (which customer's order receives them).
- Number of pallets to assign.
- Price (computed from price type + variety price + any per-arrangement override).

## What happens on save

A new Daily Arrangement Record is created linking:

- The selected grower's Daily Pick Product (supply side).
- The selected customer's Daily Order Product (demand side).
- The variety, quantity, and price.

The new record participates in the day's arrangement summary and feeds into the close-arrangement workflow when the day terminates.

## Test implications

- Creating an arrangement record for a variety with no supply should be blocked or warned (over-allocation).
- Creating an arrangement record that exceeds the customer's ordered pallet count should be blocked or warned.
- The newly created record must be immediately visible in the Arrangement View.
