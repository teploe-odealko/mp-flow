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
  },
  {
    id: "0005",
    name: "stream_typed_hydrate_columns",
    sql: `
      alter table external_event add column if not exists last_error text;
      alter table external_event add column if not exists created_at timestamptz not null default now();
      alter table external_event add column if not exists updated_at timestamptz not null default now();
      update external_event
        set created_at = coalesce(nullif(state_json->>'createdAt', '')::timestamptz, created_at),
            updated_at = coalesce(nullif(state_json->>'updatedAt', '')::timestamptz, updated_at),
            last_error = nullif(state_json->>'lastError', '')
        where state_json <> '{}'::jsonb;

      alter table audit_event add column if not exists entity_public_id text;
      update audit_event
        set entity_public_id = nullif(state_json->>'entityId', '')
        where entity_public_id is null;

      alter table sync_run add column if not exists mode text;
      alter table sync_run add column if not exists streams text[];
      alter table sync_run add column if not exists errors text[];
      alter table sync_run add column if not exists since text;
      alter table sync_run add column if not exists summary jsonb;
      alter table sync_run add column if not exists stream_runs jsonb;
      alter table sync_run add column if not exists last_error text;
      update sync_run
        set mode = nullif(state_json->>'mode', ''),
            streams = case when jsonb_typeof(state_json->'streams') = 'array'
              then array(select jsonb_array_elements_text(state_json->'streams'))
              else streams
            end,
            errors = case when jsonb_typeof(state_json->'errors') = 'array'
              then array(select jsonb_array_elements_text(state_json->'errors'))
              else errors
            end,
            since = nullif(state_json->>'since', ''),
            summary = case when state_json ? 'summary' then state_json->'summary' else summary end,
            stream_runs = case when state_json ? 'streamRuns' then state_json->'streamRuns' else stream_runs end,
            last_error = nullif(state_json->>'lastError', '')
        where state_json <> '{}'::jsonb;
    `
  },
  {
    id: "0006",
    name: "singleton_typed_hydrate_columns",
    sql: `
      alter table organization add column if not exists inn text;
      alter table organization add column if not exists updated_at timestamptz;
      update organization
        set inn = nullif(state_json->>'inn', ''),
            updated_at = case when nullif(state_json->>'updatedAt', '') is not null then (state_json->>'updatedAt')::timestamptz else updated_at end
        where state_json <> '{}'::jsonb;

      alter table accounting_policy add column if not exists allow_open_period_edits boolean;
      alter table accounting_policy add column if not exists comment text;
      update accounting_policy
        set allow_open_period_edits = case
              when state_json ? 'allowOpenPeriodEdits' then (state_json->>'allowOpenPeriodEdits')::boolean
              else allow_open_period_edits
            end,
            comment = nullif(state_json->>'comment', '')
        where state_json <> '{}'::jsonb;
    `
  },
  {
    id: "0007",
    name: "procurement_typed_hydrate_columns",
    sql: `
      alter table procurement_cost add column if not exists pending_allocation boolean;
      update procurement_cost
        set pending_allocation = case
          when state_json ? 'pendingAllocation' then (state_json->>'pendingAllocation')::boolean
          else pending_allocation
        end
        where state_json <> '{}'::jsonb;
    `
  },
  {
    // Старый runStocktake помечал инвентаризацию posted до проведения, а guard postStocktake
    // мгновенно выходил — документ оставался draft без проводок и движений. Возвращаем такие
    // строки в draft, чтобы их можно было реально провести.
    id: "0008",
    name: "reset_stocktakes_stuck_posted_noop",
    sql: `
      update stocktake st
        set status = 'draft'
        from document d
        where d.id = st.document_id
          and st.status = 'posted'
          and d.status = 'draft'
          and not exists (select 1 from journal_entry je where je.document_id = d.id)
          and not exists (select 1 from stock_movement sm where sm.document_id = d.id);
    `
  },
  {
    // Интеграция Wildberries удалена из кода (была демо-заглушкой и писала фейковые данные).
    // Чистим сид integration_plugin и каскадно удаляем WB-каналы со всеми зависимыми строками:
    // продовых данных нет, каналы могли появиться только через прямой API/демо-заглушку.
    // Документы и проводки материализованных демо-продаж не трогаем — у них нет FK на канал.
    id: "0009",
    name: "drop_wildberries_plugin_and_channels",
    sql: `
      do $$
      declare
        wb_channel_ids uuid[];
      begin
        select coalesce(array_agg(sc.id), '{}') into wb_channel_ids
        from sales_channel sc
        join integration_plugin ip on ip.id = sc.plugin_id
        where ip.code = 'wildberries';

        delete from return_cost_restoration where sales_return_line_id in (
          select srl.id from sales_return_line srl
          join sales_return sr on sr.id = srl.sales_return_id
          where sr.channel_id = any(wb_channel_ids)
             or sr.sale_id in (select id from sale where channel_id = any(wb_channel_ids))
        );
        delete from sales_return_line where sales_return_id in (
          select id from sales_return
          where channel_id = any(wb_channel_ids)
             or sale_id in (select id from sale where channel_id = any(wb_channel_ids))
        );
        delete from sales_return
          where channel_id = any(wb_channel_ids)
             or sale_id in (select id from sale where channel_id = any(wb_channel_ids));
        delete from payout_line where payout_id in (select id from payout where channel_id = any(wb_channel_ids));
        delete from payout_line where sale_id in (select id from sale where channel_id = any(wb_channel_ids));
        delete from payout_line where channel_finance_event_id in (
          select id from channel_finance_event where channel_id = any(wb_channel_ids)
        );
        delete from sale_profit_component where sale_line_id in (
          select sl.id from sale_line sl join sale s on s.id = sl.sale_id where s.channel_id = any(wb_channel_ids)
        );
        delete from sale_line where sale_id in (select id from sale where channel_id = any(wb_channel_ids));
        delete from sale where channel_id = any(wb_channel_ids);
        delete from channel_finance_event where channel_id = any(wb_channel_ids);
        delete from payout where channel_id = any(wb_channel_ids);
        delete from observed_stock where channel_id = any(wb_channel_ids);
        delete from external_event where channel_id = any(wb_channel_ids);
        delete from sync_stream_run where sync_run_id in (select id from sync_run where channel_id = any(wb_channel_ids));
        delete from sync_run where channel_id = any(wb_channel_ids);
        delete from product_external_link where channel_id = any(wb_channel_ids);
        delete from external_product where channel_id = any(wb_channel_ids);
        delete from channel_credential where channel_id = any(wb_channel_ids);
        delete from channel_capability where channel_id = any(wb_channel_ids);
        delete from channel_agent_permission where channel_id = any(wb_channel_ids);
        update stock_transfer set channel_id = null where channel_id = any(wb_channel_ids);
        update warehouse set channel_id = null where channel_id = any(wb_channel_ids);
        update settlement_entry set channel_id = null where channel_id = any(wb_channel_ids);
        delete from sales_channel where id = any(wb_channel_ids);

        delete from plugin_state_record where plugin_code = 'wildberries';
        delete from plugin_secret_record where plugin_code = 'wildberries';
        delete from integration_plugin where code = 'wildberries';
      end $$;
    `
  },
  {
    // Таблицы better-auth ("user","session","account","verification","rateLimit") —
    // SQL сгенерирован из getSchema() (better-auth/db) c CLI-маппингом типов для Postgres
    // и обёрнут в идемпотентный вид. Имена и camelCase-колонки оставлены дефолтными
    // (совместимость с CLI при апгрейдах); "user" — зарезервированное слово, всегда в кавычках.
    // Сюда же переезжают кастомные workspace-таблицы из ленивого AuthService.initialize():
    // ленивого DDL в рантайме больше нет. FK членств сразу указывает на "user"
    // (на старых dev-базах таблица уже существует со старым FK — его перевяжет 0011).
    id: "0010",
    name: "better_auth_tables_and_workspaces",
    sql: `
      create table if not exists "user" (
        "id" text not null primary key,
        "name" text not null,
        "email" text not null unique,
        "emailVerified" boolean not null,
        "image" text,
        "createdAt" timestamptz not null default CURRENT_TIMESTAMP,
        "updatedAt" timestamptz not null default CURRENT_TIMESTAMP
      );

      create table if not exists "session" (
        "id" text not null primary key,
        "expiresAt" timestamptz not null,
        "token" text not null unique,
        "createdAt" timestamptz not null default CURRENT_TIMESTAMP,
        "updatedAt" timestamptz not null,
        "ipAddress" text,
        "userAgent" text,
        "userId" text not null references "user"("id") on delete cascade
      );

      create table if not exists "account" (
        "id" text not null primary key,
        "accountId" text not null,
        "providerId" text not null,
        "userId" text not null references "user"("id") on delete cascade,
        "accessToken" text,
        "refreshToken" text,
        "idToken" text,
        "accessTokenExpiresAt" timestamptz,
        "refreshTokenExpiresAt" timestamptz,
        "scope" text,
        "password" text,
        "createdAt" timestamptz not null default CURRENT_TIMESTAMP,
        "updatedAt" timestamptz not null
      );

      create table if not exists "verification" (
        "id" text not null primary key,
        "identifier" text not null,
        "value" text not null,
        "expiresAt" timestamptz not null,
        "createdAt" timestamptz not null default CURRENT_TIMESTAMP,
        "updatedAt" timestamptz not null default CURRENT_TIMESTAMP
      );

      create table if not exists "rateLimit" (
        "id" text not null primary key,
        "key" text not null unique,
        "count" integer not null,
        "lastRequest" bigint not null
      );

      create index if not exists "session_userId_idx" on "session"("userId");
      create index if not exists "account_userId_idx" on "account"("userId");
      create index if not exists "verification_identifier_idx" on "verification"("identifier");

      create table if not exists auth_workspace (
        id text primary key,
        name text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists auth_workspace_member (
        workspace_id text not null references auth_workspace(id) on delete cascade,
        user_id text not null,
        role_code text not null check (role_code in ('owner','accountant','operator','viewer')),
        created_at timestamptz not null default now(),
        primary key (workspace_id, user_id),
        constraint auth_workspace_member_user_id_fkey
          foreign key (user_id) references "user"("id") on delete cascade
      );

      create unique index if not exists auth_workspace_member_one_workspace_per_user_idx
        on auth_workspace_member(user_id);
      create index if not exists auth_workspace_member_workspace_id_idx
        on auth_workspace_member(workspace_id);

      insert into auth_workspace (id, name, created_at, updated_at)
      values ('default', 'MPFlow', now(), now())
      on conflict (id) do nothing;
    `
  },
  {
    // Swap самописной авторизации на better-auth. Продовых пользователей нет, поэтому
    // данные не переносятся: старые таблицы auth_* удаляются, членства чистятся,
    // FK auth_workspace_member.user_id перевязывается на better-auth "user"(id)
    // (id у better-auth другие; локальные dev-инстансы регистрируют владельца заново).
    id: "0011",
    name: "swap_legacy_auth_to_better_auth",
    sql: `
      drop table if exists auth_email_verification;
      drop table if exists auth_session;
      delete from auth_workspace_member;
      alter table auth_workspace_member drop constraint if exists auth_workspace_member_user_id_fkey;
      alter table auth_workspace_member
        add constraint auth_workspace_member_user_id_fkey
        foreign key (user_id) references "user"("id") on delete cascade;
      drop table if exists auth_user;
    `
  }
];
