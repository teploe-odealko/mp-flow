# MPFlow Specification

This folder contains the full implementation roadmap for the new local accounting service:

```text
/Users/dvlatypov/proj/mp-flow
```

The specification is stored outside the service code so each step can be reviewed, corrected, rendered and accepted before implementation.

## Core Decisions

- Backend API: Hono.
- Frontend UI: React, with Vite only as the frontend dev server/build tool.
- Database: PostgreSQL.
- Runtime: local development first; deployment is outside this spec.
- Existing `/Users/dvlatypov/proj/mp-flow/accounting` is a scenario reference only, not a technical base.
- Database tables do not use the `acc_` prefix because `MPFlow` has an isolated schema.
- The accounting model is document-based and uses double-entry bookkeeping.
- The user works with business actions; ordinary workflows never require manual debit/credit entry.
- Marketplace/channel integrations are plugin-based and keep raw external facts separate from accounting documents until processing rules materialize them.

## Step Index

| Step | Folder | User Value |
| --- | --- | --- |
| 1 | `steps/01-app-shell` | Local project shell, default home page and navigation foundation |
| 2 | `steps/02-organization-policy-periods` | Configure organization, accounting policy and periods |
| 3 | `steps/03-accounting-core` | View chart of accounts, journal and ledger |
| 4 | `steps/04-documents-core` | Work with document registry, document card, versions and links |
| 5 | `steps/05-products` | Create and manage internal products |
| 6 | `steps/06-warehouses-opening-balances` | Create warehouses and opening inventory balances |
| 7 | `steps/07-fifo-lots` | Inspect FIFO lots and stock movements |
| 8 | `steps/08-purchase-orders` | Create supplier purchase orders |
| 9 | `steps/09-supplier-payments` | Record owner contributions and supplier advances |
| 10 | `steps/10-goods-receipts` | Receive purchased goods and create FIFO lots |
| 11 | `steps/11-procurement-costs` | Add delivery/customs/packaging costs into actual inventory cost |
| 12 | `steps/12-shortages-claims` | Resolve shortages as supplier claims, losses or closed order remainders |
| 13 | `steps/13-stock-transfers` | Move stock and cost between own warehouse, transit and sales points |
| 14 | `steps/14-sales-channels` | Connect generic sales channels and marketplace plugins |
| 15 | `steps/15-product-channel-mapping` | Link external product cards to internal products |
| 16 | `steps/16-sync-inbox` | Sync raw external events and observed stock without mutating books |
| 17 | `steps/17-sales` | Recognize sales, revenue and FIFO себестоимость продаж |
| 18 | `steps/18-returns` | Process returns and restore cost from original sales |
| 19 | `steps/19-channel-fees` | Account for channel commissions, logistics, penalties and compensation |
| 20 | `steps/20-payouts-reconciliation` | Reconcile channel payouts with bank receipts and clearing balance |
| 21 | `steps/21-operating-expenses` | Record operating expenses and owner withdrawals |
| 22 | `steps/22-inventory-reconciliation` | Run stocktake and resolve book-vs-observed inventory discrepancies |
| 23 | `steps/23-corrections-recalculation` | Correct user mistakes with preview, audit trail and recalculation |
| 24 | `steps/24-reports-analytics` | Provide P&L, balance, cash flow, inventory and unit-economics reports |
| 25 | `steps/25-existing-store-onboarding` | Start accounting for an already operating marketplace store |
| 26 | `steps/26-period-closing` | Close periods with data quality checklist and report snapshots |
| 27 | `steps/27-users-audit-agents` | Manage users, roles, audit log and controlled agent/MCP access |

## Product Spine

The system is built around one chain:

```text
Business action
-> source document
-> posting engine
-> journal entry
-> ledger and subsidiary ledgers
-> reports and reconciliation
```

Inventory follows perpetual accounting: receipts, transfers, sales, returns, write-offs and surpluses update stock and FIFO cost layers when their source documents are posted.

Marketplace/channel data follows a separate chain:

```text
Plugin sync
-> raw external event / observed stock
-> mapping and validation
-> accounting document
-> journal / stock / settlement effect
```

Observed stock never changes book stock by itself.

## Render Rule

Renders are generated only for real user-facing screens. Technical screens such as `Backend OK` are not product workflows and are not included.

Each `spec.md` links to its render files with Markdown image links. The render gives the visual target; the text spec remains the source of truth for exact backend, database, validation and accounting behavior.

Avoid duplicated UI meaning. A wizard progress item may show where the user is, but the active form owns the actual input. Summary panels repeat values only when they are confirmation/read-only context for a decision.

## Consistency Check

After changing steps, update and review:

- `00-decisions.md` for global architectural decisions;
- `99-consistency-check.md` for cross-step dependencies, accounting invariants and end-to-end scenarios.
