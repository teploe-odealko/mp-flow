# Consistency Check For MPFlow

## Accounting Spine

All steps form one system, not separate screens:

```text
Organization setup
-> accounting policy and periods
-> chart of accounts
-> source documents
-> journal entries
-> ledger/report read models
-> products
-> inventory lots and stock movements
-> procurement, payments, receipts, additional costs and shortages
-> transfers to sales points
-> channel integrations and raw external facts
-> product mapping
-> sales, returns, fees and payouts
-> expenses, reconciliations, corrections and period closing
-> reports, audit and controlled agent access
```

This matches the OpenStax accounting cycle:

- identify the economic event;
- keep the source document;
- record balanced journal entries;
- post to the ledger;
- reconcile subsidiary ledgers and control accounts;
- prepare reports from ledger balances and supporting schedules;
- close reviewed periods so later corrections are explicit.

## Step-To-Step Dependency Check

| Step | Adds | Depends On | Must Not Break |
| --- | --- | --- | --- |
| 1 | Local app shell, navigation, Hono API, PostgreSQL migration base | none | no user-facing technical health screens |
| 2 | Organization, accounting policy, accounting periods | 1 | start date as accounting truth boundary |
| 3 | Chart of accounts, journal, ledger | 1-2 | debit total equals credit total |
| 4 | Source document lifecycle, versions, links, audit trail | 1-3 | ledger is not edited directly |
| 5 | Product catalog and images | 1-4 | product creation creates no accounting facts |
| 6 | Warehouses, stock states, opening balances, first lots | 1-5 | inventory asset equals account 41 balance |
| 7 | FIFO read model, movements, cost applications | 1-6 | lot quantities never go negative |
| 8 | Supplier purchase orders | 1-7 | order creates no cash, stock, payable or journal entry |
| 9 | Cash accounts, owner contributions, supplier advances | 1-8 | supplier prepayment is advance, not inventory |
| 10 | Goods receipts, RUB allocation, FIFO lots, advance setoff | 1-9 | receipt creates inventory and payable, then setoff |
| 11 | Capitalized procurement costs | 1-10 | freight-in changes inventory cost, not sales fee expense |
| 12 | Shortage decisions and supplier claims | 1-11 | shortage does not edit posted receipt quantities |
| 13 | Stock transfers to transit/sales points | 1-12 | transfer preserves total inventory value |
| 14 | Sales channels and plugin connections | 1-13 | connection creates no accounting facts |
| 15 | External product mapping | 5, 14 | mapping changes future processing, not posted documents directly |
| 16 | Sync runs, raw external events, observed stock | 14-15 | observed stock does not mutate book stock |
| 17 | Sales, revenue and FIFO себестоимость продаж | 13, 15-16 | gross revenue and cost are separate entries |
| 18 | Returns and cost restoration | 17 | return restores original sale cost, not arbitrary cost |
| 19 | Channel fees and logistics | 16-18 | fees do not reduce gross revenue |
| 20 | Payouts and clearing reconciliation | 17-19 | payout does not create revenue again |
| 21 | Operating expenses and owner withdrawals | 9, 24-ready accounts | owner withdrawal is not P&L expense |
| 22 | Stocktake and book-vs-observed reconciliation | 13, 16-18 | adjustment document changes stock, not observation edit |
| 23 | Corrections, reversals and recalculation jobs | 4, 7, 17-22 | ledger rows are never manually edited |
| 24 | Reports and analytics | 3, 7, 17-23 | reports drill down to source documents |
| 25 | Existing-store onboarding/backfill | 14-16, 5-7 | old start date risk is explicit |
| 26 | Period closing checklist and locks | 2, 23-24 | closed periods block direct edits |
| 27 | Users, roles, audit, agents | all operational steps | agent access cannot bypass validators |

## End-To-End Reseller Scenario

### 1. Start

User sets accounting start date `2026-06-01`, creates cash account, contributes owner funds and creates opening balances if store already has inventory.

Journal for owner contribution:

```text
Дт 51 Расчетный счет
Кт 80.01 Вложения владельца
```

Opening inventory:

```text
Дт 41.* Товары
Кт 80.01 / 84 Начальный капитал/накопленный результат
```

### 2. Purchase From Supplier

User creates purchase order in CNY. No journal entry is created because the order is a commitment, not yet an asset/payable/cash movement.

Shipment/tracking information, if entered, is operational metadata on the purchase order. It is not a required accounting step and can be skipped without blocking payment or receipt.

Supplier payment before receipt:

```text
Дт 60.02 Авансы поставщикам
Кт 51 Расчетный счет
```

The payment does not create inventory cost immediately. It becomes the default RUB goods-cost source for the later receipt through `payment_allocation(allocation_purpose='goods_purchase')`.

Receipt of goods:

```text
Дт 41.01 Товары на своем складе
Кт 60.01 Задолженность поставщикам

Дт 60.01 Задолженность поставщикам
Кт 60.02 Авансы поставщикам
```

The receipt form pre-fills `goods_cost_rub_total` from linked supplier payments. The user confirms it or overrides with a reason; they do not type the same amount twice in the normal full-prepayment flow.

If the receipt is partial or has shortage, the form does not allocate the full prepaid order amount to received goods. It suggests the proportional purchase-cost share for received quantities and keeps the paid share of missing goods on `60.02` until shortage resolution.

Example: order `1,000 pcs`, supplier payment `130,000 RUB`, actual receipt `990 pcs`. The receipt capitalizes `128,700 RUB`; `1,300 RUB` remains supplier advance for the missing 10 pcs. The missing share is resolved later as a second receipt, supplier claim, loss, or no-accounting close in the shortage workflow.

Additional delivery/customs cost:

```text
Дт 41.* Товары
Кт 60.01 / 51
```

If some related goods are already sold, capitalized cost is split between remaining inventory and `90.02 Себестоимость продаж`.

### 3. Shortage

If not all goods arrived, user resolves the unreceived remainder:

- supplier claim:

```text
Дт 76.02 Претензии поставщикам
Кт 60.02 Авансы поставщикам
```

- accepted loss:

```text
Дт 91.02 Прочие расходы / потери
Кт 60.02 Авансы поставщикам
```

- unpaid closed remainder:

```text
No journal entry.
```

### 4. Transfer To Sales Point

User transfers goods from own warehouse to transit and then to sales point.

```text
Дт 41.02 / 41.03
Кт 41.01 / 41.02
```

Quantity and FIFO cost move together. No revenue or expense is recognized.

### 5. Channel Sync And Product Mapping

Plugin sync stores external cards, observed stock, sales events, returns, finance operations and payouts as raw facts.

Raw external facts do not change the books. Product mapping makes events processable.

### 6. Sale

Imported or manual sale posts two effects:

```text
Дт 76.ТП Расчеты с точками продаж / 62 Дебиторская задолженность
Кт 90.01 Выручка

Дт 90.02 Себестоимость продаж
Кт 41.03 Товары на точках продаж
```

FIFO `cost_application` rows with `target_type='sale'` link every sold quantity to source lots.

### 7. Return

Return reverses revenue/settlement and restores original sale cost:

```text
Дт 90.01 Возвраты продаж
Кт 76.ТП Расчеты с точками продаж

Дт 41.* Товары
Кт 90.02 Себестоимость продаж
```

Returned item state controls whether stock is available for resale.

### 8. Fees And Payout

Marketplace/channel commission:

```text
Дт 44 Расходы на продажу
Кт 76.ТП Расчеты с точками продаж
```

Compensation:

```text
Дт 76.ТП Расчеты с точками продаж
Кт 91.01 Прочие доходы
```

Payout to bank:

```text
Дт 51 Расчетный счет
Кт 76.ТП Расчеты с точками продаж
```

Payout does not create revenue again.

### 9. Operating Expenses

Salary/rent/service paid from bank:

```text
Дт 26 / 44 / 91.02
Кт 51
```

Owner withdrawal:

```text
Дт 80.02 Изъятия владельца
Кт 51
```

Owner withdrawal is not P&L expense.

### 10. Reports And Close

P&L uses revenue, себестоимость продаж, selling expenses, operating expenses and other results.

Balance uses money, inventory, receivables/claims, payables and equity.

Cash flow uses money documents.

Period closing checks data quality, snapshots reports and locks direct edits.

## Core Invariants

### Accounting

- Every posted `journal_entry` must balance.
- `journal_entry.source_type` and `source_id` must trace back to a source document or explicit system seed.
- Reversal entries reference original entries; original posted entries are not deleted.
- Ledger screens are read-only projections from posted journal lines.
- Users fix business documents, not ledger rows.
- Every posting workflow must use a registered `document_type_registry` code and posting rule.
- Purchase order is non-posting.
- Opening balance, owner contribution, supplier payment, goods receipt, procurement cost, shortage loss/claim, transfer, sale, return, fee, payout, expense and adjustment are posting documents when conducted.
- The chart-of-accounts seed must include all accounts used later: `62`, `76.02`, `76.ТП`, `80.02`, `84`, `91.01`, `91.02`, `94`, `26`, plus earlier inventory/cash/supplier/sales accounts.
- P&L is based on period turnovers; this roadmap does not create temporary-account closing entries into `99`.

### Periods

- `document.accounting_date >= accounting_policy.accounting_start_date`, except explicit setup/backfill reference operations.
- Posting requires an existing open accounting period.
- Closed periods block direct edits.
- Closed-period corrections use reversal/current-period adjustment workflows.
- Topbar period selector controls UI working period and defaults; it does not change accounting start date or close/reopen periods.
- Closing snapshots reports and writes period locks.

### Inventory

- Product creation, product images and product mapping create no accounting facts.
- Opening balance, goods receipt, surplus and return create/restore FIFO lots.
- Sale, write-off and transfer consume FIFO lots through cost applications.
- `cost_application` is the only physical FIFO application ledger. Sale/return-specific views must reference it instead of duplicating it.
- `inventory_lot.qty_remaining >= 0`.
- `stock_movement` always references a source document.
- Sum of open lot costs must reconcile with `41.*` balances, within rounding tolerance.
- Core inventory uses generic storage locations: own warehouse, transit, sales point/external warehouse.
- Observed stock is separate from book stock.

### Supplier Settlements

- Supplier payment before receipt creates `60.02 Авансы поставщикам`.
- Goods receipt creates `60.01 Задолженность поставщикам`.
- Advance setoff debits `60.01` and credits `60.02`.
- Supplier-currency purchase order amounts are allocation weights.
- RUB payment and RUB receipt/cost amounts are explicit accounting amounts.
- Shortage cannot be hidden by editing posted receipt quantities.

### Channel Settlements

- Gross sale revenue is recognized separately from channel fees.
- Channel fees/logistics credit `76.ТП`; they do not reduce `90.01` revenue directly.
- Payout transfers clearing balance to cash and does not create revenue again.
- External events are idempotent by channel/idempotency key.
- Imported finance/sale/return/payout materializers are one-to-one by `external_event.id`.
- `observed_stock.warehouse_id` may be null only while channel location mapping is missing; such rows cannot create accounting discrepancies until mapped.
- Raw external facts are retained even if accounting materialization is corrected, ignored or reversed.

### Payments

- `payment.amount_rub` is always positive.
- `payment_direction` controls cash-account increase/decrease.
- Supplier payments, procurement cost payments, operating expense payments and owner withdrawals are outgoing.
- Owner contributions and channel payouts are incoming.
- Payouts create/link `payment_type='channel_payout'` and must not create revenue.

### Corrections And Recalculation

- Open-period edits create document versions and audit events.
- Closed-period corrections create reversal/current-period adjustment documents.
- FIFO/profit/report recalculation runs from source documents in chronological order.
- Users can preview affected lots, sales, reports and settlements before applying correction.
- Corrections do not physically delete posted journal, stock movement or cost application source rows; they use reversal/superseding rows and rebuild derived projections.
- Amount decreases are handled as negative corrections: remaining inventory cost decreases through `41.*`, already sold cost decreases through `90.02`, and the settlement/money side follows the corrected source document.
- Posted receipt quantity decreases return the paid share of removed goods to supplier advance/claim/loss workflow instead of hiding it in the cost of received goods.

### Security And Audit

- Privileged actions write `audit_event`.
- Actor UUID fields are reserved from step 4; step 27 adds real FKs and permissions.
- Agent write access uses the same command handlers and validations as UI.
- Read-only tokens cannot mutate data.
- Channel API access for agents is off by default and must be explicitly granted per channel/token.
- Audit rows are not user-editable.

## UI Consistency Check

- No step uses a user-facing technical screen such as `Backend OK` or `PostgreSQL OK`.
- Settings pages do not use a secondary settings sidebar.
- Screens avoid global quick actions when the same action belongs inside a section, table row, tab or form footer.
- Russian business terms are used in UI: `себестоимость продаж`, `задолженность поставщикам`, `аванс поставщику`, `расчетный счет`, `партии себестоимости`, `расчеты с точками продаж`.
- Product rows show thumbnails where useful; if no image exists, show a neutral placeholder.
- Ordinary users do not see manual debit/credit editors in business workflows.
- Every render has a textual contract describing route, layout, controls, API, states and database/domain effects.

## Full-System Acceptance Scenarios

### Procurement To Sale

User contributes cash, creates purchase order, pays supplier, receives goods, adds delivery cost, transfers goods to sales point, imports sale, posts sale, imports commission and payout. Expected outcome:

- cash, inventory, supplier advance/payable and channel clearing reconcile;
- FIFO lots show receipt and transfer path;
- sale has revenue and себестоимость продаж;
- P&L shows revenue, cost, fee and profit;
- balance satisfies `Активы = Обязательства + Капитал`.

### Existing Store Start

User connects channel, imports current cards/observed stock, maps products, enters unit cost, creates opening balances and starts from selected accounting date. Expected outcome:

- opening balance documents exist;
- inventory lots exist at sales point/warehouse;
- unmatched cards block only affected rows;
- old start date warning is explicit.

### User Mistake

User corrects an old receipt cost. Expected outcome:

- correction preview shows dependent sales/reports;
- open period edit creates version and recalculation job;
- closed period edit creates reversal/current-period adjustment;
- sale margins and reports update through recalculation, not manual ledger editing.

### Inventory Difference

Observed channel stock differs from book stock. Expected outcome:

- discrepancy appears in reconciliation;
- user chooses write-off, surplus, state transfer or ignore;
- resolution creates stock adjustment document;
- observed stock raw fact remains unchanged.

### Period Close

User closes June 2026. Expected outcome:

- checklist blocks close while sales lack cost, payouts have unresolved differences or recalculation jobs failed;
- final reports are snapshotted;
- closed period rejects direct posting/editing;
- later change uses correction workflow.
