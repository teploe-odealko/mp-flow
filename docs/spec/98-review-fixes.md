# Review Fixes After 27-Step Reassessment

This file records how the concrete review remarks were handled.

## Fixed

### 1. Chart Of Accounts Seed

Updated:

- `steps/03-accounting-core/spec.md`;
- `00-decisions.md`;
- `99-consistency-check.md`.

The chart seed now includes all accounts used by later steps:

- `62`;
- `76.02`;
- `76.ТП`;
- `80.02`;
- `84`;
- `91.01`;
- `91.02`;
- `94`;
- `26`;
- earlier `41.*`, `50`, `51`, `60.*`, `80.01`, `90.*`, `44`.

`76.МП` is explicitly forbidden; use `76.ТП Расчеты с точками продаж`.

### 2. Payment Direction And Payment Types

Updated:

- `steps/09-supplier-payments/spec.md`;
- `steps/11-procurement-costs/spec.md`;
- `steps/20-payouts-reconciliation/spec.md`;
- `steps/21-operating-expenses/spec.md`;
- `00-decisions.md`;
- `99-consistency-check.md`.

`payment` now has:

- `payment_direction in ('incoming','outgoing')`;
- expanded `payment_type`;
- positive amounts only.

This covers supplier payments, procurement cost payments, channel payouts, operating expense payments and owner withdrawals.

### 3. Warehouse Type And Channel-Agnostic Boundary

Already fixed before this review pass:

- `steps/06-warehouses-opening-balances/spec.md` uses `warehouse_type in ('own','transit','sales_point')`;
- step 6 explicitly says not to seed Ozon/Wildberries warehouses;
- `steps/14-sales-channels/spec.md` links channels to `sales_point` warehouses.

No further text change was needed except preserving this invariant in `00-decisions.md`.

### 4. Document Type Registry

Updated:

- `steps/04-documents-core/spec.md`;
- `00-decisions.md`;
- `99-consistency-check.md`.

Added `document_type_registry` with canonical codes, module owner, posting rule code and reversal/draft flags. Posting an unknown document type is now invalid.

### 5. FIFO Application Tables

Updated:

- `steps/07-fifo-lots/spec.md`;
- `steps/17-sales/spec.md`;
- `steps/18-returns/spec.md`;
- `00-decisions.md`;
- `99-consistency-check.md`.

`cost_application` is now the single physical FIFO journal. Sales use rows with `target_type='sale'`; returns restore cost from original `cost_application` rows. `sale_cost_application_view` may exist only as a read-only view, not as a separate ledger.

### 6. External Event To Finance Event Idempotency

Updated:

- `steps/16-sync-inbox/spec.md`;
- `steps/19-channel-fees/spec.md`;
- `99-consistency-check.md`.

Imported finance events are one-to-one by `external_event_id`. Raw payload remains in `external_event`; `channel_finance_event` stores normalized accounting fields.

### 7. Observed Stock Without Location Mapping

Updated:

- `steps/16-sync-inbox/spec.md`;
- `99-consistency-check.md`.

`observed_stock.warehouse_id` may be null while the channel has no linked sales point. Such rows get `location_status='needs_location'` and cannot create accounting discrepancies until mapped.

### 8. Payout Source Document

Updated:

- `steps/20-payouts-reconciliation/spec.md`.

`payout.document_id` is now `not null`. A payout draft is already a source document; posting creates journal entries and links/creates incoming `payment_type='channel_payout'`.

### 9. Actor Fields And Step 27 Migration

Updated:

- `steps/04-documents-core/spec.md`;
- `steps/27-users-audit-agents/spec.md`;
- `99-consistency-check.md`.

Step 4 now reserves `*_user_id`, `*_agent_token_id` and label fields instead of using only free-text `actor`. Step 27 adds FK constraints and permission semantics.

### 10. Forward FK From Finance Events To Payouts

Updated:

- `steps/19-channel-fees/spec.md`;
- `steps/20-payouts-reconciliation/spec.md`.

Step 19 leaves `payout_id` as a nullable UUID because `payout` does not exist yet. Step 20 explicitly adds the FK constraint.

### 11. Temporary Account Closing Policy

Updated:

- `00-decisions.md`;
- `99-consistency-check.md`.

The system does not close `90.*`, `91.*`, `26`, `44` into `99`/`84` in this roadmap. P&L uses period turnovers; balance presentation derives current-period result into equity.

### 12. Open-Period Correction Wording

Updated:

- `steps/23-corrections-recalculation/spec.md`;
- `00-decisions.md`;
- `99-consistency-check.md`.

Removed the ambiguous `delete and rebuild posted entries` meaning. Corrections preserve source rows and use reversal/superseding rows. Only derived projections/read models may be invalidated and rebuilt.

## Partially Fixed

### 13. Render Brand Mismatch

Updated:

- `00-decisions.md`.

The normative UI brand is `MPFlow`. Some generated PNGs may still contain stray placeholder brand or organization names from image generation. The text contracts are authoritative.

If the PNGs are used as pixel-level implementation references, regenerate those renders with an explicit brand constraint before implementation of the affected step.
