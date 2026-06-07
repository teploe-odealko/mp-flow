/**
 * Нумерованные миграции для классического слоя. Применяются по порядку id один раз
 * (см. migrate.ts). SQL держим идемпотентным (IF NOT EXISTS), чтобы пережить повторные
 * прогоны и сосуществование со старым schema.sql-bootstrap.
 */
export interface Migration {
  id: string;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: "0001",
    name: "external_event_repository_indexes",
    sql: `
      create index if not exists external_event_channel_external_idx
        on external_event (workspace_id, channel_id, external_id);
      create index if not exists external_event_channel_status_idx
        on external_event (workspace_id, channel_id, status);
      create index if not exists external_event_channel_occurred_idx
        on external_event (workspace_id, channel_id, occurred_at);
    `
  },
  {
    id: "0002",
    name: "external_event_repository_public_indexes",
    sql: `
      alter table external_event add column if not exists public_id text;
      alter table external_event add column if not exists idempotency_key text;
      update external_event
        set public_id = coalesce(nullif(state_json->>'id', ''), nullif(state_json->>'code', ''))
        where public_id is null and coalesce(nullif(state_json->>'id', ''), nullif(state_json->>'code', '')) is not null;
      update external_event
        set idempotency_key = coalesce(nullif(state_json->>'idempotencyKey', ''), external_id)
        where idempotency_key is null;
      create index if not exists external_event_ws_chan_ext_idx
        on external_event (workspace_id, channel_id, external_id);
      create index if not exists external_event_ws_chan_status_idx
        on external_event (workspace_id, channel_id, status);
      create index if not exists external_event_ws_id_idx
        on external_event (workspace_id, public_id);
      create index if not exists external_event_ws_chan_idempotency_idx
        on external_event (workspace_id, channel_id, idempotency_key);
    `
  },
  {
    id: "0003",
    name: "audit_event_repository_indexes",
    sql: `
      create index if not exists audit_event_ws_created_idx
        on audit_event (workspace_id, created_at);
      create index if not exists audit_event_ws_entity_idx
        on audit_event (workspace_id, entity_id);
    `
  },
  {
    id: "0004",
    name: "public_id_and_external_event_typed_columns",
    sql: `
      alter table external_event add column if not exists sync_run_id uuid;
      alter table external_event add column if not exists idempotency_key text;
      alter table external_event add column if not exists external_product_id uuid;
      alter table external_event add column if not exists product_id uuid;
      alter table external_event add column if not exists reason text;
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
          execute format(
            'create index if not exists %I on %I(workspace_id, public_id)',
            target_table || '_workspace_public_id_idx',
            target_table
          );
        end loop;
      end $$;
    `
  }
];
