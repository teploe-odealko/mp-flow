-- MPFlow PostgreSQL target schema.
-- The production runtime uses PostgreSQL as the source of truth and keeps
-- request-scoped aggregate sessions in memory only for the lifetime of a request.
-- Domain tables below are the durable source; `state_json` columns preserve the
-- exact runtime shape while typed columns remain queryable and constrained.
-- Table names, keys and core constraints below remain the target normalized model.

create extension if not exists "pgcrypto";

create table if not exists accounting_runtime_meta (
  key text primary key,
  schema_version integer not null,
  next_id integer not null,
  singletons jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists accounting_runtime_entity (
  collection text not null,
  entity_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, entity_id)
);

create index if not exists accounting_runtime_entity_collection_idx
  on accounting_runtime_entity(collection);

create table if not exists accounting_runtime_channel_credential (
  channel_id text primary key,
  encrypted_credentials jsonb not null,
  fields text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists organization (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  legal_form text not null,
  timezone text not null,
  tax_mode text not null,
  created_at timestamptz not null default now()
);

create table if not exists accounting_policy (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  accounting_start_date date not null,
  cost_method text not null check (cost_method = 'fifo'),
  accounting_currency text not null check (accounting_currency = 'RUB')
);

create table if not exists accounting_period (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  label text not null,
  starts_on date not null,
  ends_on date not null,
  status text not null check (status in ('open','closed')),
  unique (organization_id, starts_on)
);

create table if not exists chart_account (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code text not null,
  name text not null,
  kind text not null check (kind in ('asset','liability','equity','revenue','expense')),
  normal_side text not null check (normal_side in ('debit','credit')),
  is_active boolean not null default true,
  unique (organization_id, code)
);

create table if not exists document_type_registry (
  code text primary key,
  module_code text not null,
  display_name text not null,
  is_posting boolean not null,
  posting_rule_code text,
  allows_draft boolean not null default true,
  allows_reversal boolean not null default true,
  allows_correction boolean not null default true
);

create table if not exists document (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  document_type text not null references document_type_registry(code),
  number text not null,
  status text not null check (status in ('draft','posted','cancelled','corrected')),
  accounting_date date not null,
  source text not null check (source in ('manual','system','plugin','backfill')),
  amount_rub numeric(18,2) not null default 0,
  title text not null,
  comment text,
  corrected_from_document_id uuid references document(id),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  cancelled_at timestamptz,
  unique (organization_id, number)
);

create table if not exists document_line (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id) on delete cascade,
  line_no int not null,
  line_type text not null,
  qty numeric(18,4),
  amount_rub numeric(18,2),
  payload jsonb not null default '{}',
  unique (document_id, line_no)
);

create table if not exists document_version (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id),
  version_no int not null,
  snapshot jsonb not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (document_id, version_no)
);

create table if not exists document_link (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  from_document_id uuid not null references document(id),
  to_document_id uuid not null references document(id),
  link_type text not null
);

create table if not exists audit_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  actor_label text not null,
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  before_json jsonb,
  after_json jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists journal_entry (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  document_id uuid not null references document(id),
  accounting_date date not null,
  memo text not null,
  reversal_of_entry_id uuid references journal_entry(id),
  created_at timestamptz not null default now()
);

create table if not exists journal_line (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references journal_entry(id) on delete restrict,
  account_code text not null,
  debit numeric(18,2) not null default 0 check (debit >= 0),
  credit numeric(18,2) not null default 0 check (credit >= 0),
  memo text not null,
  check (debit = 0 or credit = 0)
);

create table if not exists counterparty (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name text not null,
  counterparty_type text not null check (counterparty_type in ('supplier','logistics','marketplace','owner','other')),
  inn text,
  country text,
  is_active boolean not null default true
);

create table if not exists product (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  sku text not null,
  name text not null,
  barcode text,
  category text,
  image_url text,
  status text not null check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  unique (organization_id, sku)
);

create table if not exists product_image (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references product(id) on delete cascade,
  url text not null,
  sort_order int not null default 0
);

create table if not exists product_asset (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  product_id uuid not null references product(id) on delete cascade,
  role text not null,
  slide_type text,
  url text not null,
  storage_key text not null,
  status text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists warehouse (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name text not null,
  warehouse_type text not null check (warehouse_type in ('own','transit','sales_point')),
  channel_id uuid,
  is_active boolean not null default true
);

create table if not exists stock_state (
  product_id uuid not null references product(id),
  warehouse_id uuid not null references warehouse(id),
  qty numeric(18,4) not null default 0,
  cost_rub numeric(18,2) not null default 0,
  primary key (product_id, warehouse_id)
);

create table if not exists inventory_lot (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  product_id uuid not null references product(id),
  warehouse_id uuid not null references warehouse(id),
  source_document_id uuid not null references document(id),
  source_line_id uuid,
  received_at date not null,
  qty_initial numeric(18,4) not null check (qty_initial > 0),
  qty_remaining numeric(18,4) not null check (qty_remaining >= 0),
  cost_initial_rub numeric(18,2) not null check (cost_initial_rub >= 0),
  cost_remaining_rub numeric(18,2) not null check (cost_remaining_rub >= 0),
  unit_cost_rub numeric(18,6) not null check (unit_cost_rub >= 0),
  status text not null check (status in ('open','depleted','reversed'))
);

create table if not exists stock_movement (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  product_id uuid not null references product(id),
  warehouse_id uuid not null references warehouse(id),
  document_id uuid not null references document(id),
  movement_type text not null,
  qty numeric(18,4) not null,
  cost_rub numeric(18,2) not null,
  occurred_at date not null,
  lot_id uuid references inventory_lot(id)
);

create table if not exists cost_application (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  source_document_id uuid not null references document(id),
  outbound_document_id uuid not null references document(id),
  product_id uuid not null references product(id),
  from_lot_id uuid not null references inventory_lot(id),
  qty numeric(18,4) not null check (qty > 0),
  cost_rub numeric(18,2) not null check (cost_rub >= 0),
  application_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists purchase_order (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  document_id uuid not null references document(id),
  supplier_id uuid not null references counterparty(id),
  destination_warehouse_id uuid not null references warehouse(id),
  supplier_currency text not null check (supplier_currency in ('RUB','CNY','USD')),
  status text not null check (status in ('draft','ordered','cancelled','closed')),
  ordered_at date not null,
  total_supplier_amount numeric(18,2) not null default 0,
  total_qty numeric(18,4) not null default 0,
  expected_dispatch_date date,
  tracking_ref text,
  expected_arrival_date date,
  comment text
);

create table if not exists purchase_order_line (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_order(id) on delete cascade,
  product_id uuid not null references product(id),
  line_no int not null,
  qty_ordered numeric(18,4) not null check (qty_ordered > 0),
  supplier_unit_price numeric(18,6) not null check (supplier_unit_price >= 0),
  supplier_amount numeric(18,2) not null check (supplier_amount >= 0),
  line_note text,
  unique (purchase_order_id, line_no)
);

create table if not exists cash_account (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name text not null,
  account_code text not null check (account_code in ('50','51')),
  balance_rub numeric(18,2) not null default 0,
  is_active boolean not null default true
);

create table if not exists payment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  document_id uuid not null references document(id),
  cash_account_id uuid not null references cash_account(id),
  payment_direction text not null check (payment_direction in ('incoming','outgoing')),
  payment_type text not null,
  counterparty_id uuid references counterparty(id),
  paid_at date not null,
  amount_rub numeric(18,2) not null check (amount_rub > 0),
  comment text
);

create table if not exists payment_allocation (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payment(id),
  allocation_purpose text not null,
  purchase_order_id uuid references purchase_order(id),
  document_id uuid references document(id),
  amount_rub numeric(18,2) not null check (amount_rub > 0)
);

create table if not exists settlement_entry (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  counterparty_id uuid references counterparty(id),
  channel_id uuid,
  document_id uuid not null references document(id),
  settlement_type text not null,
  debit_rub numeric(18,2) not null default 0,
  credit_rub numeric(18,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists goods_receipt (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  document_id uuid not null references document(id),
  purchase_order_id uuid not null references purchase_order(id),
  warehouse_id uuid not null references warehouse(id),
  receipt_date date not null,
  status text not null check (status in ('draft','posted','cancelled')),
  goods_cost_rub_total numeric(18,2) not null check (goods_cost_rub_total >= 0),
  goods_cost_source text not null check (goods_cost_source in ('linked_supplier_payments','manual','mixed')),
  suggested_goods_cost_rub numeric(18,2) not null,
  manual_cost_reason text
);

create table if not exists goods_receipt_line (
  id uuid primary key default gen_random_uuid(),
  goods_receipt_id uuid not null references goods_receipt(id) on delete cascade,
  purchase_order_line_id uuid not null references purchase_order_line(id),
  product_id uuid not null references product(id),
  qty_received numeric(18,4) not null check (qty_received > 0),
  supplier_amount_basis numeric(18,2) not null,
  allocated_goods_cost_rub numeric(18,2) not null,
  unit_cost_rub numeric(18,6) not null
);

-- Later-step business tables keep strong document FKs and compact typed columns.
create table if not exists procurement_cost (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), document_id uuid not null references document(id), purchase_order_id uuid references purchase_order(id), cost_type text not null, status text not null, cost_date date not null, amount_rub numeric(18,2) not null, paid_immediately boolean not null, comment text);
create table if not exists procurement_cost_line (id uuid primary key default gen_random_uuid(), procurement_cost_id uuid not null references procurement_cost(id), product_id uuid not null references product(id), allocated_amount_rub numeric(18,2) not null, remaining_inventory_amount_rub numeric(18,2) not null, sold_cost_amount_rub numeric(18,2) not null);
create table if not exists shortage_resolution (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), document_id uuid not null references document(id), purchase_order_id uuid not null references purchase_order(id), status text not null, reason text not null, resolved_at date not null);
create table if not exists shortage_resolution_line (id uuid primary key default gen_random_uuid(), shortage_resolution_id uuid not null references shortage_resolution(id), purchase_order_line_id uuid not null references purchase_order_line(id), product_id uuid not null references product(id), qty_shortage numeric(18,4) not null, paid_share_rub numeric(18,2) not null, action text not null);
create table if not exists supplier_claim (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), shortage_resolution_line_id uuid not null references shortage_resolution_line(id), supplier_id uuid not null references counterparty(id), amount_rub numeric(18,2) not null, status text not null);
create table if not exists stock_transfer (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), document_id uuid not null references document(id), from_warehouse_id uuid not null references warehouse(id), to_warehouse_id uuid not null references warehouse(id), status text not null, transfer_date date not null);
create table if not exists stock_transfer_line (id uuid primary key default gen_random_uuid(), stock_transfer_id uuid not null references stock_transfer(id), product_id uuid not null references product(id), qty numeric(18,4) not null, cost_rub numeric(18,2) not null);
create table if not exists plugin_state_record (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  plugin_code text not null,
  namespace text not null,
  visibility text not null check (visibility in ('private','shared')),
  scope_type text not null,
  scope_id text not null,
  state_key text not null,
  revision integer not null default 1,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, plugin_code, namespace, scope_type, scope_id, state_key)
);
create table if not exists plugin_secret_record (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organization(id),
  plugin_code text not null,
  namespace text not null,
  scope_type text not null,
  scope_id text not null,
  secret_key text not null,
  revision integer not null default 1,
  encrypted_payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plugin_code, namespace, scope_type, scope_id, secret_key)
);
create table if not exists integration_plugin (id uuid primary key default gen_random_uuid(), code text not null unique, display_name text not null, status text not null);
create table if not exists sales_channel (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), name text not null, channel_type text not null, plugin_id uuid references integration_plugin(id), sales_point_warehouse_id uuid not null references warehouse(id), clearing_account_code text not null default '76.ТП', status text not null);
create table if not exists channel_credential (id uuid primary key default gen_random_uuid(), channel_id uuid not null references sales_channel(id), secret_ref text not null, status text not null);
create table if not exists channel_capability (id uuid primary key default gen_random_uuid(), channel_id uuid not null references sales_channel(id), capability_code text not null);
create table if not exists external_product (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), channel_id uuid not null references sales_channel(id), external_sku text not null, external_name text not null, image_url text, status text not null);
create table if not exists product_external_link (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), product_id uuid not null references product(id), external_product_id uuid not null references external_product(id), channel_id uuid not null references sales_channel(id), status text not null);
create table if not exists sync_run (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), channel_id uuid not null references sales_channel(id), status text not null, started_at timestamptz not null, finished_at timestamptz, stats jsonb not null default '{}');
create table if not exists sync_stream_run (id uuid primary key default gen_random_uuid(), sync_run_id uuid not null references sync_run(id), stream_code text not null, status text not null, stats jsonb not null default '{}');
create table if not exists external_event (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), channel_id uuid not null references sales_channel(id), sync_run_id uuid references sync_run(id), event_type text not null, external_id text not null, idempotency_key text, occurred_at timestamptz not null, raw_payload jsonb not null, normalized_payload jsonb not null, status text not null, materialized_document_id uuid references document(id), external_product_id uuid references external_product(id), product_id uuid references product(id), reason text, unique (channel_id, external_id));
create table if not exists observed_stock (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), channel_id uuid not null references sales_channel(id), external_product_id uuid not null references external_product(id), product_id uuid references product(id), warehouse_id uuid references warehouse(id), observed_at timestamptz not null, qty_observed numeric(18,4) not null, location_status text not null);
create table if not exists sale (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), document_id uuid not null references document(id), channel_id uuid not null references sales_channel(id), sale_date date not null, external_event_id uuid references external_event(id), gross_amount_rub numeric(18,2) not null, status text not null);
create table if not exists sale_line (id uuid primary key default gen_random_uuid(), sale_id uuid not null references sale(id), product_id uuid not null references product(id), qty numeric(18,4) not null, price_rub numeric(18,2) not null, revenue_rub numeric(18,2) not null, cost_rub numeric(18,2) not null);
create table if not exists sales_return (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), document_id uuid not null references document(id), sale_id uuid not null references sale(id), channel_id uuid not null references sales_channel(id), return_date date not null, refund_rub numeric(18,2) not null, restored_cost_rub numeric(18,2) not null);
create table if not exists sales_return_line (id uuid primary key default gen_random_uuid(), sales_return_id uuid not null references sales_return(id), sale_line_id uuid not null references sale_line(id), qty numeric(18,4) not null, refund_rub numeric(18,2) not null, restored_cost_rub numeric(18,2) not null);
create table if not exists return_cost_restoration (id uuid primary key default gen_random_uuid(), sales_return_line_id uuid not null references sales_return_line(id), source_cost_application_id uuid references cost_application(id), restored_cost_rub numeric(18,2) not null);
create table if not exists channel_finance_event (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), channel_id uuid not null references sales_channel(id), external_event_id uuid references external_event(id), document_id uuid not null references document(id), payout_id uuid, event_kind text not null, amount_rub numeric(18,2) not null, occurred_at date not null);
create table if not exists sale_profit_component (id uuid primary key default gen_random_uuid(), sale_line_id uuid not null references sale_line(id), component_type text not null, amount_rub numeric(18,2) not null);
create table if not exists payout (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), channel_id uuid not null references sales_channel(id), document_id uuid not null references document(id), payment_id uuid not null references payment(id), payout_date date not null, gross_events_rub numeric(18,2) not null, bank_receipt_rub numeric(18,2) not null, difference_rub numeric(18,2) not null, status text not null);
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'channel_finance_event_payout_fk'
  ) then
    alter table channel_finance_event
      add constraint channel_finance_event_payout_fk foreign key (payout_id) references payout(id);
  end if;
end $$;
create table if not exists payout_line (id uuid primary key default gen_random_uuid(), payout_id uuid not null references payout(id), channel_finance_event_id uuid references channel_finance_event(id), sale_id uuid references sale(id), amount_rub numeric(18,2) not null);
create table if not exists reconciliation_item (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), source_type text not null, source_id uuid not null, status text not null, payload jsonb not null default '{}');
create table if not exists expense_category (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), name text not null, account_code text not null);
create table if not exists operating_expense (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), document_id uuid not null references document(id), category_id uuid not null references expense_category(id), payment_id uuid not null references payment(id), expense_date date not null, amount_rub numeric(18,2) not null, comment text);
create table if not exists owner_transaction (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), document_id uuid not null references document(id), payment_id uuid not null references payment(id), transaction_type text not null, amount_rub numeric(18,2) not null);
create table if not exists stocktake (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), warehouse_id uuid not null references warehouse(id), document_id uuid not null references document(id), stocktake_date date not null, status text not null);
create table if not exists stocktake_line (id uuid primary key default gen_random_uuid(), stocktake_id uuid not null references stocktake(id), product_id uuid not null references product(id), book_qty numeric(18,4) not null, observed_qty numeric(18,4) not null, difference_qty numeric(18,4) not null, book_cost_rub numeric(18,2) not null, adjustment_cost_rub numeric(18,2) not null);
create table if not exists inventory_discrepancy (id uuid primary key default gen_random_uuid(), stocktake_line_id uuid not null references stocktake_line(id), status text not null);
create table if not exists stock_adjustment (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), document_id uuid not null references document(id), stocktake_id uuid references stocktake(id), status text not null);
create table if not exists stock_adjustment_line (id uuid primary key default gen_random_uuid(), stock_adjustment_id uuid not null references stock_adjustment(id), product_id uuid not null references product(id), qty_delta numeric(18,4) not null, cost_delta_rub numeric(18,2) not null);
create table if not exists inventory_cost_adjustment (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), document_id uuid not null references document(id), lot_id uuid references inventory_lot(id), amount_rub numeric(18,2) not null, reason text not null);
create table if not exists correction_case (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), source_document_id uuid not null references document(id), correction_type text not null, reason text not null, status text not null, impact_summary jsonb not null default '{}', created_at timestamptz not null default now(), applied_at timestamptz);
create table if not exists document_dependency (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), source_document_id uuid not null references document(id), dependent_document_id uuid not null references document(id), dependency_type text not null, unique (source_document_id, dependent_document_id, dependency_type));
create table if not exists recalculation_job (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), job_type text not null, scope jsonb not null, status text not null, progress numeric(5,2) not null default 0, started_at timestamptz, finished_at timestamptz, last_error text, created_at timestamptz not null default now());
create table if not exists report_snapshot (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), period_id uuid references accounting_period(id), report_type text not null, payload jsonb not null, created_at timestamptz not null default now());
create table if not exists report_saved_view (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), name text not null, report_type text not null, filters jsonb not null default '{}');
create table if not exists backfill_project (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), name text not null, status text not null, payload jsonb not null default '{}');
create table if not exists backfill_item (id uuid primary key default gen_random_uuid(), backfill_project_id uuid not null references backfill_project(id), item_type text not null, payload jsonb not null, status text not null);
create table if not exists opening_balance_batch (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), document_id uuid references document(id), status text not null);
create table if not exists user_account (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), email text not null, name text not null, status text not null);
create table if not exists role (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), code text not null, name text not null);
create table if not exists user_role (user_id uuid not null references user_account(id), role_id uuid not null references role(id), primary key (user_id, role_id));
create table if not exists agent_token (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), name text not null, status text not null, scopes jsonb not null default '[]');
create table if not exists channel_agent_permission (id uuid primary key default gen_random_uuid(), agent_token_id uuid not null references agent_token(id), channel_id uuid not null references sales_channel(id), permission_code text not null);

alter table accounting_runtime_meta add column if not exists revision bigint not null default 0;
alter table channel_credential add column if not exists encrypted_credentials jsonb;
alter table channel_credential add column if not exists fields text[] not null default '{}';
alter table channel_credential add column if not exists created_at timestamptz not null default now();
alter table channel_credential add column if not exists updated_at timestamptz not null default now();
alter table external_event add column if not exists sync_run_id uuid;
alter table external_event add column if not exists idempotency_key text;
alter table external_event add column if not exists external_product_id uuid;
alter table external_event add column if not exists product_id uuid;
alter table external_event add column if not exists reason text;
alter table procurement_cost add column if not exists allocation_basis text;
alter table procurement_cost_line add column if not exists lot_id uuid references inventory_lot(id);
alter table procurement_cost_line add column if not exists warehouse_id uuid references warehouse(id);
alter table procurement_cost_line add column if not exists basis_value numeric(18,6);
alter table procurement_cost_line add column if not exists qty_initial numeric(18,4);
alter table procurement_cost_line add column if not exists qty_remaining numeric(18,4);
alter table procurement_cost_line add column if not exists qty_sold numeric(18,4);
alter table product add column if not exists unit text;
alter table product add column if not exists brand text;
alter table product add column if not exists description text;
alter table product add column if not exists weight_grams integer;
alter table product add column if not exists length_mm integer;
alter table product add column if not exists width_mm integer;
alter table product add column if not exists height_mm integer;
alter table product add column if not exists manufacturer_article text;
alter table product add column if not exists comment text;
alter table backfill_project add column if not exists created_at timestamptz not null default now();
alter table organization add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table accounting_policy add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table accounting_period add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table chart_account add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table document_type_registry add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table document add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table document_line add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table document_version add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table document_link add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table audit_event add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table journal_entry add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table journal_line add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table counterparty add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table product add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table product_asset add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table warehouse add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table stock_state add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table inventory_lot add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table stock_movement add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table cost_application add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table purchase_order add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table purchase_order_line add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table cash_account add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table payment add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table payment_allocation add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table settlement_entry add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table goods_receipt add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table goods_receipt_line add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table procurement_cost add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table procurement_cost_line add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table shortage_resolution add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table shortage_resolution_line add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table supplier_claim add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table stock_transfer add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table stock_transfer_line add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table plugin_state_record add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table integration_plugin add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table sales_channel add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table external_product add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table product_external_link add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table sync_run add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table external_event add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table observed_stock add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table sale add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table sale_line add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table sales_return add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table channel_finance_event add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table payout add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table payout_line add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table expense_category add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table operating_expense add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table owner_transaction add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table stocktake add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table stocktake_line add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table correction_case add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table recalculation_job add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table report_snapshot add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table backfill_project add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table backfill_item add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table user_account add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table role add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table agent_token add column if not exists state_json jsonb not null default '{}'::jsonb;
alter table channel_agent_permission add column if not exists state_json jsonb not null default '{}'::jsonb;

update external_event
  set idempotency_key = coalesce(nullif(state_json->>'idempotencyKey', ''), external_id)
  where idempotency_key is null;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'organization','accounting_policy','accounting_period','chart_account',
    'document_type_registry','document','document_line','document_version',
    'document_link','audit_event','journal_entry','journal_line','counterparty',
    'product','product_asset','warehouse','stock_state','inventory_lot',
    'stock_movement','cost_application','purchase_order','purchase_order_line',
    'cash_account','payment','payment_allocation','settlement_entry','goods_receipt',
    'goods_receipt_line','procurement_cost','procurement_cost_line',
    'shortage_resolution','shortage_resolution_line','supplier_claim',
    'stock_transfer','stock_transfer_line','plugin_state_record','integration_plugin',
    'sales_channel','external_product','product_external_link','sync_run',
    'external_event','observed_stock','sale','sale_line','sales_return',
    'channel_finance_event','payout','payout_line','expense_category',
    'operating_expense','owner_transaction','stocktake','stocktake_line',
    'correction_case','recalculation_job','report_snapshot','backfill_project',
    'backfill_item','user_account','role','agent_token','channel_agent_permission'
  ]
  loop
    execute format('alter table %I add column if not exists public_id text', target_table);
    if target_table = 'stock_state' then
      execute format($fmt$
        update %I
          set public_id = concat(state_json->>'productId', ':', state_json->>'warehouseId')
          where public_id is null
            and nullif(state_json->>'productId', '') is not null
            and nullif(state_json->>'warehouseId', '') is not null
      $fmt$, target_table);
    else
      execute format($fmt$
        update %I
          set public_id = coalesce(nullif(state_json->>'id', ''), nullif(state_json->>'code', ''))
          where public_id is null
            and coalesce(nullif(state_json->>'id', ''), nullif(state_json->>'code', '')) is not null
      $fmt$, target_table);
    end if;
  end loop;
end $$;

create index if not exists document_org_date_idx on document (organization_id, accounting_date);
create index if not exists journal_entry_document_idx on journal_entry (document_id);
create index if not exists journal_line_account_idx on journal_line (account_code);
create index if not exists inventory_lot_fifo_idx on inventory_lot (product_id, warehouse_id, received_at, id) where qty_remaining > 0;
create index if not exists stock_movement_document_idx on stock_movement (document_id);
create index if not exists external_event_status_idx on external_event (organization_id, channel_id, status);
