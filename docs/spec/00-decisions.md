# Architecture Decisions For MPFlow

## Product Scope

MPFlow is a local-first managerial accounting system for a reseller selling through Russian marketplaces and other sales channels.

The roadmap covers the full business cycle:

- setup, periods, documents, journal and ledger;
- product catalog, product images and external product links;
- opening balances, FIFO lots, warehouse stock and sales points;
- supplier purchase orders, payments, receipts, additional procurement costs and shortages;
- transfers to sales points;
- channel/plugin connections, sync runs, raw external events and observed stock;
- sales, returns, channel fees, payouts and reconciliation;
- operating expenses, owner contributions and withdrawals;
- inventory reconciliation, corrections, recalculations, reports and period closing;
- users, roles, audit log and controlled agent/MCP access.

The system is not a regulated Russian бухгалтерия replacement and does not produce tax declarations in this roadmap. It is a управленческий учет system. Russian legal/tax exports may be added later, but the core must already keep a defensible source-document and audit trail.

## Project Layout

Create a new isolated project:

```text
/Users/dvlatypov/proj/mp-flow
```

Do not extend the existing `accounting` project as a separate module. The current project can be read for scenario inspiration, but the new implementation must not import its domain or persistence code.

## Stack

- Backend API: Hono, TypeScript, Zod.
- Frontend UI: React and TanStack Query.
- Frontend tooling: Vite. Vite is not a backend framework and does not replace Hono.
- Database: PostgreSQL.
- Tests: Vitest for unit/integration/scenario tests.
- Local runtime: Docker Compose for PostgreSQL.

## Database Naming

Do not use the `acc_` prefix. The service has its own database schema, so table names are direct.

Core tables:

```text
organization
accounting_policy
accounting_period
chart_account
journal_entry
journal_line
document
document_type_registry
document_line
document_version
document_link
audit_event
```

Products and inventory:

```text
product
product_image
warehouse
stock_state
inventory_lot
stock_movement
cost_application
inventory_cost_adjustment
stock_transfer
stock_transfer_line
stocktake
stocktake_line
inventory_discrepancy
stock_adjustment
stock_adjustment_line
```

Procurement, settlements and money:

```text
counterparty
purchase_order
purchase_order_line
goods_receipt
goods_receipt_line
procurement_cost
procurement_cost_line
shortage_resolution
shortage_resolution_line
supplier_claim
cash_account
payment
payment_allocation
settlement_entry
operating_expense
expense_category
owner_transaction
```

Channels, sales and payouts:

```text
integration_plugin
sales_channel
channel_credential
channel_capability
external_product
product_external_link
sync_run
sync_stream_run
external_event
observed_stock
sale
sale_line
sales_return
sales_return_line
return_cost_restoration
channel_finance_event
sale_profit_component
payout
payout_line
reconciliation_item
```

Control, reports and access:

```text
correction_case
document_dependency
recalculation_job
report_snapshot
report_saved_view
backfill_project
backfill_item
opening_balance_batch
period_closing_run
period_closing_check
period_lock
user_account
role
user_role
agent_token
channel_agent_permission
```

## Start Date Meaning

The accounting start date is the boundary of accounting truth:

- opening balances are created on this date;
- reports are reliable from this date forward;
- imported events before this date are historical reference data unless a backfill workflow materializes them;
- inventory lots created by opening balances become the initial cost base for future FIFO consumption;
- direct posting before the start date is rejected unless the system operation is explicitly marked as setup/backfill.

If the user chooses an old start date, the system treats that date as a real accounting cutover date. The user must enter opening balances as of that old date and then enter or import all relevant operations after it. If they do not, reports for the gap between the old date and today will be incomplete. The UI must show a strong warning when the selected date is older than the current month and recommend using the actual cutover date for starting the system.

The start date is not a tax registration date and not necessarily the date the business began. It is the date from which this system becomes the source of accounting truth.

## Legal Details In Onboarding

Required onboarding fields:

- display name;
- legal form, default `ip`;
- timezone;
- accounting start date;
- tax mode and cost method.

INN is optional in this managerial-accounting roadmap. If provided, it must be valid enough for future tax/reporting exports. It can become required later for KUDiR, regulated document templates or external legal integrations.

## Accounting Model

The system uses source documents, journal entries and ledger balances:

```text
User action -> Document -> Posting engine -> Journal entries -> Ledger and reports
```

Users should not manually choose debit and credit accounts during ordinary workflows. Posting rules are owned by the backend.

This follows the OpenStax accounting cycle used during planning:

- identify an economic event and keep the source document;
- record it chronologically in the journal;
- post journal lines to the ledger by account;
- check equality of debit and credit totals;
- prepare reports from ledger balances;
- close or lock periods after review so later corrections are explicit.

For this service, `document` is the source-document layer, `journal_entry` and `journal_line` are the journal layer, and ledger screens are read models over posted journal lines. Business screens must never let the user fix the ledger directly; they should fix the underlying document while the period is open, or use an adjustment/reversal workflow.

## Document Type Registry

Every document type must be registered in `document_type_registry` before a workflow can post it. This avoids magic strings across modules.

The registry owns:

- canonical document code;
- module owner;
- Russian display name;
- whether the document is posting or informational;
- posting rule code;
- whether draft/reversal/correction is allowed.

New steps add their document types through migrations. Posting an unknown document type is a backend error, not a UI fallback.

## Payment Model

`payment` is the single money-movement table for incoming and outgoing cash/bank movements. It is not supplier-payment-only.

Mandatory distinction:

- `payment_direction='incoming' | 'outgoing'`;
- `payment_type` describes business purpose: owner contribution, supplier payment, procurement cost payment, channel payout, operating expense payment, owner withdrawal, other incoming/outgoing.

Amounts are always positive. The direction determines whether the cash account increases or decreases. Negative payments are not used to represent outgoing money.

## Chart Of Accounts Seed

The seed from step 3 must include all accounts required by the roadmap before steps 11+ are implemented:

- inventory: `41.01`, `41.02`, `41.03`;
- cash: `50`, `51`;
- receivables/payables: `60.01`, `60.02`, `62`, `76.02`, `76.ТП`;
- equity/result: `80.01`, `80.02`, `84`;
- sales/result accounts: `90.01`, `90.02`, `91.01`, `91.02`, `94`;
- expenses: `26`, `44`.

Do not seed `76.МП`. Use `76.ТП Расчеты с точками продаж` because a sales channel can be a marketplace, manual channel, wholesale point or future plugin.

## Amounts

- Accounting currency: RUB.
- Money amounts: `numeric(18,2)`.
- Quantities: `numeric(18,4)`.
- Unit costs: `numeric(18,6)`.
- Supplier currency amounts are stored separately from RUB accounting amounts.

For purchases in CNY/USD/etc., supplier-currency line amounts are allocation weights, not accounting RUB amounts. The user can enter actual RUB paid plus bank/commission amount, and the backend allocates RUB cost over the supplier-currency line basis.

## Period And Correction Policy

- Draft documents can be edited freely.
- Posted documents in open periods can be edited only with version history, impact preview and recomputation.
- Posted documents in closed periods cannot be edited directly.
- Closed-period corrections use reversal/current-period adjustment workflows.
- Recalculation jobs rebuild dependent FIFO cost, sale margins, settlements and report snapshots from source documents.
- Posted journal entries and stock/cost source rows are not physically deleted during corrections. Derived read models may be invalidated/rebuilt, but source effects are neutralized through reversal/superseding rows.

## Header Period Selector

The topbar period dropdown, for example `Июнь 2026`, is not a free-form date picker. It selects the current working accounting period for the UI.

It affects:

- default filters on journal, ledger, documents, inventory, money, procurement, sales and reports;
- default accounting dates in new document forms;
- whether posting actions are enabled when the selected period is closed;
- dashboard/KPI period context.

It does not:

- change the accounting start date;
- close or reopen a period;
- rewrite existing documents;
- replace explicit date fields inside document forms.

If the user selects a closed period, historical data remains visible, but create/post actions are disabled or route to a correction workflow.

## Why Period Closing Exists

Period closing gives the service a control boundary:

- prevents accidental edits to months that were already reviewed;
- makes reports stable after review;
- forces corrections to be explicit through adjustment/reversal flows;
- gives a checklist point for missing costs, unsynced channel data, unmatched events, inventory discrepancies and reconciliation issues;
- lets future reporting rely on period snapshots and faster reconciliations.

The full closing checklist is implemented in step 26. Earlier steps may show period status, but they must not pretend that a closed period can be changed directly.

## No Temporary Account Closing Entries In This Roadmap

This managerial system does not close `90.*`, `91.*`, `26`, `44` into `99` and then `84` at month end in the initial roadmap.

Reporting implication:

- P&L uses period turnovers of income and expense accounts;
- balance sheet derives current-period result into the equity section for presentation;
- period closing locks documents and snapshots reports, but does not create ordinary revenue/expense closing entries.

If regulated accounting or explicit temporary-account closing is added later, it must be a separate policy and posting workflow.

## Inventory Accounting Mode

The service uses a perpetual inventory model for товарный учет: receipts, additional capitalized costs, transfers, sales, returns, losses and surpluses update inventory records when source documents are posted.

`cost_application` is the single physical FIFO journal. Sales, transfers, write-offs, return restoration and corrections may expose typed read models, but they must point back to `cost_application` instead of creating parallel FIFO ledgers.

User-facing labels:

- `Inventory` -> `товарный остаток`, `товары`, `партии себестоимости`;
- `Cost of Goods Sold / COGS` -> `себестоимость продаж`;
- `Accounts Payable` -> `задолженность поставщикам`;
- `Accounts Receivable` -> `дебиторская задолженность`, `расчеты с точками продаж`;
- `Cash` -> `деньги`, `расчетный счет`, `касса`.

## Sales Points And Marketplace Boundary

Core inventory uses the generic terms `точка продаж` and `внешний склад`. Do not hard-code Ozon/Wildberries into warehouse types, account names or seed data.

Marketplace plugins may create or link concrete sales points such as Ozon FBO, Wildberries FBO, offline retail, wholesale point or another channel.

Channel facts are separated from accounting facts:

```text
Observed external fact -> raw external event / observed stock -> validation/mapping -> accounting document
```

Observed stock does not change book stock by itself.

## Product Visual Identity

Product image is optional, but product tables should display a small thumbnail wherever it helps the user distinguish similar SKUs:

- product list;
- inventory balances;
- opening balance lines;
- purchase order lines;
- receipt lines;
- FIFO lots and stock movements;
- transfer, sale, return, reconciliation and report rows where product identity matters.

If no product image exists, show a neutral placeholder based on SKU/name. Do not block product creation because an image is missing.

Brand is optional and secondary. The primary product identity is SKU, name, unit, dimensions and optional photo.

## Audit Trail And Controls

Every material operation must leave a trace:

```text
source document -> document versions/audit events -> journal entry -> ledger -> report
```

This is the AIS/audit-trail principle from OpenStax applied to MPFlow:

- do not physically delete posted documents;
- keep document versions when a posted document changes in an open period;
- link payments, receipts, lots, movements, sales, returns, fees, payouts and journal entries back to source documents;
- make closed-period corrections explicit;
- keep marketplace-imported observations separate from accounting documents until a user or rule accepts them as accounting facts;
- keep audit events for privileged actions, agent calls, period closing and correction workflows.

## Render Design Discipline

Renders should not duplicate the same field as both content and decoration. Repetition is acceptable only when it has a different job: navigation progress, editable form input or final confirmation summary.

Settings pages must not introduce a secondary settings sidebar unless a future workflow truly needs one. The main application sidebar is enough for navigation.

Do not add global quick-action panels to make a screen look fuller. If an action is needed, place it inside the relevant section, for example `Изменить` inside `Организация`, `Провести` inside a document row or `Закрыть период` inside the period-closing page.

The product brand in UI renders is `MPFlow`. If an image generation pass produces a stray placeholder brand or organization name, the text contract is authoritative and the render should be regenerated before being used as a pixel-level implementation reference.
