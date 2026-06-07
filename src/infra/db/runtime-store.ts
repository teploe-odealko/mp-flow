import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { AccountingApp } from "../../core/accounting-app";
import type { AccountingState, ExternalEvent, ObservedStock, SyncRun, ID } from "../../core/models";
import type { ExternalEventStore, ExternalEventListFilter } from "../../core/external-event-store";
import type { ObservedStockStore, ObservedStockListFilter } from "../../core/observed-stock-store";
import type { SyncRunStore } from "../../core/sync-run-store";
import type { CollectionRepo, Repositories } from "../../core/repositories";
import { createEmptyState, currentIdSequence, restoreIdSequence, round2, runWithIdSequence } from "../../core/utils";
import { buildReportsWorkspacePayload, type ReportsWorkspaceOptions } from "../../shared/reports-workspace";
import { buildProductCardWorkspacePayload } from "../../shared/product-card-workspace";
import { stableUuid } from "./ids";
import {
  ACCOUNTING_POLICY_JOINS,
  ACCOUNTING_POLICY_SELECT,
  ACCOUNTING_PERIOD_JOINS,
  ACCOUNTING_PERIOD_SELECT,
  AGENT_TOKEN_JOINS,
  AGENT_TOKEN_SELECT,
  AUDIT_EVENT_JOINS,
  AUDIT_EVENT_SELECT,
  BACKFILL_ITEM_JOINS,
  BACKFILL_ITEM_SELECT,
  BACKFILL_PROJECT_JOINS,
  BACKFILL_PROJECT_SELECT,
  CASH_ACCOUNT_JOINS,
  CASH_ACCOUNT_SELECT,
  CHANNEL_AGENT_PERMISSION_JOINS,
  CHANNEL_AGENT_PERMISSION_SELECT,
  CHANNEL_FINANCE_EVENT_JOINS,
  CHANNEL_FINANCE_EVENT_SELECT,
  CHART_ACCOUNT_JOINS,
  CHART_ACCOUNT_SELECT,
  COST_APPLICATION_JOINS,
  COST_APPLICATION_SELECT,
  COUNTERPARTY_JOINS,
  COUNTERPARTY_SELECT,
  CORRECTION_CASE_JOINS,
  CORRECTION_CASE_SELECT,
  DOCUMENT_JOINS,
  DOCUMENT_LINE_JOINS,
  DOCUMENT_LINE_SELECT,
  DOCUMENT_LINK_JOINS,
  DOCUMENT_LINK_SELECT,
  DOCUMENT_TYPE_SELECT,
  DOCUMENT_SELECT,
  DOCUMENT_VERSION_JOINS,
  DOCUMENT_VERSION_SELECT,
  EXTERNAL_EVENT_JOINS,
  EXTERNAL_EVENT_SELECT,
  EXTERNAL_PRODUCT_JOINS,
  EXTERNAL_PRODUCT_SELECT,
  EXPENSE_CATEGORY_JOINS,
  EXPENSE_CATEGORY_SELECT,
  GOODS_RECEIPT_JOINS,
  GOODS_RECEIPT_LINE_JOINS,
  GOODS_RECEIPT_LINE_SELECT,
  GOODS_RECEIPT_SELECT,
  INTEGRATION_PLUGIN_SELECT,
  INVENTORY_LOT_JOINS,
  INVENTORY_LOT_SELECT,
  JOURNAL_ENTRY_JOINS,
  JOURNAL_ENTRY_SELECT,
  JOURNAL_LINE_JOINS,
  JOURNAL_LINE_SELECT,
  OBSERVED_STOCK_JOINS,
  OBSERVED_STOCK_SELECT,
  OPERATING_EXPENSE_JOINS,
  OPERATING_EXPENSE_SELECT,
  OWNER_TRANSACTION_JOINS,
  OWNER_TRANSACTION_SELECT,
  ORGANIZATION_SELECT,
  PAYMENT_ALLOCATION_JOINS,
  PAYMENT_ALLOCATION_SELECT,
  PAYMENT_JOINS,
  PAYMENT_SELECT,
  PAYOUT_JOINS,
  PAYOUT_LINE_JOINS,
  PAYOUT_LINE_SELECT,
  PAYOUT_SELECT,
  PLUGIN_STATE_RECORD_JOINS,
  PLUGIN_STATE_RECORD_SELECT,
  PROCUREMENT_COST_JOINS,
  PROCUREMENT_COST_LINE_JOINS,
  PROCUREMENT_COST_LINE_SELECT,
  PROCUREMENT_COST_SELECT,
  PRODUCT_ASSET_JOINS,
  PRODUCT_ASSET_SELECT,
  PRODUCT_EXTERNAL_LINK_JOINS,
  PRODUCT_EXTERNAL_LINK_SELECT,
  RECALCULATION_JOB_JOINS,
  RECALCULATION_JOB_SELECT,
  REPORT_SNAPSHOT_JOINS,
  REPORT_SNAPSHOT_SELECT,
  PRODUCT_JOINS,
  PRODUCT_SELECT,
  PURCHASE_ORDER_JOINS,
  PURCHASE_ORDER_LINE_JOINS,
  PURCHASE_ORDER_LINE_SELECT,
  PURCHASE_ORDER_SELECT,
  SETTLEMENT_ENTRY_JOINS,
  SETTLEMENT_ENTRY_SELECT,
  SHORTAGE_RESOLUTION_JOINS,
  SHORTAGE_RESOLUTION_LINE_JOINS,
  SHORTAGE_RESOLUTION_LINE_SELECT,
  SHORTAGE_RESOLUTION_SELECT,
  STOCKTAKE_JOINS,
  STOCKTAKE_LINE_JOINS,
  STOCKTAKE_LINE_SELECT,
  STOCKTAKE_SELECT,
  STOCK_MOVEMENT_JOINS,
  STOCK_MOVEMENT_SELECT,
  STOCK_STATE_JOINS,
  STOCK_STATE_SELECT,
  STOCK_TRANSFER_JOINS,
  STOCK_TRANSFER_LINE_JOINS,
  STOCK_TRANSFER_LINE_SELECT,
  STOCK_TRANSFER_SELECT,
  SUPPLIER_CLAIM_JOINS,
  SUPPLIER_CLAIM_SELECT,
  ROLE_JOINS,
  ROLE_SELECT,
  SALE_JOINS,
  SALE_LINE_JOINS,
  SALE_LINE_SELECT,
  SALE_SELECT,
  SALES_CHANNEL_JOINS,
  SALES_CHANNEL_SELECT,
  SALES_RETURN_JOINS,
  SALES_RETURN_SELECT,
  SYNC_RUN_JOINS,
  SYNC_RUN_SELECT,
  USER_ACCOUNT_JOINS,
  USER_ACCOUNT_SELECT,
  WAREHOUSE_JOINS,
  WAREHOUSE_SELECT,
  accountingPeriodFromRow,
  accountingPolicyFromRow,
  agentTokenFromRow,
  auditEventFromRow,
  backfillItemFromRow,
  backfillProjectFromRow,
  cashAccountFromRow,
  channelAgentPermissionFromRow,
  channelFinanceEventFromRow,
  chartAccountFromRow,
  costApplicationFromRow,
  counterpartyFromRow,
  correctionCaseFromRow,
  documentTypeFromRow,
  documentFromRow,
  documentLineFromRow,
  documentLinkFromRow,
  documentVersionFromRow,
  externalEventFromRow,
  externalProductFromRow,
  expenseCategoryFromRow,
  goodsReceiptFromRow,
  goodsReceiptLineFromRow,
  integrationPluginFromRow,
  inventoryLotFromRow,
  journalEntryFromRow,
  journalLineFromRow,
  observedStockFromRow,
  operatingExpenseFromRow,
  ownerTransactionFromRow,
  organizationFromRow,
  paymentAllocationFromRow,
  paymentFromRow,
  payoutFromRow,
  payoutLineFromRow,
  pluginStateRecordFromRow,
  procurementCostFromRow,
  procurementCostLineFromRow,
  productAssetFromRow,
  productExternalLinkFromRow,
  recalculationJobFromRow,
  reportSnapshotFromRow,
  productFromRow,
  purchaseOrderFromRow,
  purchaseOrderLineFromRow,
  settlementEntryFromRow,
  shortageResolutionFromRow,
  shortageResolutionLineFromRow,
  stocktakeFromRow,
  stocktakeLineFromRow,
  supplierClaimFromRow,
  roleFromRow,
  saleFromRow,
  saleLineFromRow,
  salesChannelFromRow,
  salesReturnFromRow,
  stockMovementFromRow,
  stockStateFromRow,
  syncRunFromRow,
  stockTransferFromRow,
  stockTransferLineFromRow,
  userAccountFromRow,
  warehouseFromRow,
  type AccountingPeriodDbRow,
  type AccountingPolicyDbRow,
  type AgentTokenDbRow,
  type AuditEventDbRow,
  type BackfillItemDbRow,
  type BackfillProjectDbRow,
  type CashAccountDbRow,
  type ChannelAgentPermissionDbRow,
  type ChannelFinanceEventDbRow,
  type ChartAccountDbRow,
  type CostApplicationDbRow,
  type CounterpartyDbRow,
  type CorrectionCaseDbRow,
  type DocumentTypeDbRow,
  type DocumentDbRow,
  type DocumentLineDbRow,
  type DocumentLinkDbRow,
  type DocumentVersionDbRow,
  type ExternalEventDbRow,
  type ExternalProductDbRow,
  type ExpenseCategoryDbRow,
  type GoodsReceiptDbRow,
  type GoodsReceiptLineDbRow,
  type IntegrationPluginDbRow,
  type InventoryLotDbRow,
  type JournalEntryDbRow,
  type JournalLineDbRow,
  type OperatingExpenseDbRow,
  type OrganizationDbRow,
  type OwnerTransactionDbRow,
  type PaymentAllocationDbRow,
  type PaymentDbRow,
  type PayoutDbRow,
  type PayoutLineDbRow,
  type PluginStateRecordDbRow,
  type ProcurementCostDbRow,
  type ProcurementCostLineDbRow,
  type ProductAssetDbRow,
  type ProductExternalLinkDbRow,
  type RecalculationJobDbRow,
  type ReportSnapshotDbRow,
  type ObservedStockDbRow,
  type ProductDbRow,
  type PurchaseOrderDbRow,
  type PurchaseOrderLineDbRow,
  type SettlementEntryDbRow,
  type ShortageResolutionDbRow,
  type ShortageResolutionLineDbRow,
  type StockMovementDbRow,
  type StockStateDbRow,
  type StocktakeDbRow,
  type StocktakeLineDbRow,
  type StockTransferDbRow,
  type StockTransferLineDbRow,
  type SupplierClaimDbRow,
  type RoleDbRow,
  type SaleDbRow,
  type SaleLineDbRow,
  type SalesChannelDbRow,
  type SalesReturnDbRow,
  type SyncRunDbRow,
  type UserAccountDbRow,
  type WarehouseDbRow
} from "./runtime-hydrators";

export interface RuntimeSession {
  app: AccountingApp;
  nextId: number;
  commit?(): Promise<void>;
  rollback?(): Promise<void>;
  close?(): Promise<void>;
}

export type RuntimeLedgerBalances = Record<string, { debit: number; credit: number }>;

export interface RuntimeReadContext {
  repos: Repositories;
  externalEvents: ExternalEventStore;
  observedStocks: ObservedStockStore;
  syncRuns: SyncRunStore;
  channelCredentialStatus?(channelId: string): Promise<{ channelId: string; saved: boolean; fields: string[] }>;
  setupMetadata(): {
    organization: AccountingState["organization"];
    accountingPolicy: AccountingState["accountingPolicy"];
    configured: boolean;
  };
}

export interface RuntimeWriteContext extends RuntimeReadContext {}

export interface RuntimeAgentTokenPrincipal {
  tokenId: string;
  workspaceId: string;
  name: string;
  mode: "read_only" | "read_write";
  scopes: string[];
}

export interface RuntimePersistence {
  save?(app: AccountingApp, workspaceId?: string): Promise<void>;
  readDashboard?(workspaceId?: string): Promise<unknown>;
  readReports?(workspaceId?: string): Promise<unknown>;
  readReportWorkspace?(workspaceId: string | undefined, options: ReportsWorkspaceOptions): Promise<unknown>;
  readProductWorkspace?(workspaceId: string | undefined, productId: string): Promise<unknown>;
  readLedgerBalances?(workspaceId?: string): Promise<RuntimeLedgerBalances>;
  openReadContext?(workspaceId?: string): Promise<RuntimeReadContext>;
  runWriteContext?<T>(workspaceId: string | undefined, handler: (context: RuntimeWriteContext) => Promise<T>): Promise<T>;
  authenticateAgentToken?(workspaceId: string, tokenId: string, tokenHash: string, options?: { touchAt?: string }): Promise<RuntimeAgentTokenPrincipal | null>;
  openReadSession?(workspaceId?: string): Promise<RuntimeSession>;
  openWriteSession?(workspaceId?: string): Promise<RuntimeSession>;
  checkReady?(): Promise<{ ok: boolean; schemaVersion?: number; message?: string }>;
  close?(): Promise<void>;
}

export interface AccountingRuntime {
  app: AccountingApp;
  persistence?: RuntimePersistence;
}

type ChannelCredentials = Record<ID, Record<string, string | undefined>>;
type PluginSecretRecords = Record<string, { revision: number; payload: Record<string, string | undefined> }>;
type RuntimeEntity = Record<string, unknown>;
type RuntimeCollectionName = Exclude<keyof AccountingState, "organization" | "accountingPolicy">;
type CleanCredentials = Record<string, string>;
type Queryable = Pool | PoolClient;
type RowRecord = Record<string, unknown>;

interface EncryptedPayload {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  data: string;
}

interface RuntimeMetaRow {
  next_id: number;
  singletons: unknown;
}

interface TableSpec {
  collection: RuntimeCollectionName;
  table: string;
  keyColumns: string[];
  orderBy?: string;
  select?: string;
  joins?: string;
  serialize(entity: RuntimeEntity): RowRecord;
  hydrate?(row: RowRecord): RuntimeEntity;
}

const RUNTIME_SCHEMA_VERSION = 4;
const RUNTIME_ROW_KEY = "default";
const DEFAULT_WORKSPACE_ID = "default";
const CREDENTIALS_AAD = Buffer.from("mpflow-channel-credentials");
const GLOBAL_REFERENCE_TABLES = new Set(["document_type_registry"]);

const STATE_JSON_TABLES = [
  "organization",
  "accounting_policy",
  "accounting_period",
  "chart_account",
  "document_type_registry",
  "document",
  "document_line",
  "document_version",
  "document_link",
  "audit_event",
  "journal_entry",
  "journal_line",
  "counterparty",
  "product",
  "product_asset",
  "warehouse",
  "stock_state",
  "inventory_lot",
  "stock_movement",
  "cost_application",
  "purchase_order",
  "purchase_order_line",
  "cash_account",
  "payment",
  "payment_allocation",
  "settlement_entry",
  "goods_receipt",
  "goods_receipt_line",
  "procurement_cost",
  "procurement_cost_line",
  "shortage_resolution",
  "shortage_resolution_line",
  "supplier_claim",
  "stock_transfer",
  "stock_transfer_line",
  "plugin_state_record",
  "integration_plugin",
  "sales_channel",
  "external_product",
  "product_external_link",
  "sync_run",
  "external_event",
  "observed_stock",
  "sale",
  "sale_line",
  "sales_return",
  "channel_finance_event",
  "payout",
  "payout_line",
  "expense_category",
  "operating_expense",
  "owner_transaction",
  "stocktake",
  "stocktake_line",
  "correction_case",
  "recalculation_job",
  "report_snapshot",
  "backfill_project",
  "backfill_item",
  "user_account",
  "role",
  "agent_token",
  "channel_agent_permission"
] as const;

const SCHEMA_ALTERS = `
  create table if not exists accounting_runtime_meta (
    key text primary key,
    schema_version integer not null,
    next_id integer not null,
    singletons jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
  );

  alter table accounting_runtime_meta add column if not exists revision bigint not null default 0;
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
  alter table channel_credential add column if not exists encrypted_credentials jsonb;
  alter table channel_credential add column if not exists fields text[] not null default '{}';
  alter table channel_credential add column if not exists created_at timestamptz not null default now();
  alter table channel_credential add column if not exists updated_at timestamptz not null default now();
  alter table external_event add column if not exists sync_run_id uuid;
  alter table external_event add column if not exists idempotency_key text;
  alter table external_event add column if not exists external_product_id uuid;
  alter table external_event add column if not exists product_id uuid;
  alter table external_event add column if not exists reason text;
  alter table external_event add column if not exists last_error text;
  alter table external_event add column if not exists created_at timestamptz not null default now();
  alter table external_event add column if not exists updated_at timestamptz not null default now();
  update external_event
    set idempotency_key = coalesce(nullif(state_json->>'idempotencyKey', ''), external_id)
    where idempotency_key is null;
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
  alter table plugin_secret_record add column if not exists created_at timestamptz not null default now();
  alter table plugin_secret_record add column if not exists updated_at timestamptz not null default now();
  alter table procurement_cost add column if not exists allocation_basis text;
  alter table procurement_cost add column if not exists pending_allocation boolean;
  update procurement_cost
    set pending_allocation = case
      when state_json ? 'pendingAllocation' then (state_json->>'pendingAllocation')::boolean
      else pending_allocation
    end
    where state_json <> '{}'::jsonb;
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
  alter table product_asset add column if not exists mime_type text;
  alter table product_asset add column if not exists width integer;
  alter table product_asset add column if not exists height integer;
  alter table product_asset add column if not exists created_by text not null default 'user';
  alter table product_asset add column if not exists updated_at timestamptz;
  alter table product_asset add column if not exists meta jsonb;
  update product_asset
    set mime_type = coalesce(nullif(state_json->>'mimeType', ''), mime_type),
        width = coalesce(nullif(state_json->>'width', '')::integer, width),
        height = coalesce(nullif(state_json->>'height', '')::integer, height),
        created_by = coalesce(nullif(state_json->>'createdBy', ''), created_by, 'user'),
        updated_at = case when nullif(state_json->>'updatedAt', '') is not null then (state_json->>'updatedAt')::timestamptz else updated_at end,
        meta = case when state_json ? 'meta' then state_json->'meta' else meta end
    where state_json <> '{}'::jsonb;
  alter table sales_channel add column if not exists enabled_streams text[];
  alter table sales_channel add column if not exists last_checked_at timestamptz;
  alter table sales_channel add column if not exists last_error text;
  alter table sales_channel add column if not exists last_sync_at timestamptz;
  update sales_channel
    set enabled_streams = case when jsonb_typeof(state_json->'enabledStreams') = 'array'
          then array(select jsonb_array_elements_text(state_json->'enabledStreams'))
          else enabled_streams
        end,
        last_checked_at = case when nullif(state_json->>'lastCheckedAt', '') is not null then (state_json->>'lastCheckedAt')::timestamptz else last_checked_at end,
        last_error = nullif(state_json->>'lastError', ''),
        last_sync_at = case when nullif(state_json->>'lastSyncAt', '') is not null then (state_json->>'lastSyncAt')::timestamptz else last_sync_at end
    where state_json <> '{}'::jsonb;
  alter table user_account add column if not exists role_code text;
  alter table user_account add column if not exists invited_at timestamptz;
  alter table user_account add column if not exists last_active_at timestamptz;
  update user_account
    set role_code = coalesce(nullif(state_json->>'roleCode', ''), role_code, 'operator'),
        invited_at = case when nullif(state_json->>'invitedAt', '') is not null then (state_json->>'invitedAt')::timestamptz else invited_at end,
        last_active_at = case when nullif(state_json->>'lastActiveAt', '') is not null then (state_json->>'lastActiveAt')::timestamptz else last_active_at end
    where state_json <> '{}'::jsonb or role_code is null;
  alter table user_account alter column role_code set default 'operator';
  alter table agent_token add column if not exists mode text;
  alter table agent_token add column if not exists masked_token text;
  alter table agent_token add column if not exists token_hash text;
  alter table agent_token add column if not exists created_at timestamptz not null default now();
  alter table agent_token add column if not exists last_used_at timestamptz;
  alter table agent_token add column if not exists revoked_at timestamptz;
  update agent_token
    set mode = coalesce(nullif(state_json->>'mode', ''), mode, 'read_only'),
        masked_token = coalesce(nullif(state_json->>'maskedToken', ''), masked_token),
        token_hash = coalesce(nullif(state_json->>'tokenHash', ''), token_hash),
        created_at = case when nullif(state_json->>'createdAt', '') is not null then (state_json->>'createdAt')::timestamptz else created_at end,
        last_used_at = case when nullif(state_json->>'lastUsedAt', '') is not null then (state_json->>'lastUsedAt')::timestamptz else last_used_at end,
        revoked_at = case when nullif(state_json->>'revokedAt', '') is not null then (state_json->>'revokedAt')::timestamptz else revoked_at end
    where state_json <> '{}'::jsonb or mode is null;
  alter table agent_token alter column mode set default 'read_only';
  alter table operating_expense add column if not exists counterparty_id uuid references counterparty(id);
  alter table operating_expense add column if not exists amount_paid_rub numeric(18,2);
  alter table operating_expense add column if not exists payment_mode text;
  alter table operating_expense add column if not exists payment_status text;
  alter table operating_expense add column if not exists cash_account_id uuid references cash_account(id);
  update operating_expense
    set amount_paid_rub = coalesce(nullif(state_json->>'amountPaidRub', '')::numeric, amount_paid_rub, amount_rub),
        payment_mode = coalesce(nullif(state_json->>'paymentMode', ''), payment_mode, 'paid_now'),
        payment_status = coalesce(nullif(state_json->>'paymentStatus', ''), payment_status, 'paid')
    where state_json <> '{}'::jsonb or amount_paid_rub is null or payment_mode is null or payment_status is null;
  alter table operating_expense alter column payment_mode set default 'paid_now';
  alter table operating_expense alter column payment_status set default 'paid';
  alter table sale add column if not exists financial_document_id uuid references document(id);
  alter table sale add column if not exists warehouse_id uuid references warehouse(id);
  alter table sale add column if not exists external_order_id text;
  alter table sale add column if not exists recognized_gross_amount_rub numeric(18,2);
  alter table sale add column if not exists financial_recognition_date date;
  alter table sale add column if not exists cost_amount_rub numeric(18,2);
  alter table sale add column if not exists gross_profit_rub numeric(18,2);
  update sale
    set external_order_id = coalesce(nullif(state_json->>'externalOrderId', ''), external_order_id),
        recognized_gross_amount_rub = coalesce(nullif(state_json->>'recognizedGrossAmountRub', '')::numeric, recognized_gross_amount_rub),
        financial_recognition_date = case when nullif(state_json->>'financialRecognitionDate', '') is not null then (state_json->>'financialRecognitionDate')::date else financial_recognition_date end,
        cost_amount_rub = coalesce(nullif(state_json->>'costAmountRub', '')::numeric, cost_amount_rub, 0),
        gross_profit_rub = coalesce(nullif(state_json->>'grossProfitRub', '')::numeric, gross_profit_rub, gross_amount_rub)
    where state_json <> '{}'::jsonb or cost_amount_rub is null or gross_profit_rub is null;
  alter table sale_line add column if not exists external_product_id uuid references external_product(id);
  alter table sale_line add column if not exists gross_profit_rub numeric(18,2);
  update sale_line
    set gross_profit_rub = coalesce(nullif(state_json->>'grossProfitRub', '')::numeric, gross_profit_rub, revenue_rub - cost_rub)
    where state_json <> '{}'::jsonb or gross_profit_rub is null;
  alter table sales_return add column if not exists external_event_id uuid references external_event(id);
  alter table sales_return add column if not exists warehouse_id uuid references warehouse(id);
  alter table sales_return add column if not exists stock_state_code text;
  alter table sales_return add column if not exists status text;
  alter table sales_return add column if not exists comment text;
  update sales_return
    set stock_state_code = coalesce(nullif(state_json->>'stockStateCode', ''), stock_state_code),
        status = coalesce(nullif(state_json->>'status', ''), status, 'draft'),
        comment = coalesce(nullif(state_json->>'comment', ''), comment)
    where state_json <> '{}'::jsonb or status is null;
  alter table sales_return alter column status set default 'draft';
  alter table channel_finance_event add column if not exists external_id text;
  alter table channel_finance_event add column if not exists treatment text;
  alter table channel_finance_event add column if not exists category text;
  alter table channel_finance_event add column if not exists operation_type text;
  alter table channel_finance_event add column if not exists operation_type_name text;
  alter table channel_finance_event add column if not exists linked_sale_id uuid references sale(id);
  alter table channel_finance_event add column if not exists sale_allocations jsonb;
  alter table channel_finance_event add column if not exists linked_return_id uuid references sales_return(id);
  alter table channel_finance_event add column if not exists status text;
  alter table channel_finance_event add column if not exists comment text;
  update channel_finance_event
    set external_id = coalesce(nullif(state_json->>'externalId', ''), external_id),
        treatment = coalesce(nullif(state_json->>'treatment', ''), treatment),
        category = coalesce(nullif(state_json->>'category', ''), category),
        operation_type = coalesce(nullif(state_json->>'operationType', ''), operation_type),
        operation_type_name = coalesce(nullif(state_json->>'operationTypeName', ''), operation_type_name),
        sale_allocations = case when state_json ? 'saleAllocations' then state_json->'saleAllocations' else sale_allocations end,
        status = coalesce(nullif(state_json->>'status', ''), status, 'new'),
        comment = coalesce(nullif(state_json->>'comment', ''), comment)
    where state_json <> '{}'::jsonb or status is null;
  alter table channel_finance_event alter column status set default 'new';
  alter table payout alter column payment_id drop not null;
  alter table payout add column if not exists composition_mode text;
  alter table payout add column if not exists external_event_id uuid references external_event(id);
  alter table payout add column if not exists external_payout_id text;
  alter table payout add column if not exists period_from date;
  alter table payout add column if not exists period_to date;
  alter table payout add column if not exists expected_amount_rub numeric(18,2);
  alter table payout add column if not exists cash_account_id uuid references cash_account(id);
  alter table payout add column if not exists difference_reason text;
  alter table payout add column if not exists difference_accepted boolean;
  update payout
    set composition_mode = coalesce(nullif(state_json->>'compositionMode', ''), composition_mode, 'auto'),
        external_payout_id = coalesce(nullif(state_json->>'externalPayoutId', ''), external_payout_id),
        period_from = case when nullif(state_json->>'periodFrom', '') is not null then (state_json->>'periodFrom')::date else period_from end,
        period_to = case when nullif(state_json->>'periodTo', '') is not null then (state_json->>'periodTo')::date else period_to end,
        expected_amount_rub = coalesce(nullif(state_json->>'expectedAmountRub', '')::numeric, expected_amount_rub, gross_events_rub),
        difference_reason = coalesce(nullif(state_json->>'differenceReason', ''), difference_reason),
        difference_accepted = coalesce(nullif(state_json->>'differenceAccepted', '')::boolean, difference_accepted, false)
    where state_json <> '{}'::jsonb or composition_mode is null or expected_amount_rub is null;
  alter table payout alter column composition_mode set default 'auto';
  alter table payout_line add column if not exists source_type text;
  alter table payout_line add column if not exists source_id text;
  alter table payout_line add column if not exists line_group text;
  update payout_line
    set source_type = coalesce(nullif(state_json->>'sourceType', ''), source_type),
        source_id = coalesce(nullif(state_json->>'sourceId', ''), source_id),
        line_group = coalesce(nullif(state_json->>'lineGroup', ''), line_group)
    where state_json <> '{}'::jsonb;
  alter table stock_state add column if not exists state_code text not null default 'sellable';
  update stock_state
    set state_code = coalesce(nullif(state_json->>'stateCode', ''), state_code, 'sellable')
    where state_json <> '{}'::jsonb or state_code is null;
  do $$
  begin
    if exists (select 1 from pg_constraint where conname = 'stock_state_pkey') then
      alter table stock_state drop constraint stock_state_pkey;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'stock_state_pkey') then
      alter table stock_state add constraint stock_state_pkey primary key (product_id, warehouse_id, state_code);
    end if;
  end $$;
  alter table inventory_lot add column if not exists stock_state_code text;
  alter table inventory_lot add column if not exists source_line_public_id text;
  update inventory_lot
    set stock_state_code = coalesce(nullif(state_json->>'stockStateCode', ''), stock_state_code),
        source_line_public_id = coalesce(nullif(state_json->>'sourceLineId', ''), source_line_public_id)
    where state_json <> '{}'::jsonb;
  alter table stock_movement add column if not exists stock_state_code text;
  update stock_movement
    set stock_state_code = coalesce(nullif(state_json->>'stockStateCode', ''), stock_state_code)
    where state_json <> '{}'::jsonb;
  alter table cost_application add column if not exists target_line_id text;
  alter table cost_application add column if not exists target_line_type text;
  update cost_application
    set target_line_id = coalesce(nullif(state_json->>'targetLineId', ''), target_line_id),
        target_line_type = coalesce(nullif(state_json->>'targetLineType', ''), target_line_type)
    where state_json <> '{}'::jsonb;
  alter table stock_transfer add column if not exists from_stock_state_code text;
  alter table stock_transfer add column if not exists to_stock_state_code text;
  alter table stock_transfer add column if not exists transfer_type text;
  alter table stock_transfer add column if not exists channel_id uuid references sales_channel(id);
  alter table stock_transfer add column if not exists source_goods_receipt_id uuid references goods_receipt(id);
  alter table stock_transfer add column if not exists source_document_id uuid references document(id);
  alter table stock_transfer add column if not exists provider_metadata jsonb;
  alter table stock_transfer add column if not exists comment text;
  update stock_transfer
    set from_stock_state_code = coalesce(nullif(state_json->>'fromStockStateCode', ''), from_stock_state_code),
        to_stock_state_code = coalesce(nullif(state_json->>'toStockStateCode', ''), to_stock_state_code),
        transfer_type = coalesce(nullif(state_json->>'transferType', ''), transfer_type),
        provider_metadata = case when state_json ? 'providerMetadata' then state_json->'providerMetadata' else provider_metadata end,
        comment = coalesce(nullif(state_json->>'comment', ''), comment)
    where state_json <> '{}'::jsonb;
  alter table stock_transfer_line add column if not exists source_goods_receipt_line_id uuid references goods_receipt_line(id);
  alter table stock_transfer_line add column if not exists source_purchase_order_line_id uuid references purchase_order_line(id);
  alter table stock_transfer_line add column if not exists provider_metadata jsonb;
  update stock_transfer_line
    set provider_metadata = case when state_json ? 'providerMetadata' then state_json->'providerMetadata' else provider_metadata end
    where state_json <> '{}'::jsonb;
  alter table backfill_project add column if not exists created_at timestamptz not null default now();
`;

export const LEGACY_STATE_JSON_ALTERS = STATE_JSON_TABLES
  .map((table) => `alter table ${table} add column if not exists state_json jsonb not null default '{}'::jsonb;`)
  .join("\n");

export const DROP_LEGACY_STATE_JSON_ALTERS = STATE_JSON_TABLES
  .map((table) => `alter table ${table} drop column if exists state_json;`)
  .join("\n");

const PUBLIC_ID_ALTERS = STATE_JSON_TABLES
  .map((table) => `
    alter table ${table} add column if not exists public_id text;
    update ${table}
      set public_id = ${publicIdBackfillExpression(table)}
      where public_id is null and ${publicIdBackfillExpression(table)} is not null;
    create index if not exists ${table}_workspace_public_id_idx on ${table}(workspace_id, public_id);
  `)
  .join("\n");

const POST_PUBLIC_ID_BACKFILLS = `
  update operating_expense expense
    set counterparty_id = counterparty.id
    from counterparty
    where expense.counterparty_id is null
      and nullif(expense.state_json->>'counterpartyId', '') is not null
      and counterparty.workspace_id = expense.workspace_id
      and counterparty.public_id = nullif(expense.state_json->>'counterpartyId', '');
  update operating_expense expense
    set cash_account_id = cash_account.id
    from cash_account
    where expense.cash_account_id is null
      and nullif(expense.state_json->>'cashAccountId', '') is not null
      and cash_account.workspace_id = expense.workspace_id
      and cash_account.public_id = nullif(expense.state_json->>'cashAccountId', '');
  update sale
    set financial_document_id = document.id
    from document
    where sale.financial_document_id is null
      and nullif(sale.state_json->>'financialDocumentId', '') is not null
      and document.workspace_id = sale.workspace_id
      and document.public_id = nullif(sale.state_json->>'financialDocumentId', '');
  update sale
    set warehouse_id = warehouse.id
    from warehouse
    where sale.warehouse_id is null
      and nullif(sale.state_json->>'warehouseId', '') is not null
      and warehouse.workspace_id = sale.workspace_id
      and warehouse.public_id = nullif(sale.state_json->>'warehouseId', '');
  update sale_line
    set external_product_id = external_product.id
    from external_product
    where sale_line.external_product_id is null
      and nullif(sale_line.state_json->>'externalProductId', '') is not null
      and external_product.workspace_id = sale_line.workspace_id
      and external_product.public_id = nullif(sale_line.state_json->>'externalProductId', '');
  update sales_return
    set external_event_id = external_event.id
    from external_event
    where sales_return.external_event_id is null
      and nullif(sales_return.state_json->>'externalEventId', '') is not null
      and external_event.workspace_id = sales_return.workspace_id
      and external_event.public_id = nullif(sales_return.state_json->>'externalEventId', '');
  update sales_return
    set warehouse_id = warehouse.id
    from warehouse
    where sales_return.warehouse_id is null
      and nullif(sales_return.state_json->>'warehouseId', '') is not null
      and warehouse.workspace_id = sales_return.workspace_id
      and warehouse.public_id = nullif(sales_return.state_json->>'warehouseId', '');
  update channel_finance_event
    set payout_id = payout.id
    from payout
    where channel_finance_event.payout_id is null
      and nullif(channel_finance_event.state_json->>'payoutId', '') is not null
      and payout.workspace_id = channel_finance_event.workspace_id
      and payout.public_id = nullif(channel_finance_event.state_json->>'payoutId', '');
  update channel_finance_event
    set linked_sale_id = sale.id
    from sale
    where channel_finance_event.linked_sale_id is null
      and nullif(channel_finance_event.state_json->>'linkedSaleId', '') is not null
      and sale.workspace_id = channel_finance_event.workspace_id
      and sale.public_id = nullif(channel_finance_event.state_json->>'linkedSaleId', '');
  update channel_finance_event
    set linked_return_id = sales_return.id
    from sales_return
    where channel_finance_event.linked_return_id is null
      and nullif(channel_finance_event.state_json->>'linkedReturnId', '') is not null
      and sales_return.workspace_id = channel_finance_event.workspace_id
      and sales_return.public_id = nullif(channel_finance_event.state_json->>'linkedReturnId', '');
  update payout
    set external_event_id = external_event.id
    from external_event
    where payout.external_event_id is null
      and nullif(payout.state_json->>'externalEventId', '') is not null
      and external_event.workspace_id = payout.workspace_id
      and external_event.public_id = nullif(payout.state_json->>'externalEventId', '');
  update payout
    set payment_id = payment.id
    from payment
    where payout.payment_id is null
      and nullif(payout.state_json->>'paymentId', '') is not null
      and payment.workspace_id = payout.workspace_id
      and payment.public_id = nullif(payout.state_json->>'paymentId', '');
  update payout
    set cash_account_id = cash_account.id
    from cash_account
    where payout.cash_account_id is null
      and nullif(payout.state_json->>'cashAccountId', '') is not null
      and cash_account.workspace_id = payout.workspace_id
      and cash_account.public_id = nullif(payout.state_json->>'cashAccountId', '');
  update payout_line
    set channel_finance_event_id = channel_finance_event.id
    from channel_finance_event
    where payout_line.channel_finance_event_id is null
      and nullif(payout_line.state_json->>'channelFinanceEventId', '') is not null
      and channel_finance_event.workspace_id = payout_line.workspace_id
      and channel_finance_event.public_id = nullif(payout_line.state_json->>'channelFinanceEventId', '');
  update payout_line
    set sale_id = sale.id
    from sale
    where payout_line.sale_id is null
      and nullif(payout_line.state_json->>'saleId', '') is not null
      and sale.workspace_id = payout_line.workspace_id
      and sale.public_id = nullif(payout_line.state_json->>'saleId', '');
  update stock_state
    set public_id = concat(product.public_id, ':', warehouse.public_id, ':', stock_state.state_code)
    from product, warehouse
    where product.id = stock_state.product_id
      and warehouse.id = stock_state.warehouse_id
      and product.workspace_id = stock_state.workspace_id
      and warehouse.workspace_id = stock_state.workspace_id
      and (stock_state.public_id is null or stock_state.public_id = concat(product.public_id, ':', warehouse.public_id));
  update stock_transfer
    set channel_id = sales_channel.id
    from sales_channel
    where stock_transfer.channel_id is null
      and nullif(stock_transfer.state_json->>'channelId', '') is not null
      and sales_channel.workspace_id = stock_transfer.workspace_id
      and sales_channel.public_id = nullif(stock_transfer.state_json->>'channelId', '');
  update stock_transfer
    set source_goods_receipt_id = goods_receipt.id
    from goods_receipt
    where stock_transfer.source_goods_receipt_id is null
      and nullif(stock_transfer.state_json->>'sourceGoodsReceiptId', '') is not null
      and goods_receipt.workspace_id = stock_transfer.workspace_id
      and goods_receipt.public_id = nullif(stock_transfer.state_json->>'sourceGoodsReceiptId', '');
  update stock_transfer
    set source_document_id = document.id
    from document
    where stock_transfer.source_document_id is null
      and nullif(stock_transfer.state_json->>'sourceDocumentId', '') is not null
      and document.workspace_id = stock_transfer.workspace_id
      and document.public_id = nullif(stock_transfer.state_json->>'sourceDocumentId', '');
  update stock_transfer_line
    set source_goods_receipt_line_id = goods_receipt_line.id
    from goods_receipt_line
    where stock_transfer_line.source_goods_receipt_line_id is null
      and nullif(stock_transfer_line.state_json->>'sourceGoodsReceiptLineId', '') is not null
      and goods_receipt_line.workspace_id = stock_transfer_line.workspace_id
      and goods_receipt_line.public_id = nullif(stock_transfer_line.state_json->>'sourceGoodsReceiptLineId', '');
  update stock_transfer_line
    set source_purchase_order_line_id = purchase_order_line.id
    from purchase_order_line
    where stock_transfer_line.source_purchase_order_line_id is null
      and nullif(stock_transfer_line.state_json->>'sourcePurchaseOrderLineId', '') is not null
      and purchase_order_line.workspace_id = stock_transfer_line.workspace_id
      and purchase_order_line.public_id = nullif(stock_transfer_line.state_json->>'sourcePurchaseOrderLineId', '');
`;

function publicIdBackfillExpression(table: typeof STATE_JSON_TABLES[number]) {
  if (table === "stock_state") {
    return `
        case
          when nullif(state_json->>'productId', '') is not null and nullif(state_json->>'warehouseId', '') is not null
          then concat(state_json->>'productId', ':', state_json->>'warehouseId', ':', coalesce(nullif(state_json->>'stateCode', ''), 'sellable'))
        end
      `;
  }
  return "coalesce(nullif(state_json->>'id', ''), nullif(state_json->>'code', ''))";
}

const WORKSPACE_ALTERS = [
  ...STATE_JSON_TABLES.map((table) => `
    alter table ${table} add column if not exists workspace_id text not null default '${DEFAULT_WORKSPACE_ID}';
    create index if not exists ${table}_workspace_id_idx on ${table}(workspace_id);
  `),
  `
    alter table channel_credential add column if not exists workspace_id text not null default '${DEFAULT_WORKSPACE_ID}';
    create index if not exists channel_credential_workspace_id_idx on channel_credential(workspace_id);
  `,
  `
    alter table plugin_secret_record add column if not exists workspace_id text not null default '${DEFAULT_WORKSPACE_ID}';
    create index if not exists plugin_secret_record_workspace_id_idx on plugin_secret_record(workspace_id);
    alter table plugin_secret_record drop constraint if exists plugin_secret_record_plugin_code_namespace_scope_type_scope_id_secret_key_key;
    create unique index if not exists plugin_secret_record_workspace_key_idx
      on plugin_secret_record(workspace_id, plugin_code, namespace, scope_type, scope_id, secret_key);
  `,
  `
    alter table integration_plugin drop constraint if exists integration_plugin_code_key;
    create unique index if not exists integration_plugin_workspace_code_idx
      on integration_plugin(workspace_id, code);
  `
].join("\n");

const schemaSqlPromise = readFile(new URL("./schema.sql", import.meta.url), "utf8");

const TABLES: TableSpec[] = [
  spec("periods", "accounting_period", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "periods.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "periods.organizationId")),
    label: requiredString(entity.label, "periods.label"),
    starts_on: requiredString(entity.startsOn, "periods.startsOn"),
    ends_on: requiredString(entity.endsOn, "periods.endsOn"),
    status: requiredString(entity.status, "periods.status")
  }), "accounting_period.starts_on, accounting_period.id", {
    select: ACCOUNTING_PERIOD_SELECT,
    joins: ACCOUNTING_PERIOD_JOINS,
    hydrate: (row) => accountingPeriodFromRow(row as unknown as AccountingPeriodDbRow) as unknown as RuntimeEntity
  }),
  spec("chartAccounts", "chart_account", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "chartAccounts.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "chartAccounts.organizationId")),
    code: requiredString(entity.code, "chartAccounts.code"),
    name: requiredString(entity.name, "chartAccounts.name"),
    kind: requiredString(entity.kind, "chartAccounts.kind"),
    normal_side: requiredString(entity.normalSide, "chartAccounts.normalSide"),
    is_active: requiredBoolean(entity.isActive, "chartAccounts.isActive")
  }), "chart_account.code", {
    select: CHART_ACCOUNT_SELECT,
    joins: CHART_ACCOUNT_JOINS,
    hydrate: (row) => chartAccountFromRow(row as unknown as ChartAccountDbRow) as unknown as RuntimeEntity
  }),
  spec("documentTypes", "document_type_registry", ["code"], (entity) => ({
    code: requiredString(entity.code, "documentTypes.code"),
    module_code: requiredString(entity.moduleCode, "documentTypes.moduleCode"),
    display_name: requiredString(entity.displayName, "documentTypes.displayName"),
    is_posting: requiredBoolean(entity.isPosting, "documentTypes.isPosting"),
    posting_rule_code: optionalString(entity.postingRuleCode),
    allows_draft: requiredBoolean(entity.allowsDraft, "documentTypes.allowsDraft"),
    allows_reversal: requiredBoolean(entity.allowsReversal, "documentTypes.allowsReversal"),
    allows_correction: requiredBoolean(entity.allowsCorrection, "documentTypes.allowsCorrection")
  }), "document_type_registry.code", {
    select: DOCUMENT_TYPE_SELECT,
    hydrate: (row) => documentTypeFromRow(row as unknown as DocumentTypeDbRow) as unknown as RuntimeEntity
  }),
  spec("documents", "document", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "documents.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "documents.organizationId")),
    document_type: requiredString(entity.documentType, "documents.documentType"),
    number: requiredString(entity.number, "documents.number"),
    status: requiredString(entity.status, "documents.status"),
    accounting_date: requiredString(entity.accountingDate, "documents.accountingDate"),
    source: requiredString(entity.source, "documents.source"),
    amount_rub: requiredNumber(entity.amountRub, "documents.amountRub"),
    title: requiredString(entity.title, "documents.title"),
    comment: optionalString(entity.comment),
    corrected_from_document_id: optionalUuid(entity.correctedFromDocumentId),
    created_at: requiredString(entity.createdAt, "documents.createdAt"),
    posted_at: optionalString(entity.postedAt),
    cancelled_at: optionalString(entity.cancelledAt),
  }), "document.accounting_date, document.id", {
    select: DOCUMENT_SELECT,
    joins: DOCUMENT_JOINS,
    hydrate: (row) => documentFromRow(row as unknown as DocumentDbRow) as unknown as RuntimeEntity
  }),
  spec("documentLines", "document_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "documentLines.id")),
    document_id: entityUuid(requiredString(entity.documentId, "documentLines.documentId")),
    line_no: requiredNumber(entity.lineNo, "documentLines.lineNo"),
    line_type: requiredString(entity.lineType, "documentLines.lineType"),
    qty: optionalNumber(entity.qty),
    amount_rub: optionalNumber(entity.amountRub),
    payload: entity.payload ?? {}
  }), "document_line.document_id, document_line.line_no", {
    select: DOCUMENT_LINE_SELECT,
    joins: DOCUMENT_LINE_JOINS,
    hydrate: (row) => documentLineFromRow(row as unknown as DocumentLineDbRow) as unknown as RuntimeEntity
  }),
  spec("documentVersions", "document_version", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "documentVersions.id")),
    document_id: entityUuid(requiredString(entity.documentId, "documentVersions.documentId")),
    version_no: requiredNumber(entity.versionNo, "documentVersions.versionNo"),
    snapshot: entity.snapshot ?? {},
    reason: requiredString(entity.reason, "documentVersions.reason"),
    created_at: requiredString(entity.createdAt, "documentVersions.createdAt")
  }), "document_version.document_id, document_version.version_no", {
    select: DOCUMENT_VERSION_SELECT,
    joins: DOCUMENT_VERSION_JOINS,
    hydrate: (row) => documentVersionFromRow(row as unknown as DocumentVersionDbRow) as unknown as RuntimeEntity
  }),
  spec("documentLinks", "document_link", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "documentLinks.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "documentLinks.organizationId")),
    from_document_id: entityUuid(requiredString(entity.fromDocumentId, "documentLinks.fromDocumentId")),
    to_document_id: entityUuid(requiredString(entity.toDocumentId, "documentLinks.toDocumentId")),
    link_type: requiredString(entity.linkType, "documentLinks.linkType")
  }), "document_link.id", {
    select: DOCUMENT_LINK_SELECT,
    joins: DOCUMENT_LINK_JOINS,
    hydrate: (row) => documentLinkFromRow(row as unknown as DocumentLinkDbRow) as unknown as RuntimeEntity
  }),
  spec("journalEntries", "journal_entry", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "journalEntries.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "journalEntries.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "journalEntries.documentId")),
    accounting_date: requiredString(entity.accountingDate, "journalEntries.accountingDate"),
    memo: requiredString(entity.memo, "journalEntries.memo"),
    reversal_of_entry_id: optionalUuid(entity.reversalOfEntryId),
    created_at: requiredString(entity.createdAt, "journalEntries.createdAt")
  }), "journal_entry.accounting_date, journal_entry.id", {
    select: JOURNAL_ENTRY_SELECT,
    joins: JOURNAL_ENTRY_JOINS,
    hydrate: (row) => journalEntryFromRow(row as unknown as JournalEntryDbRow) as unknown as RuntimeEntity
  }),
  spec("journalLines", "journal_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "journalLines.id")),
    journal_entry_id: entityUuid(requiredString(entity.journalEntryId, "journalLines.journalEntryId")),
    account_code: requiredString(entity.accountCode, "journalLines.accountCode"),
    debit: requiredNumber(entity.debit, "journalLines.debit"),
    credit: requiredNumber(entity.credit, "journalLines.credit"),
    memo: requiredString(entity.memo, "journalLines.memo")
  }), "journal_line.journal_entry_id, journal_line.id", {
    select: JOURNAL_LINE_SELECT,
    joins: JOURNAL_LINE_JOINS,
    hydrate: (row) => journalLineFromRow(row as unknown as JournalLineDbRow) as unknown as RuntimeEntity
  }),
  spec("auditEvents", "audit_event", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "auditEvents.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "auditEvents.organizationId")),
    actor_label: requiredString(entity.actorLabel, "auditEvents.actorLabel"),
    entity_type: requiredString(entity.entityType, "auditEvents.entityType"),
    entity_id: stableUuid(requiredString(entity.entityId, "auditEvents.entityId")),
    entity_public_id: requiredString(entity.entityId, "auditEvents.entityId"),
    event_type: requiredString(entity.eventType, "auditEvents.eventType"),
    before_json: entity.before ?? null,
    after_json: entity.after ?? null,
    reason: optionalString(entity.reason),
    created_at: requiredString(entity.createdAt, "auditEvents.createdAt")
  }), "audit_event.created_at, audit_event.id", {
    select: AUDIT_EVENT_SELECT,
    joins: AUDIT_EVENT_JOINS,
    hydrate: (row) => auditEventFromRow(row as unknown as AuditEventDbRow) as unknown as RuntimeEntity
  }),
  spec("counterparties", "counterparty", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "counterparties.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "counterparties.organizationId")),
    name: requiredString(entity.name, "counterparties.name"),
    counterparty_type: requiredString(entity.counterpartyType, "counterparties.counterpartyType"),
    inn: optionalString(entity.inn),
    country: optionalString(entity.country),
    is_active: requiredBoolean(entity.isActive, "counterparties.isActive")
  }), "counterparty.name, counterparty.id", {
    select: COUNTERPARTY_SELECT,
    joins: COUNTERPARTY_JOINS,
    hydrate: (row) => counterpartyFromRow(row as unknown as CounterpartyDbRow) as unknown as RuntimeEntity
  }),
  spec("products", "product", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "products.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "products.organizationId")),
    sku: requiredString(entity.sku, "products.sku"),
    name: requiredString(entity.name, "products.name"),
    barcode: optionalString(entity.barcode),
    category: optionalString(entity.category),
    image_url: optionalString(entity.imageUrl),
    status: requiredString(entity.status, "products.status"),
    created_at: requiredString(entity.createdAt, "products.createdAt"),
    unit: requiredString(entity.unit, "products.unit"),
    brand: optionalString(entity.brand),
    description: optionalString(entity.description),
    weight_grams: optionalNumber(entity.weightGrams),
    length_mm: optionalNumber(entity.lengthMm),
    width_mm: optionalNumber(entity.widthMm),
    height_mm: optionalNumber(entity.heightMm),
    manufacturer_article: optionalString(entity.manufacturerArticle),
    comment: optionalString(entity.comment)
  }), "product.sku, product.id", {
    select: PRODUCT_SELECT,
    joins: PRODUCT_JOINS,
    hydrate: (row) => productFromRow(row as unknown as ProductDbRow) as unknown as RuntimeEntity
  }),
  spec("productAssets", "product_asset", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "productAssets.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "productAssets.organizationId")),
    product_id: entityUuid(requiredString(entity.productId, "productAssets.productId")),
    role: requiredString(entity.role, "productAssets.role"),
    slide_type: optionalString(entity.slideType),
    url: requiredString(entity.url, "productAssets.url"),
    storage_key: requiredString(entity.storageKey, "productAssets.storageKey"),
    mime_type: optionalString(entity.mimeType),
    width: optionalNumber(entity.width),
    height: optionalNumber(entity.height),
    status: requiredString(entity.status, "productAssets.status"),
    sort_order: requiredNumber(entity.sortOrder, "productAssets.sortOrder"),
    created_by: requiredString(entity.createdBy, "productAssets.createdBy"),
    created_at: requiredString(entity.createdAt, "productAssets.createdAt"),
    updated_at: optionalString(entity.updatedAt),
    meta: entity.meta ?? null
  }), "product_asset.product_id, product_asset.sort_order, product_asset.created_at", {
    select: PRODUCT_ASSET_SELECT,
    joins: PRODUCT_ASSET_JOINS,
    hydrate: (row) => productAssetFromRow(row as unknown as ProductAssetDbRow) as unknown as RuntimeEntity
  }),
  spec("warehouses", "warehouse", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "warehouses.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "warehouses.organizationId")),
    name: requiredString(entity.name, "warehouses.name"),
    warehouse_type: requiredString(entity.warehouseType, "warehouses.warehouseType"),
    channel_id: optionalUuid(entity.channelId),
    is_active: requiredBoolean(entity.isActive, "warehouses.isActive")
  }), "warehouse.name, warehouse.id", {
    select: WAREHOUSE_SELECT,
    joins: WAREHOUSE_JOINS,
    hydrate: (row) => warehouseFromRow(row as unknown as WarehouseDbRow) as unknown as RuntimeEntity
  }),
  spec("stockStates", "stock_state", ["product_id", "warehouse_id", "state_code"], (entity) => ({
    product_id: entityUuid(requiredString(entity.productId, "stockStates.productId")),
    warehouse_id: entityUuid(requiredString(entity.warehouseId, "stockStates.warehouseId")),
    state_code: optionalString(entity.stateCode) ?? "sellable",
    qty: requiredNumber(entity.qty, "stockStates.qty"),
    cost_rub: requiredNumber(entity.costRub, "stockStates.costRub")
  }), "stock_state.product_id, stock_state.warehouse_id, stock_state.state_code", {
    select: STOCK_STATE_SELECT,
    joins: STOCK_STATE_JOINS,
    hydrate: (row) => stockStateFromRow(row as unknown as StockStateDbRow) as unknown as RuntimeEntity
  }),
  spec("inventoryLots", "inventory_lot", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "inventoryLots.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "inventoryLots.organizationId")),
    product_id: entityUuid(requiredString(entity.productId, "inventoryLots.productId")),
    warehouse_id: entityUuid(requiredString(entity.warehouseId, "inventoryLots.warehouseId")),
    stock_state_code: optionalString(entity.stockStateCode),
    source_document_id: entityUuid(requiredString(entity.sourceDocumentId, "inventoryLots.sourceDocumentId")),
    source_line_id: optionalUuid(entity.sourceLineId),
    source_line_public_id: optionalString(entity.sourceLineId),
    received_at: requiredString(entity.receivedAt, "inventoryLots.receivedAt"),
    qty_initial: requiredNumber(entity.qtyInitial, "inventoryLots.qtyInitial"),
    qty_remaining: requiredNumber(entity.qtyRemaining, "inventoryLots.qtyRemaining"),
    cost_initial_rub: requiredNumber(entity.costInitialRub, "inventoryLots.costInitialRub"),
    cost_remaining_rub: requiredNumber(entity.costRemainingRub, "inventoryLots.costRemainingRub"),
    unit_cost_rub: requiredNumber(entity.unitCostRub, "inventoryLots.unitCostRub"),
    status: requiredString(entity.status, "inventoryLots.status")
  }), "inventory_lot.received_at, inventory_lot.id", {
    select: INVENTORY_LOT_SELECT,
    joins: INVENTORY_LOT_JOINS,
    hydrate: (row) => inventoryLotFromRow(row as unknown as InventoryLotDbRow) as unknown as RuntimeEntity
  }),
  spec("stockMovements", "stock_movement", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "stockMovements.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "stockMovements.organizationId")),
    product_id: entityUuid(requiredString(entity.productId, "stockMovements.productId")),
    warehouse_id: entityUuid(requiredString(entity.warehouseId, "stockMovements.warehouseId")),
    stock_state_code: optionalString(entity.stockStateCode),
    document_id: entityUuid(requiredString(entity.documentId, "stockMovements.documentId")),
    movement_type: requiredString(entity.movementType, "stockMovements.movementType"),
    qty: requiredNumber(entity.qty, "stockMovements.qty"),
    cost_rub: requiredNumber(entity.costRub, "stockMovements.costRub"),
    occurred_at: requiredString(entity.occurredAt, "stockMovements.occurredAt"),
    lot_id: optionalUuid(entity.lotId)
  }), "stock_movement.occurred_at, stock_movement.id", {
    select: STOCK_MOVEMENT_SELECT,
    joins: STOCK_MOVEMENT_JOINS,
    hydrate: (row) => stockMovementFromRow(row as unknown as StockMovementDbRow) as unknown as RuntimeEntity
  }),
  spec("costApplications", "cost_application", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "costApplications.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "costApplications.organizationId")),
    source_document_id: entityUuid(requiredString(entity.sourceDocumentId, "costApplications.sourceDocumentId")),
    outbound_document_id: entityUuid(requiredString(entity.outboundDocumentId, "costApplications.outboundDocumentId")),
    target_line_id: optionalString(entity.targetLineId),
    target_line_type: optionalString(entity.targetLineType),
    product_id: entityUuid(requiredString(entity.productId, "costApplications.productId")),
    from_lot_id: entityUuid(requiredString(entity.fromLotId, "costApplications.fromLotId")),
    qty: requiredNumber(entity.qty, "costApplications.qty"),
    cost_rub: requiredNumber(entity.costRub, "costApplications.costRub"),
    application_type: requiredString(entity.applicationType, "costApplications.applicationType"),
    created_at: requiredString(entity.createdAt, "costApplications.createdAt")
  }), "cost_application.created_at, cost_application.id", {
    select: COST_APPLICATION_SELECT,
    joins: COST_APPLICATION_JOINS,
    hydrate: (row) => costApplicationFromRow(row as unknown as CostApplicationDbRow) as unknown as RuntimeEntity
  }),
  spec("purchaseOrders", "purchase_order", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "purchaseOrders.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "purchaseOrders.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "purchaseOrders.documentId")),
    supplier_id: entityUuid(requiredString(entity.supplierId, "purchaseOrders.supplierId")),
    destination_warehouse_id: entityUuid(requiredString(entity.destinationWarehouseId, "purchaseOrders.destinationWarehouseId")),
    supplier_currency: requiredString(entity.supplierCurrency, "purchaseOrders.supplierCurrency"),
    status: requiredString(entity.status, "purchaseOrders.status"),
    ordered_at: requiredString(entity.orderedAt, "purchaseOrders.orderedAt"),
    total_supplier_amount: requiredNumber(entity.totalSupplierAmount, "purchaseOrders.totalSupplierAmount"),
    total_qty: requiredNumber(entity.totalQty, "purchaseOrders.totalQty"),
    expected_dispatch_date: optionalString(entity.expectedDispatchDate),
    tracking_ref: optionalString(entity.trackingRef),
    expected_arrival_date: optionalString(entity.expectedArrivalDate),
    comment: optionalString(entity.comment)
  }), "purchase_order.ordered_at, purchase_order.id", {
    select: PURCHASE_ORDER_SELECT,
    joins: PURCHASE_ORDER_JOINS,
    hydrate: (row) => purchaseOrderFromRow(row as unknown as PurchaseOrderDbRow) as unknown as RuntimeEntity
  }),
  spec("purchaseOrderLines", "purchase_order_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "purchaseOrderLines.id")),
    purchase_order_id: entityUuid(requiredString(entity.purchaseOrderId, "purchaseOrderLines.purchaseOrderId")),
    product_id: entityUuid(requiredString(entity.productId, "purchaseOrderLines.productId")),
    line_no: requiredNumber(entity.lineNo, "purchaseOrderLines.lineNo"),
    qty_ordered: requiredNumber(entity.qtyOrdered, "purchaseOrderLines.qtyOrdered"),
    supplier_unit_price: requiredNumber(entity.supplierUnitPrice, "purchaseOrderLines.supplierUnitPrice"),
    supplier_amount: requiredNumber(entity.supplierAmount, "purchaseOrderLines.supplierAmount"),
    line_note: optionalString(entity.lineNote)
  }), "purchase_order_line.purchase_order_id, purchase_order_line.line_no", {
    select: PURCHASE_ORDER_LINE_SELECT,
    joins: PURCHASE_ORDER_LINE_JOINS,
    hydrate: (row) => purchaseOrderLineFromRow(row as unknown as PurchaseOrderLineDbRow) as unknown as RuntimeEntity
  }),
  spec("cashAccounts", "cash_account", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "cashAccounts.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "cashAccounts.organizationId")),
    name: requiredString(entity.name, "cashAccounts.name"),
    account_code: requiredString(entity.accountCode, "cashAccounts.accountCode"),
    balance_rub: requiredNumber(entity.balanceRub, "cashAccounts.balanceRub"),
    is_active: requiredBoolean(entity.isActive, "cashAccounts.isActive")
  }), "cash_account.name, cash_account.id", {
    select: CASH_ACCOUNT_SELECT,
    joins: CASH_ACCOUNT_JOINS,
    hydrate: (row) => cashAccountFromRow(row as unknown as CashAccountDbRow) as unknown as RuntimeEntity
  }),
  spec("payments", "payment", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "payments.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "payments.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "payments.documentId")),
    cash_account_id: entityUuid(requiredString(entity.cashAccountId, "payments.cashAccountId")),
    payment_direction: requiredString(entity.paymentDirection, "payments.paymentDirection"),
    payment_type: requiredString(entity.paymentType, "payments.paymentType"),
    counterparty_id: optionalUuid(entity.counterpartyId),
    paid_at: requiredString(entity.paidAt, "payments.paidAt"),
    amount_rub: requiredNumber(entity.amountRub, "payments.amountRub"),
    comment: optionalString(entity.comment)
  }), "payment.paid_at, payment.id", {
    select: PAYMENT_SELECT,
    joins: PAYMENT_JOINS,
    hydrate: (row) => paymentFromRow(row as unknown as PaymentDbRow) as unknown as RuntimeEntity
  }),
  spec("paymentAllocations", "payment_allocation", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "paymentAllocations.id")),
    payment_id: entityUuid(requiredString(entity.paymentId, "paymentAllocations.paymentId")),
    allocation_purpose: requiredString(entity.allocationPurpose, "paymentAllocations.allocationPurpose"),
    purchase_order_id: optionalUuid(entity.purchaseOrderId),
    document_id: optionalUuid(entity.documentId),
    amount_rub: requiredNumber(entity.amountRub, "paymentAllocations.amountRub")
  }), "payment_allocation.payment_id, payment_allocation.id", {
    select: PAYMENT_ALLOCATION_SELECT,
    joins: PAYMENT_ALLOCATION_JOINS,
    hydrate: (row) => paymentAllocationFromRow(row as unknown as PaymentAllocationDbRow) as unknown as RuntimeEntity
  }),
  spec("settlementEntries", "settlement_entry", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "settlementEntries.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "settlementEntries.organizationId")),
    counterparty_id: optionalUuid(entity.counterpartyId),
    channel_id: optionalUuid(entity.channelId),
    document_id: entityUuid(requiredString(entity.documentId, "settlementEntries.documentId")),
    settlement_type: requiredString(entity.settlementType, "settlementEntries.settlementType"),
    debit_rub: requiredNumber(entity.debitRub, "settlementEntries.debitRub"),
    credit_rub: requiredNumber(entity.creditRub, "settlementEntries.creditRub"),
    created_at: requiredString(entity.createdAt, "settlementEntries.createdAt")
  }), "settlement_entry.created_at, settlement_entry.id", {
    select: SETTLEMENT_ENTRY_SELECT,
    joins: SETTLEMENT_ENTRY_JOINS,
    hydrate: (row) => settlementEntryFromRow(row as unknown as SettlementEntryDbRow) as unknown as RuntimeEntity
  }),
  spec("goodsReceipts", "goods_receipt", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "goodsReceipts.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "goodsReceipts.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "goodsReceipts.documentId")),
    purchase_order_id: entityUuid(requiredString(entity.purchaseOrderId, "goodsReceipts.purchaseOrderId")),
    warehouse_id: entityUuid(requiredString(entity.warehouseId, "goodsReceipts.warehouseId")),
    receipt_date: requiredString(entity.receiptDate, "goodsReceipts.receiptDate"),
    status: requiredString(entity.status, "goodsReceipts.status"),
    goods_cost_rub_total: requiredNumber(entity.goodsCostRubTotal, "goodsReceipts.goodsCostRubTotal"),
    goods_cost_source: requiredString(entity.goodsCostSource, "goodsReceipts.goodsCostSource"),
    suggested_goods_cost_rub: requiredNumber(entity.suggestedGoodsCostRub, "goodsReceipts.suggestedGoodsCostRub"),
    manual_cost_reason: optionalString(entity.manualCostReason)
  }), "goods_receipt.receipt_date, goods_receipt.id", {
    select: GOODS_RECEIPT_SELECT,
    joins: GOODS_RECEIPT_JOINS,
    hydrate: (row) => goodsReceiptFromRow(row as unknown as GoodsReceiptDbRow) as unknown as RuntimeEntity
  }),
  spec("goodsReceiptLines", "goods_receipt_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "goodsReceiptLines.id")),
    goods_receipt_id: entityUuid(requiredString(entity.goodsReceiptId, "goodsReceiptLines.goodsReceiptId")),
    purchase_order_line_id: entityUuid(requiredString(entity.purchaseOrderLineId, "goodsReceiptLines.purchaseOrderLineId")),
    product_id: entityUuid(requiredString(entity.productId, "goodsReceiptLines.productId")),
    qty_received: requiredNumber(entity.qtyReceived, "goodsReceiptLines.qtyReceived"),
    supplier_amount_basis: requiredNumber(entity.supplierAmountBasis, "goodsReceiptLines.supplierAmountBasis"),
    allocated_goods_cost_rub: requiredNumber(entity.allocatedGoodsCostRub, "goodsReceiptLines.allocatedGoodsCostRub"),
    unit_cost_rub: requiredNumber(entity.unitCostRub, "goodsReceiptLines.unitCostRub")
  }), "goods_receipt_line.goods_receipt_id, goods_receipt_line.id", {
    select: GOODS_RECEIPT_LINE_SELECT,
    joins: GOODS_RECEIPT_LINE_JOINS,
    hydrate: (row) => goodsReceiptLineFromRow(row as unknown as GoodsReceiptLineDbRow) as unknown as RuntimeEntity
  }),
  spec("procurementCosts", "procurement_cost", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "procurementCosts.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "procurementCosts.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "procurementCosts.documentId")),
    purchase_order_id: optionalUuid(entity.purchaseOrderId),
    cost_type: requiredString(entity.costType, "procurementCosts.costType"),
    allocation_basis: requiredString(entity.allocationBasis, "procurementCosts.allocationBasis"),
    status: requiredString(entity.status, "procurementCosts.status"),
    cost_date: requiredString(entity.costDate, "procurementCosts.costDate"),
    amount_rub: requiredNumber(entity.amountRub, "procurementCosts.amountRub"),
    paid_immediately: requiredBoolean(entity.paidImmediately, "procurementCosts.paidImmediately"),
    comment: optionalString(entity.comment),
    pending_allocation: typeof entity.pendingAllocation === "boolean" ? entity.pendingAllocation : null
  }), "procurement_cost.cost_date, procurement_cost.id", {
    select: PROCUREMENT_COST_SELECT,
    joins: PROCUREMENT_COST_JOINS,
    hydrate: (row) => procurementCostFromRow(row as unknown as ProcurementCostDbRow) as unknown as RuntimeEntity
  }),
  spec("procurementCostLines", "procurement_cost_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "procurementCostLines.id")),
    procurement_cost_id: entityUuid(requiredString(entity.procurementCostId, "procurementCostLines.procurementCostId")),
    product_id: entityUuid(requiredString(entity.productId, "procurementCostLines.productId")),
    lot_id: optionalUuid(entity.lotId),
    warehouse_id: optionalUuid(entity.warehouseId),
    basis_value: optionalNumber(entity.basisValue),
    qty_initial: optionalNumber(entity.qtyInitial),
    qty_remaining: optionalNumber(entity.qtyRemaining),
    qty_sold: optionalNumber(entity.qtySold),
    allocated_amount_rub: requiredNumber(entity.allocatedAmountRub, "procurementCostLines.allocatedAmountRub"),
    remaining_inventory_amount_rub: requiredNumber(entity.remainingInventoryAmountRub, "procurementCostLines.remainingInventoryAmountRub"),
    sold_cost_amount_rub: requiredNumber(entity.soldCostAmountRub, "procurementCostLines.soldCostAmountRub")
  }), "procurement_cost_line.procurement_cost_id, procurement_cost_line.id", {
    select: PROCUREMENT_COST_LINE_SELECT,
    joins: PROCUREMENT_COST_LINE_JOINS,
    hydrate: (row) => procurementCostLineFromRow(row as unknown as ProcurementCostLineDbRow) as unknown as RuntimeEntity
  }),
  spec("shortageResolutions", "shortage_resolution", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "shortageResolutions.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "shortageResolutions.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "shortageResolutions.documentId")),
    purchase_order_id: entityUuid(requiredString(entity.purchaseOrderId, "shortageResolutions.purchaseOrderId")),
    status: requiredString(entity.status, "shortageResolutions.status"),
    reason: requiredString(entity.reason, "shortageResolutions.reason"),
    resolved_at: requiredString(entity.resolvedAt, "shortageResolutions.resolvedAt")
  }), "shortage_resolution.resolved_at, shortage_resolution.id", {
    select: SHORTAGE_RESOLUTION_SELECT,
    joins: SHORTAGE_RESOLUTION_JOINS,
    hydrate: (row) => shortageResolutionFromRow(row as unknown as ShortageResolutionDbRow) as unknown as RuntimeEntity
  }),
  spec("shortageResolutionLines", "shortage_resolution_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "shortageResolutionLines.id")),
    shortage_resolution_id: entityUuid(requiredString(entity.shortageResolutionId, "shortageResolutionLines.shortageResolutionId")),
    purchase_order_line_id: entityUuid(requiredString(entity.purchaseOrderLineId, "shortageResolutionLines.purchaseOrderLineId")),
    product_id: entityUuid(requiredString(entity.productId, "shortageResolutionLines.productId")),
    qty_shortage: requiredNumber(entity.qtyShortage, "shortageResolutionLines.qtyShortage"),
    paid_share_rub: requiredNumber(entity.paidShareRub, "shortageResolutionLines.paidShareRub"),
    action: requiredString(entity.action, "shortageResolutionLines.action")
  }), "shortage_resolution_line.shortage_resolution_id, shortage_resolution_line.id", {
    select: SHORTAGE_RESOLUTION_LINE_SELECT,
    joins: SHORTAGE_RESOLUTION_LINE_JOINS,
    hydrate: (row) => shortageResolutionLineFromRow(row as unknown as ShortageResolutionLineDbRow) as unknown as RuntimeEntity
  }),
  spec("supplierClaims", "supplier_claim", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "supplierClaims.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "supplierClaims.organizationId")),
    shortage_resolution_line_id: entityUuid(requiredString(entity.shortageResolutionLineId, "supplierClaims.shortageResolutionLineId")),
    supplier_id: entityUuid(requiredString(entity.supplierId, "supplierClaims.supplierId")),
    amount_rub: requiredNumber(entity.amountRub, "supplierClaims.amountRub"),
    status: requiredString(entity.status, "supplierClaims.status")
  }), "supplier_claim.id", {
    select: SUPPLIER_CLAIM_SELECT,
    joins: SUPPLIER_CLAIM_JOINS,
    hydrate: (row) => supplierClaimFromRow(row as unknown as SupplierClaimDbRow) as unknown as RuntimeEntity
  }),
  spec("stockTransfers", "stock_transfer", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "stockTransfers.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "stockTransfers.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "stockTransfers.documentId")),
    from_warehouse_id: entityUuid(requiredString(entity.fromWarehouseId, "stockTransfers.fromWarehouseId")),
    to_warehouse_id: entityUuid(requiredString(entity.toWarehouseId, "stockTransfers.toWarehouseId")),
    from_stock_state_code: optionalString(entity.fromStockStateCode),
    to_stock_state_code: optionalString(entity.toStockStateCode),
    transfer_type: optionalString(entity.transferType),
    channel_id: optionalUuid(entity.channelId),
    source_goods_receipt_id: optionalUuid(entity.sourceGoodsReceiptId),
    source_document_id: optionalUuid(entity.sourceDocumentId),
    provider_metadata: entity.providerMetadata ?? null,
    status: requiredString(entity.status, "stockTransfers.status"),
    transfer_date: requiredString(entity.transferDate, "stockTransfers.transferDate"),
    comment: optionalString(entity.comment)
  }), "stock_transfer.transfer_date, stock_transfer.id", {
    select: STOCK_TRANSFER_SELECT,
    joins: STOCK_TRANSFER_JOINS,
    hydrate: (row) => stockTransferFromRow(row as unknown as StockTransferDbRow) as unknown as RuntimeEntity
  }),
  spec("stockTransferLines", "stock_transfer_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "stockTransferLines.id")),
    stock_transfer_id: entityUuid(requiredString(entity.stockTransferId, "stockTransferLines.stockTransferId")),
    product_id: entityUuid(requiredString(entity.productId, "stockTransferLines.productId")),
    qty: requiredNumber(entity.qty, "stockTransferLines.qty"),
    cost_rub: requiredNumber(entity.costRub, "stockTransferLines.costRub"),
    source_goods_receipt_line_id: optionalUuid(entity.sourceGoodsReceiptLineId),
    source_purchase_order_line_id: optionalUuid(entity.sourcePurchaseOrderLineId),
    provider_metadata: entity.providerMetadata ?? null
  }), "stock_transfer_line.stock_transfer_id, stock_transfer_line.id", {
    select: STOCK_TRANSFER_LINE_SELECT,
    joins: STOCK_TRANSFER_LINE_JOINS,
    hydrate: (row) => stockTransferLineFromRow(row as unknown as StockTransferLineDbRow) as unknown as RuntimeEntity
  }),
  spec("pluginStateRecords", "plugin_state_record", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "pluginStateRecords.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "pluginStateRecords.organizationId")),
    plugin_code: requiredString(entity.pluginCode, "pluginStateRecords.pluginCode"),
    namespace: requiredString(entity.namespace, "pluginStateRecords.namespace"),
    visibility: requiredString(entity.visibility, "pluginStateRecords.visibility"),
    scope_type: requiredString(entity.scopeType, "pluginStateRecords.scopeType"),
    scope_id: requiredString(entity.scopeId, "pluginStateRecords.scopeId"),
    state_key: requiredString(entity.stateKey, "pluginStateRecords.stateKey"),
    revision: requiredNumber(entity.revision, "pluginStateRecords.revision"),
    payload_json: entity.payload ?? {},
    created_at: requiredString(entity.createdAt, "pluginStateRecords.createdAt"),
    updated_at: requiredString(entity.updatedAt, "pluginStateRecords.updatedAt")
  }), "plugin_state_record.plugin_code, plugin_state_record.namespace, plugin_state_record.scope_type, plugin_state_record.scope_id, plugin_state_record.state_key", {
    select: PLUGIN_STATE_RECORD_SELECT,
    joins: PLUGIN_STATE_RECORD_JOINS,
    hydrate: (row) => pluginStateRecordFromRow(row as unknown as PluginStateRecordDbRow) as unknown as RuntimeEntity
  }),
  spec("integrationPlugins", "integration_plugin", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "integrationPlugins.id")),
    code: requiredString(entity.code, "integrationPlugins.code"),
    display_name: requiredString(entity.displayName, "integrationPlugins.displayName"),
    status: requiredString(entity.status, "integrationPlugins.status")
  }), "integration_plugin.code", {
    select: INTEGRATION_PLUGIN_SELECT,
    hydrate: (row) => integrationPluginFromRow(row as unknown as IntegrationPluginDbRow) as unknown as RuntimeEntity
  }),
  spec("salesChannels", "sales_channel", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "salesChannels.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "salesChannels.organizationId")),
    name: requiredString(entity.name, "salesChannels.name"),
    channel_type: requiredString(entity.channelType, "salesChannels.channelType"),
    plugin_id: optionalUuid(entity.pluginId),
    sales_point_warehouse_id: entityUuid(requiredString(entity.salesPointWarehouseId, "salesChannels.salesPointWarehouseId")),
    clearing_account_code: requiredString(entity.clearingAccountCode, "salesChannels.clearingAccountCode"),
    status: requiredString(entity.status, "salesChannels.status"),
    enabled_streams: Array.isArray(entity.enabledStreams) ? entity.enabledStreams : null,
    last_checked_at: optionalString(entity.lastCheckedAt),
    last_error: optionalString(entity.lastError),
    last_sync_at: optionalString(entity.lastSyncAt)
  }), "sales_channel.name, sales_channel.id", {
    select: SALES_CHANNEL_SELECT,
    joins: SALES_CHANNEL_JOINS,
    hydrate: (row) => salesChannelFromRow(row as unknown as SalesChannelDbRow) as unknown as RuntimeEntity
  }),
  spec("externalProducts", "external_product", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "externalProducts.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "externalProducts.organizationId")),
    channel_id: entityUuid(requiredString(entity.channelId, "externalProducts.channelId")),
    external_sku: requiredString(entity.externalSku, "externalProducts.externalSku"),
    external_name: requiredString(entity.externalName, "externalProducts.externalName"),
    image_url: optionalString(entity.imageUrl),
    status: requiredString(entity.status, "externalProducts.status")
  }), "external_product.external_sku, external_product.id", {
    select: EXTERNAL_PRODUCT_SELECT,
    joins: EXTERNAL_PRODUCT_JOINS,
    hydrate: (row) => externalProductFromRow(row as unknown as ExternalProductDbRow) as unknown as RuntimeEntity
  }),
  spec("productExternalLinks", "product_external_link", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "productExternalLinks.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "productExternalLinks.organizationId")),
    product_id: entityUuid(requiredString(entity.productId, "productExternalLinks.productId")),
    external_product_id: entityUuid(requiredString(entity.externalProductId, "productExternalLinks.externalProductId")),
    channel_id: entityUuid(requiredString(entity.channelId, "productExternalLinks.channelId")),
    status: requiredString(entity.status, "productExternalLinks.status")
  }), "product_external_link.id", {
    select: PRODUCT_EXTERNAL_LINK_SELECT,
    joins: PRODUCT_EXTERNAL_LINK_JOINS,
    hydrate: (row) => productExternalLinkFromRow(row as unknown as ProductExternalLinkDbRow) as unknown as RuntimeEntity
  }),
  spec("syncRuns", "sync_run", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "syncRuns.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "syncRuns.organizationId")),
    channel_id: entityUuid(requiredString(entity.channelId, "syncRuns.channelId")),
    status: requiredString(entity.status, "syncRuns.status"),
    started_at: requiredString(entity.startedAt, "syncRuns.startedAt"),
    finished_at: optionalString(entity.finishedAt),
    stats: entity.stats ?? {},
    mode: optionalString(entity.mode),
    streams: Array.isArray(entity.streams) ? entity.streams : null,
    errors: Array.isArray(entity.errors) ? entity.errors : null,
    since: optionalString(entity.since),
    summary: entity.summary ? JSON.stringify(entity.summary) : null,
    stream_runs: entity.streamRuns ? JSON.stringify(entity.streamRuns) : null,
    last_error: optionalString(entity.lastError)
  }), "sync_run.started_at, sync_run.id", {
    select: SYNC_RUN_SELECT,
    joins: SYNC_RUN_JOINS,
    hydrate: (row) => syncRunFromRow(row as unknown as SyncRunDbRow) as unknown as RuntimeEntity
  }),
  spec("externalEvents", "external_event", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "externalEvents.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "externalEvents.organizationId")),
    channel_id: entityUuid(requiredString(entity.channelId, "externalEvents.channelId")),
    sync_run_id: optionalUuid(entity.syncRunId),
    event_type: requiredString(entity.eventType, "externalEvents.eventType"),
    external_id: requiredString(entity.externalId, "externalEvents.externalId"),
    idempotency_key: requiredString(entity.idempotencyKey ?? entity.externalId, "externalEvents.idempotencyKey"),
    occurred_at: requiredString(entity.occurredAt, "externalEvents.occurredAt"),
    raw_payload: entity.rawPayload ?? {},
    normalized_payload: entity.normalizedPayload ?? {},
    status: requiredString(entity.status, "externalEvents.status"),
    materialized_document_id: optionalUuid(entity.materializedDocumentId),
    external_product_id: optionalUuid(entity.externalProductId),
    product_id: optionalUuid(entity.productId),
    reason: optionalString(entity.reason),
    last_error: optionalString(entity.lastError),
    created_at: requiredString(entity.createdAt, "externalEvents.createdAt"),
    updated_at: requiredString(entity.updatedAt, "externalEvents.updatedAt")
  }), "external_event.occurred_at, external_event.id", {
    select: EXTERNAL_EVENT_SELECT,
    joins: EXTERNAL_EVENT_JOINS,
    hydrate: (row) => externalEventFromRow(row as unknown as ExternalEventDbRow) as unknown as RuntimeEntity
  }),
  spec("observedStocks", "observed_stock", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "observedStocks.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "observedStocks.organizationId")),
    channel_id: entityUuid(requiredString(entity.channelId, "observedStocks.channelId")),
    external_product_id: entityUuid(requiredString(entity.externalProductId, "observedStocks.externalProductId")),
    product_id: optionalUuid(entity.productId),
    warehouse_id: optionalUuid(entity.warehouseId),
    observed_at: requiredString(entity.observedAt, "observedStocks.observedAt"),
    qty_observed: requiredNumber(entity.qtyObserved, "observedStocks.qtyObserved"),
    location_status: requiredString(entity.locationStatus, "observedStocks.locationStatus")
  }), "observed_stock.observed_at, observed_stock.id", {
    select: OBSERVED_STOCK_SELECT,
    joins: OBSERVED_STOCK_JOINS,
    hydrate: (row) => observedStockFromRow(row as unknown as ObservedStockDbRow) as unknown as RuntimeEntity
  }),
  spec("sales", "sale", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "sales.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "sales.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "sales.documentId")),
    financial_document_id: optionalUuid(entity.financialDocumentId),
    channel_id: entityUuid(requiredString(entity.channelId, "sales.channelId")),
    sale_date: requiredString(entity.saleDate, "sales.saleDate"),
    external_event_id: optionalUuid(entity.externalEventId),
    warehouse_id: entityUuid(requiredString(entity.warehouseId, "sales.warehouseId")),
    external_order_id: optionalString(entity.externalOrderId),
    gross_amount_rub: requiredNumber(entity.grossAmountRub, "sales.grossAmountRub"),
    recognized_gross_amount_rub: optionalNumber(entity.recognizedGrossAmountRub),
    financial_recognition_date: optionalString(entity.financialRecognitionDate),
    cost_amount_rub: requiredNumber(entity.costAmountRub, "sales.costAmountRub"),
    gross_profit_rub: requiredNumber(entity.grossProfitRub, "sales.grossProfitRub"),
    status: requiredString(entity.status, "sales.status")
  }), "sale.sale_date, sale.id", {
    select: SALE_SELECT,
    joins: SALE_JOINS,
    hydrate: (row) => saleFromRow(row as unknown as SaleDbRow) as unknown as RuntimeEntity
  }),
  spec("saleLines", "sale_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "saleLines.id")),
    sale_id: entityUuid(requiredString(entity.saleId, "saleLines.saleId")),
    product_id: entityUuid(requiredString(entity.productId, "saleLines.productId")),
    external_product_id: optionalUuid(entity.externalProductId),
    qty: requiredNumber(entity.qty, "saleLines.qty"),
    price_rub: requiredNumber(entity.priceRub, "saleLines.priceRub"),
    revenue_rub: requiredNumber(entity.revenueRub, "saleLines.revenueRub"),
    cost_rub: requiredNumber(entity.costRub, "saleLines.costRub"),
    gross_profit_rub: requiredNumber(entity.grossProfitRub, "saleLines.grossProfitRub")
  }), "sale_line.sale_id, sale_line.id", {
    select: SALE_LINE_SELECT,
    joins: SALE_LINE_JOINS,
    hydrate: (row) => saleLineFromRow(row as unknown as SaleLineDbRow) as unknown as RuntimeEntity
  }),
  spec("salesReturns", "sales_return", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "salesReturns.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "salesReturns.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "salesReturns.documentId")),
    sale_id: entityUuid(requiredString(entity.saleId, "salesReturns.saleId")),
    channel_id: entityUuid(requiredString(entity.channelId, "salesReturns.channelId")),
    external_event_id: optionalUuid(entity.externalEventId),
    return_date: requiredString(entity.returnDate, "salesReturns.returnDate"),
    warehouse_id: entityUuid(requiredString(entity.warehouseId, "salesReturns.warehouseId")),
    stock_state_code: optionalString(entity.stockStateCode),
    status: requiredString(entity.status, "salesReturns.status"),
    refund_rub: requiredNumber(entity.refundRub, "salesReturns.refundRub"),
    restored_cost_rub: requiredNumber(entity.restoredCostRub, "salesReturns.restoredCostRub"),
    comment: optionalString(entity.comment)
  }), "sales_return.return_date, sales_return.id", {
    select: SALES_RETURN_SELECT,
    joins: SALES_RETURN_JOINS,
    hydrate: (row) => salesReturnFromRow(row as unknown as SalesReturnDbRow) as unknown as RuntimeEntity
  }),
  spec("payouts", "payout", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "payouts.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "payouts.organizationId")),
    channel_id: entityUuid(requiredString(entity.channelId, "payouts.channelId")),
    document_id: entityUuid(requiredString(entity.documentId, "payouts.documentId")),
    composition_mode: requiredString(entity.compositionMode, "payouts.compositionMode"),
    external_event_id: optionalUuid(entity.externalEventId),
    external_payout_id: optionalString(entity.externalPayoutId),
    payment_id: optionalUuid(entity.paymentId),
    payout_date: requiredString(entity.payoutDate, "payouts.payoutDate"),
    period_from: optionalString(entity.periodFrom),
    period_to: optionalString(entity.periodTo),
    expected_amount_rub: requiredNumber(entity.expectedAmountRub, "payouts.expectedAmountRub"),
    gross_events_rub: requiredNumber(entity.grossEventsRub, "payouts.grossEventsRub"),
    bank_receipt_rub: requiredNumber(entity.bankReceiptRub, "payouts.bankReceiptRub"),
    difference_rub: requiredNumber(entity.differenceRub, "payouts.differenceRub"),
    cash_account_id: optionalUuid(entity.cashAccountId),
    difference_reason: optionalString(entity.differenceReason),
    difference_accepted: typeof entity.differenceAccepted === "boolean" ? entity.differenceAccepted : null,
    status: requiredString(entity.status, "payouts.status")
  }), "payout.payout_date, payout.id", {
    select: PAYOUT_SELECT,
    joins: PAYOUT_JOINS,
    hydrate: (row) => payoutFromRow(row as unknown as PayoutDbRow) as unknown as RuntimeEntity
  }),
  spec("channelFinanceEvents", "channel_finance_event", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "channelFinanceEvents.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "channelFinanceEvents.organizationId")),
    channel_id: entityUuid(requiredString(entity.channelId, "channelFinanceEvents.channelId")),
    external_event_id: optionalUuid(entity.externalEventId),
    document_id: entityUuid(requiredString(entity.documentId, "channelFinanceEvents.documentId")),
    payout_id: optionalUuid(entity.payoutId),
    external_id: optionalString(entity.externalId),
    event_kind: requiredString(entity.eventKind, "channelFinanceEvents.eventKind"),
    treatment: optionalString(entity.treatment),
    category: optionalString(entity.category),
    operation_type: optionalString(entity.operationType),
    operation_type_name: optionalString(entity.operationTypeName),
    linked_sale_id: optionalUuid(entity.linkedSaleId),
    sale_allocations: entity.saleAllocations ? JSON.stringify(entity.saleAllocations) : null,
    linked_return_id: optionalUuid(entity.linkedReturnId),
    amount_rub: requiredNumber(entity.amountRub, "channelFinanceEvents.amountRub"),
    occurred_at: requiredString(entity.occurredAt, "channelFinanceEvents.occurredAt"),
    status: requiredString(entity.status, "channelFinanceEvents.status"),
    comment: optionalString(entity.comment)
  }), "channel_finance_event.occurred_at, channel_finance_event.id", {
    select: CHANNEL_FINANCE_EVENT_SELECT,
    joins: CHANNEL_FINANCE_EVENT_JOINS,
    hydrate: (row) => channelFinanceEventFromRow(row as unknown as ChannelFinanceEventDbRow) as unknown as RuntimeEntity
  }),
  spec("payoutLines", "payout_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "payoutLines.id")),
    payout_id: entityUuid(requiredString(entity.payoutId, "payoutLines.payoutId")),
    source_type: optionalString(entity.sourceType),
    source_id: optionalString(entity.sourceId),
    line_group: optionalString(entity.lineGroup),
    channel_finance_event_id: optionalUuid(entity.channelFinanceEventId),
    sale_id: optionalUuid(entity.saleId),
    amount_rub: requiredNumber(entity.amountRub, "payoutLines.amountRub")
  }), "payout_line.payout_id, payout_line.id", {
    select: PAYOUT_LINE_SELECT,
    joins: PAYOUT_LINE_JOINS,
    hydrate: (row) => payoutLineFromRow(row as unknown as PayoutLineDbRow) as unknown as RuntimeEntity
  }),
  spec("expenseCategories", "expense_category", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "expenseCategories.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "expenseCategories.organizationId")),
    name: requiredString(entity.name, "expenseCategories.name"),
    account_code: requiredString(entity.accountCode, "expenseCategories.accountCode")
  }), "expense_category.name, expense_category.id", {
    select: EXPENSE_CATEGORY_SELECT,
    joins: EXPENSE_CATEGORY_JOINS,
    hydrate: (row) => expenseCategoryFromRow(row as unknown as ExpenseCategoryDbRow) as unknown as RuntimeEntity
  }),
  spec("operatingExpenses", "operating_expense", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "operatingExpenses.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "operatingExpenses.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "operatingExpenses.documentId")),
    category_id: entityUuid(requiredString(entity.categoryId, "operatingExpenses.categoryId")),
    payment_id: entityUuid(requiredString(entity.paymentId, "operatingExpenses.paymentId")),
    counterparty_id: optionalUuid(entity.counterpartyId),
    expense_date: requiredString(entity.expenseDate, "operatingExpenses.expenseDate"),
    amount_rub: requiredNumber(entity.amountRub, "operatingExpenses.amountRub"),
    amount_paid_rub: requiredNumber(entity.amountPaidRub, "operatingExpenses.amountPaidRub"),
    payment_mode: requiredString(entity.paymentMode, "operatingExpenses.paymentMode"),
    payment_status: requiredString(entity.paymentStatus, "operatingExpenses.paymentStatus"),
    cash_account_id: optionalUuid(entity.cashAccountId),
    comment: optionalString(entity.comment)
  }), "operating_expense.expense_date, operating_expense.id", {
    select: OPERATING_EXPENSE_SELECT,
    joins: OPERATING_EXPENSE_JOINS,
    hydrate: (row) => operatingExpenseFromRow(row as unknown as OperatingExpenseDbRow) as unknown as RuntimeEntity
  }),
  spec("ownerTransactions", "owner_transaction", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "ownerTransactions.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "ownerTransactions.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "ownerTransactions.documentId")),
    payment_id: entityUuid(requiredString(entity.paymentId, "ownerTransactions.paymentId")),
    transaction_type: requiredString(entity.transactionType, "ownerTransactions.transactionType"),
    amount_rub: requiredNumber(entity.amountRub, "ownerTransactions.amountRub")
  }), "owner_transaction.id", {
    select: OWNER_TRANSACTION_SELECT,
    joins: OWNER_TRANSACTION_JOINS,
    hydrate: (row) => ownerTransactionFromRow(row as unknown as OwnerTransactionDbRow) as unknown as RuntimeEntity
  }),
  spec("stocktakes", "stocktake", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "stocktakes.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "stocktakes.organizationId")),
    warehouse_id: entityUuid(requiredString(entity.warehouseId, "stocktakes.warehouseId")),
    document_id: entityUuid(requiredString(entity.documentId, "stocktakes.documentId")),
    stocktake_date: requiredString(entity.stocktakeDate, "stocktakes.stocktakeDate"),
    status: requiredString(entity.status, "stocktakes.status")
  }), "stocktake.stocktake_date, stocktake.id", {
    select: STOCKTAKE_SELECT,
    joins: STOCKTAKE_JOINS,
    hydrate: (row) => stocktakeFromRow(row as unknown as StocktakeDbRow) as unknown as RuntimeEntity
  }),
  spec("stocktakeLines", "stocktake_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "stocktakeLines.id")),
    stocktake_id: entityUuid(requiredString(entity.stocktakeId, "stocktakeLines.stocktakeId")),
    product_id: entityUuid(requiredString(entity.productId, "stocktakeLines.productId")),
    book_qty: requiredNumber(entity.bookQty, "stocktakeLines.bookQty"),
    observed_qty: requiredNumber(entity.observedQty, "stocktakeLines.observedQty"),
    difference_qty: requiredNumber(entity.differenceQty, "stocktakeLines.differenceQty"),
    book_cost_rub: requiredNumber(entity.bookCostRub, "stocktakeLines.bookCostRub"),
    adjustment_cost_rub: requiredNumber(entity.adjustmentCostRub, "stocktakeLines.adjustmentCostRub")
  }), "stocktake_line.stocktake_id, stocktake_line.id", {
    select: STOCKTAKE_LINE_SELECT,
    joins: STOCKTAKE_LINE_JOINS,
    hydrate: (row) => stocktakeLineFromRow(row as unknown as StocktakeLineDbRow) as unknown as RuntimeEntity
  }),
  spec("correctionCases", "correction_case", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "correctionCases.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "correctionCases.organizationId")),
    source_document_id: entityUuid(requiredString(entity.sourceDocumentId, "correctionCases.sourceDocumentId")),
    correction_type: requiredString(entity.correctionType, "correctionCases.correctionType"),
    reason: requiredString(entity.reason, "correctionCases.reason"),
    status: requiredString(entity.status, "correctionCases.status"),
    impact_summary: entity.impactSummary ?? {},
    created_at: requiredString(entity.createdAt, "correctionCases.createdAt"),
    applied_at: optionalString(entity.appliedAt)
  }), "correction_case.created_at, correction_case.id", {
    select: CORRECTION_CASE_SELECT,
    joins: CORRECTION_CASE_JOINS,
    hydrate: (row) => correctionCaseFromRow(row as unknown as CorrectionCaseDbRow) as unknown as RuntimeEntity
  }),
  spec("recalculationJobs", "recalculation_job", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "recalculationJobs.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "recalculationJobs.organizationId")),
    job_type: requiredString(entity.jobType, "recalculationJobs.jobType"),
    scope: entity.scope ?? {},
    status: requiredString(entity.status, "recalculationJobs.status"),
    progress: requiredNumber(entity.progress, "recalculationJobs.progress"),
    started_at: null,
    finished_at: optionalString(entity.finishedAt),
    last_error: null,
    created_at: requiredString(entity.createdAt, "recalculationJobs.createdAt")
  }), "recalculation_job.created_at, recalculation_job.id", {
    select: RECALCULATION_JOB_SELECT,
    joins: RECALCULATION_JOB_JOINS,
    hydrate: (row) => recalculationJobFromRow(row as unknown as RecalculationJobDbRow) as unknown as RuntimeEntity
  }),
  spec("reportSnapshots", "report_snapshot", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "reportSnapshots.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "reportSnapshots.organizationId")),
    period_id: optionalUuid(entity.periodId),
    report_type: requiredString(entity.reportType, "reportSnapshots.reportType"),
    payload: entity.payload ?? {},
    created_at: requiredString(entity.createdAt, "reportSnapshots.createdAt")
  }), "report_snapshot.created_at, report_snapshot.id", {
    select: REPORT_SNAPSHOT_SELECT,
    joins: REPORT_SNAPSHOT_JOINS,
    hydrate: (row) => reportSnapshotFromRow(row as unknown as ReportSnapshotDbRow) as unknown as RuntimeEntity
  }),
  spec("backfillProjects", "backfill_project", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "backfillProjects.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "backfillProjects.organizationId")),
    name: requiredString(entity.name, "backfillProjects.name"),
    status: requiredString(entity.status, "backfillProjects.status"),
    payload: entity.payload ?? {},
    created_at: requiredString(entity.createdAt, "backfillProjects.createdAt")
  }), "backfill_project.created_at, backfill_project.id", {
    select: BACKFILL_PROJECT_SELECT,
    joins: BACKFILL_PROJECT_JOINS,
    hydrate: (row) => backfillProjectFromRow(row as unknown as BackfillProjectDbRow) as unknown as RuntimeEntity
  }),
  spec("backfillItems", "backfill_item", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "backfillItems.id")),
    backfill_project_id: entityUuid(requiredString(entity.backfillProjectId, "backfillItems.backfillProjectId")),
    item_type: requiredString(entity.itemType, "backfillItems.itemType"),
    payload: entity.payload ?? {},
    status: requiredString(entity.status, "backfillItems.status")
  }), "backfill_item.backfill_project_id, backfill_item.id", {
    select: BACKFILL_ITEM_SELECT,
    joins: BACKFILL_ITEM_JOINS,
    hydrate: (row) => backfillItemFromRow(row as unknown as BackfillItemDbRow) as unknown as RuntimeEntity
  }),
  spec("users", "user_account", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "users.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "users.organizationId")),
    email: requiredString(entity.email, "users.email"),
    name: requiredString(entity.name, "users.name"),
    role_code: requiredString(entity.roleCode, "users.roleCode"),
    status: requiredString(entity.status, "users.status"),
    invited_at: optionalString(entity.invitedAt),
    last_active_at: optionalString(entity.lastActiveAt)
  }), "user_account.email, user_account.id", {
    select: USER_ACCOUNT_SELECT,
    joins: USER_ACCOUNT_JOINS,
    hydrate: (row) => userAccountFromRow(row as unknown as UserAccountDbRow) as unknown as RuntimeEntity
  }),
  spec("roles", "role", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "roles.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "roles.organizationId")),
    code: requiredString(entity.code, "roles.code"),
    name: requiredString(entity.name, "roles.name")
  }), "role.code, role.id", {
    select: ROLE_SELECT,
    joins: ROLE_JOINS,
    hydrate: (row) => roleFromRow(row as unknown as RoleDbRow) as unknown as RuntimeEntity
  }),
  spec("agentTokens", "agent_token", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "agentTokens.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "agentTokens.organizationId")),
    name: requiredString(entity.name, "agentTokens.name"),
    mode: requiredString(entity.mode, "agentTokens.mode"),
    status: requiredString(entity.status, "agentTokens.status"),
    scopes: JSON.stringify(entity.scopes ?? []),
    masked_token: optionalString(entity.maskedToken),
    token_hash: optionalString(entity.tokenHash),
    created_at: requiredString(entity.createdAt, "agentTokens.createdAt"),
    last_used_at: optionalString(entity.lastUsedAt),
    revoked_at: optionalString(entity.revokedAt)
  }), "agent_token.name, agent_token.id", {
    select: AGENT_TOKEN_SELECT,
    joins: AGENT_TOKEN_JOINS,
    hydrate: (row) => agentTokenFromRow(row as unknown as AgentTokenDbRow) as unknown as RuntimeEntity
  }),
  spec("channelAgentPermissions", "channel_agent_permission", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "channelAgentPermissions.id")),
    agent_token_id: entityUuid(requiredString(entity.agentTokenId, "channelAgentPermissions.agentTokenId")),
    channel_id: entityUuid(requiredString(entity.channelId, "channelAgentPermissions.channelId")),
    permission_code: requiredString(entity.permissionCode, "channelAgentPermissions.permissionCode")
  }), "channel_agent_permission.id", {
    select: CHANNEL_AGENT_PERMISSION_SELECT,
    joins: CHANNEL_AGENT_PERMISSION_JOINS,
    hydrate: (row) => channelAgentPermissionFromRow(row as unknown as ChannelAgentPermissionDbRow) as unknown as RuntimeEntity
  })
];

export async function createAccountingRuntimeFromEnv(): Promise<AccountingRuntime> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "MPFlow работает только с PostgreSQL: задайте DATABASE_URL. Локально — `docker compose up -d`, затем скопируйте DATABASE_URL из .env.example."
    );
  }
  const persistenceMode = process.env.ACCOUNTING_PERSISTENCE ?? "postgres";
  if (persistenceMode !== "postgres") {
    throw new Error(`Неподдерживаемый ACCOUNTING_PERSISTENCE=${persistenceMode}: доступен только postgres.`);
  }

  const secret = process.env.ACCOUNTING_ENCRYPTION_KEY ?? (process.env.NODE_ENV === "production" ? undefined : "mpflow-local-dev-key");
  if (!secret) {
    throw new Error("Для хранения кредов каналов нужен ACCOUNTING_ENCRYPTION_KEY");
  }

  const store = new PostgresRuntimeStore(new Pool({ connectionString: process.env.DATABASE_URL }), secret);
  await store.init();
  return { app: new AccountingApp(), persistence: store };
}

export class PostgresRuntimeStore implements RuntimePersistence {
  private readonly encryptionKey: Buffer;
  private initPromise?: Promise<void>;

  constructor(private readonly pool: Pool, encryptionSecret: string) {
    this.encryptionKey = createHash("sha256").update(encryptionSecret).digest();
  }

  async init() {
    if (!this.initPromise) {
      this.initPromise = this.initialize().catch((error) => {
        this.initPromise = undefined;
        throw error;
      });
    }
    await this.initPromise;
  }

  async readDashboard(workspaceId = DEFAULT_WORKSPACE_ID): Promise<unknown> {
    await this.init();
    return await readRuntimeDashboard(this.pool, normalizeWorkspaceId(workspaceId));
  }

  async readReports(workspaceId = DEFAULT_WORKSPACE_ID): Promise<unknown> {
    await this.init();
    return await readRuntimeReports(this.pool, normalizeWorkspaceId(workspaceId));
  }

  async readReportWorkspace(workspaceId: string | undefined, options: ReportsWorkspaceOptions): Promise<unknown> {
    await this.init();
    return await readRuntimeReportWorkspace(this.pool, normalizeWorkspaceId(workspaceId), options);
  }

  async readProductWorkspace(workspaceId: string | undefined, productId: string): Promise<unknown> {
    await this.init();
    return await readRuntimeProductWorkspace(this.pool, normalizeWorkspaceId(workspaceId), productId);
  }

  async readLedgerBalances(workspaceId = DEFAULT_WORKSPACE_ID): Promise<RuntimeLedgerBalances> {
    await this.init();
    return await readRuntimeLedgerBalances(this.pool, normalizeWorkspaceId(workspaceId));
  }

  async authenticateAgentToken(
    workspaceId: string,
    tokenId: string,
    tokenHash: string,
    options: { touchAt?: string } = {}
  ): Promise<RuntimeAgentTokenPrincipal | null> {
    await this.init();
    const scope = normalizeWorkspaceId(workspaceId);
    if (!options.touchAt) {
      return await readRuntimeAgentTokenPrincipal(this.pool, scope, tokenId, tokenHash);
    }

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const principal = await readRuntimeAgentTokenPrincipal(client, scope, tokenId, tokenHash, "for update");
      if (principal) {
        await client.query(
          `
            update agent_token
            set last_used_at = $4::timestamptz
            where workspace_id = $1
              and public_id = $2
              and token_hash = $3
              and status = 'active'
          `,
          [scope, tokenId, tokenHash, options.touchAt]
        );
      }
      await client.query("commit");
      return principal;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async openReadContext(workspaceId = DEFAULT_WORKSPACE_ID): Promise<RuntimeReadContext> {
    await this.init();
    return await openPostgresReadContext(this.pool, normalizeWorkspaceId(workspaceId));
  }

  async runWriteContext<T>(
    workspaceId: string | undefined = DEFAULT_WORKSPACE_ID,
    handler: (context: RuntimeWriteContext) => Promise<T>
  ): Promise<T> {
    await this.init();
    const scope = normalizeWorkspaceId(workspaceId);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const meta = await this.loadMetaForUpdate(client);
      return await runWithIdSequence(meta?.next_id ?? 1, async () => {
        const context = await openPostgresWriteContext(client, scope);
        const result = await handler(context);
        await this.saveMeta(client, currentIdSequence());
        await client.query("commit");
        return result;
      });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async openReadSession(workspaceId = DEFAULT_WORKSPACE_ID): Promise<RuntimeSession> {
    await this.init();
    const scope = normalizeWorkspaceId(workspaceId);
    const app = await this.openRepositoryBackedApp(this.pool, scope);
    const meta = await this.loadMeta(this.pool);
    return {
      app,
      nextId: meta?.next_id ?? 1,
      close: async () => undefined
    };
  }

  async openWriteSession(workspaceId = DEFAULT_WORKSPACE_ID): Promise<RuntimeSession> {
    await this.init();
    const scope = normalizeWorkspaceId(workspaceId);
    const client = await this.pool.connect();
    await client.query("begin");
    const meta = await this.loadMetaForUpdate(client);
    restoreIdSequence(meta?.next_id ?? 1);
    const app = await this.openRepositoryBackedApp(client, scope);
    let finished = false;

    const finalize = async (mode: "commit" | "rollback") => {
      if (finished) return;
      try {
        if (mode === "commit") {
          await app.flushPendingExternalEventUpdates();
          await this.saveAppSideEffects(client, scope, app);
          await client.query("commit");
        } else {
          await client.query("rollback");
        }
      } finally {
        finished = true;
      }
    };

    return {
      app,
      nextId: meta?.next_id ?? 1,
      commit: async () => await finalize("commit"),
      rollback: async () => await finalize("rollback"),
      close: async () => {
        if (!finished) {
          await client.query("rollback").catch(() => undefined);
        }
        client.release();
      }
    };
  }

  async checkReady(): Promise<{ ok: boolean; schemaVersion?: number; message?: string }> {
    try {
      await this.init();
      const { rows } = await this.pool.query<{ schema_version: number }>(
        "select schema_version from accounting_runtime_meta where key = $1",
        [RUNTIME_ROW_KEY]
      );
      return { ok: true, schemaVersion: Number(rows[0]?.schema_version ?? RUNTIME_SCHEMA_VERSION) };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async close() {
    await this.pool.end();
  }

  private async initialize() {
    const schemaSql = await schemaSqlPromise;
    await this.pool.query(schemaSql);
    await this.pool.query(LEGACY_STATE_JSON_ALTERS);
    await this.pool.query(SCHEMA_ALTERS);
    await this.pool.query(WORKSPACE_ALTERS);
    await this.pool.query(PUBLIC_ID_ALTERS);
    await this.pool.query(POST_PUBLIC_ID_BACKFILLS);
    await this.migrateLegacyState();
    await this.pool.query(DROP_LEGACY_STATE_JSON_ALTERS);
  }

  private async migrateLegacyState() {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const configured = await this.hasNormalizedData(client);
      if (!configured) {
        await this.saveMeta(client, 1);
      } else {
        const meta = await this.loadMeta(client);
        if (!meta) await this.saveMeta(client, 1);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async hasNormalizedData(source: Queryable) {
    const result = await source.query<{ exists: boolean }>("select exists(select 1 from organization) as exists");
    return Boolean(result.rows[0]?.exists);
  }

  private async loadMeta(source: Queryable) {
    const result = await source.query<RuntimeMetaRow>(
      "select next_id, singletons from accounting_runtime_meta where key = $1",
      [RUNTIME_ROW_KEY]
    );
    return result.rows[0];
  }

  private async loadMetaForUpdate(client: PoolClient) {
    const result = await client.query<RuntimeMetaRow>(
      "select next_id, singletons from accounting_runtime_meta where key = $1 for update",
      [RUNTIME_ROW_KEY]
    );
    return result.rows[0];
  }

  private async openRepositoryBackedApp(source: Queryable, workspaceId: string) {
    const app = await openPostgresRepositoryBackedApp(source, workspaceId);
    app.importChannelCredentials(await this.loadChannelCredentials(source, workspaceId));
    app.importPluginSecrets(await this.loadPluginSecrets(source, workspaceId));
    return app;
  }

  private async saveAppSideEffects(client: PoolClient, workspaceId: string, app: AccountingApp) {
    const setup = app.setupMetadata();
    await saveRuntimeSingleton(client, workspaceId, "organization", setup.organization as unknown as RuntimeEntity | undefined);
    await saveRuntimeSingleton(client, workspaceId, "accounting_policy", setup.accountingPolicy as unknown as RuntimeEntity | undefined);
    await this.saveChannelCredentials(client, workspaceId, app.exportChannelCredentials());
    await this.savePluginSecrets(client, workspaceId, setup.organization?.id, app.exportPluginSecrets());
    await this.saveMeta(client, currentIdSequence());
  }

  private async saveMeta(client: PoolClient, nextId: number) {
    await client.query(
      `
        insert into accounting_runtime_meta (key, schema_version, next_id, singletons, revision, updated_at)
        values ($1, $2, $3, '{}'::jsonb, 1, now())
        on conflict (key) do update set
          schema_version = excluded.schema_version,
          next_id = excluded.next_id,
          singletons = excluded.singletons,
          revision = accounting_runtime_meta.revision + 1,
          updated_at = now()
      `,
      [RUNTIME_ROW_KEY, RUNTIME_SCHEMA_VERSION, nextId]
    );
  }

  private async loadChannelCredentials(source: Queryable, workspaceId: string): Promise<ChannelCredentials> {
    const result = await source.query<{
      public_channel_id: string;
      encrypted_credentials: unknown;
    }>(`
      select
        sales_channel.public_id as public_channel_id,
        channel_credential.encrypted_credentials
      from channel_credential
      join sales_channel on sales_channel.id = channel_credential.channel_id
      where channel_credential.workspace_id = $1 and encrypted_credentials is not null
    `, [workspaceId]);

    return Object.fromEntries(
      result.rows
        .filter((row) => typeof row.public_channel_id === "string" && row.public_channel_id.length > 0)
        .map((row) => [row.public_channel_id, this.decryptCredentialsSafe(row.encrypted_credentials, {
          workspaceId,
          secretType: "channel_credentials",
          scopeId: row.public_channel_id
        })])
        .filter(([, credentials]) => Object.keys(credentials).length > 0)
    ) as ChannelCredentials;
  }

  private async saveChannelCredentials(client: PoolClient, workspaceId: string, credentialsByChannel: ChannelCredentials) {
    const entries = Object.entries(credentialsByChannel)
      .map(([channelId, credentials]) => [channelId, cleanCredentials(credentials)] as const)
      .filter(([, credentials]) => Object.keys(credentials).length > 0);

    const expectedIds = new Set(entries.map(([channelId]) => stableUuid(`channel_credential:${workspaceId}:${channelId}`)));
    const existing = await client.query<{ id: string }>(
      "select id::text as id from channel_credential where workspace_id = $1",
      [workspaceId]
    );

    for (const row of existing.rows) {
      if (!expectedIds.has(row.id)) {
        await client.query("delete from channel_credential where id = $1 and workspace_id = $2", [row.id, workspaceId]);
      }
    }

    for (const [channelId, credentials] of entries) {
      const encrypted = this.encryptCredentials(credentials);
      const channelUuid = entityUuid(channelId);
      await client.query(
        `
          insert into channel_credential
            (id, channel_id, secret_ref, status, encrypted_credentials, fields, workspace_id, created_at, updated_at)
          values
            ($1, $2, $3, $4, $5::jsonb, $6::text[], $7, now(), now())
          on conflict (id) do update set
            channel_id = excluded.channel_id,
            secret_ref = excluded.secret_ref,
            status = excluded.status,
            encrypted_credentials = excluded.encrypted_credentials,
            fields = excluded.fields,
            workspace_id = excluded.workspace_id,
            updated_at = now()
        `,
        [
          stableUuid(`channel_credential:${workspaceId}:${channelId}`),
          channelUuid,
          "encrypted_credentials",
          "active",
          JSON.stringify(encrypted),
          Object.keys(credentials),
          workspaceId
        ]
      );
    }
  }

  private async loadPluginSecrets(source: Queryable, workspaceId: string): Promise<PluginSecretRecords> {
    const result = await source.query<{
      plugin_code: string;
      namespace: string;
      scope_type: string;
      scope_id: string;
      secret_key: string;
      revision: number;
      encrypted_payload: unknown;
    }>(`
      select
        plugin_code,
        namespace,
        scope_type,
        scope_id,
        secret_key,
        revision,
        encrypted_payload
      from plugin_secret_record
      where workspace_id = $1 and encrypted_payload is not null
    `, [workspaceId]);

    const entries = result.rows.map((row) => {
      const mapKey = [row.plugin_code, row.namespace, row.scope_type, row.scope_id, row.secret_key].join("::");
      return [
        mapKey,
        {
          revision: Number(row.revision ?? 1),
          payload: this.decryptCredentialsSafe(row.encrypted_payload, {
            workspaceId,
            secretType: "plugin_secret",
            scopeId: mapKey
          })
        }
      ] satisfies [string, { revision: number; payload: Record<string, string> }];
    }).filter(([, record]) => Object.keys(record.payload).length > 0);

    return Object.fromEntries(entries) as PluginSecretRecords;
  }

  private async savePluginSecrets(client: PoolClient, workspaceId: string, organizationId: string | undefined, records: PluginSecretRecords) {
    const entries = Object.entries(records)
      .map(([mapKey, value]) => ({
        mapKey,
        revision: Number(value.revision ?? 1),
        payload: cleanCredentials(value.payload)
      }))
      .filter((entry) => Object.keys(entry.payload).length > 0);

    const existing = await client.query<{ id: string }>(
      "select id::text as id from plugin_secret_record where workspace_id = $1",
      [workspaceId]
    );
    const expectedIds = new Set(entries.map((entry) => stableUuid(`plugin_secret_record:${workspaceId}:${entry.mapKey}`)));

    for (const row of existing.rows) {
      if (!expectedIds.has(row.id)) {
        await client.query("delete from plugin_secret_record where id = $1 and workspace_id = $2", [row.id, workspaceId]);
      }
    }

    for (const entry of entries) {
      const [pluginCode, namespace, scopeType, scopeId, secretKey] = entry.mapKey.split("::");
      if (!pluginCode || !namespace || !scopeType || !scopeId || !secretKey) continue;
      await client.query(
        `
          insert into plugin_secret_record
            (id, organization_id, plugin_code, namespace, scope_type, scope_id, secret_key, revision, encrypted_payload, workspace_id, created_at, updated_at)
          values
            ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, now(), now())
          on conflict (id) do update set
            organization_id = excluded.organization_id,
            plugin_code = excluded.plugin_code,
            namespace = excluded.namespace,
            scope_type = excluded.scope_type,
            scope_id = excluded.scope_id,
            secret_key = excluded.secret_key,
            revision = excluded.revision,
            encrypted_payload = excluded.encrypted_payload,
            workspace_id = excluded.workspace_id,
            updated_at = now()
        `,
        [
          stableUuid(`plugin_secret_record:${workspaceId}:${entry.mapKey}`),
          organizationId ? entityUuid(organizationId) : null,
          pluginCode,
          namespace,
          scopeType,
          scopeId,
          secretKey,
          entry.revision,
          JSON.stringify(this.encryptCredentials(entry.payload)),
          workspaceId
        ]
      );
    }
  }

  private encryptCredentials(credentials: CleanCredentials): EncryptedPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    cipher.setAAD(CREDENTIALS_AAD);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(credentials), "utf8"),
      cipher.final()
    ]);
    return {
      v: 1,
      alg: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64")
    };
  }

  private decryptCredentials(payload: unknown): Record<string, string> {
    return this.decryptPayload<Record<string, string>>(payload) ?? {};
  }

  private decryptCredentialsSafe(payload: unknown, context: { workspaceId: string; secretType: string; scopeId: string }): Record<string, string> {
    try {
      return this.decryptCredentials(payload);
    } catch (error) {
      console.warn(JSON.stringify({
        level: "warn",
        event: "runtime_secret_decrypt_failed",
        workspaceId: context.workspaceId,
        secretType: context.secretType,
        scopeId: context.scopeId,
        error: error instanceof Error ? error.message : String(error)
      }));
      return {};
    }
  }

  private decryptPayload<T>(payload: unknown): T | undefined {
    if (!payload) return undefined;
    const encrypted = payload as Partial<EncryptedPayload>;
    if (encrypted.v !== 1 || encrypted.alg !== "aes-256-gcm" || !encrypted.iv || !encrypted.tag || !encrypted.data) {
      throw new Error("Некорректный формат сохраненных кредов каналов");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(encrypted.iv, "base64"));
    decipher.setAAD(CREDENTIALS_AAD);
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted.data, "base64")),
      decipher.final()
    ]);
    return JSON.parse(decrypted.toString("utf8")) as T;
  }
}

const externalEventTableSpec = TABLES.find((table) => table.collection === "externalEvents")!;

/**
 * Postgres-реализация ExternalEventStore: события живут в таблице external_event, а НЕ в snapshot.
 * Инжектится в сессию (read: pool, write: транзакционный client), чтобы app не грузил общий snapshot.
 */
export class PostgresExternalEventStore implements ExternalEventStore {
  constructor(private readonly q: Queryable, private readonly workspaceId: string) {}

  async getById(id: ID): Promise<ExternalEvent | undefined> {
    const result = await this.q.query<ExternalEventDbRow>(
      `select ${EXTERNAL_EVENT_SELECT}
       from external_event
       ${EXTERNAL_EVENT_JOINS}
       where external_event.workspace_id = $1 and external_event.public_id = $2
       limit 1`,
      [this.workspaceId, id]
    );
    return result.rows[0] ? externalEventFromRow(result.rows[0]) : undefined;
  }

  async findByIdentity(channelId: ID, externalId: string, idempotencyKey?: string): Promise<ExternalEvent | undefined> {
    const result = await this.q.query<ExternalEventDbRow>(
      `select ${EXTERNAL_EVENT_SELECT}
       from external_event
       ${EXTERNAL_EVENT_JOINS}
       where external_event.workspace_id = $1 and external_event.channel_id = $2
         and (external_event.external_id = $3 or external_event.idempotency_key = $4)
       order by (external_event.idempotency_key = $4) desc
       limit 1`,
      [this.workspaceId, entityUuid(channelId), externalId, idempotencyKey ?? externalId]
    );
    return result.rows[0] ? externalEventFromRow(result.rows[0]) : undefined;
  }

  async list(filter: ExternalEventListFilter = {}): Promise<ExternalEvent[]> {
    const conditions = ["external_event.workspace_id = $1"];
    const params: unknown[] = [this.workspaceId];
    if (filter.channelId) {
      params.push(entityUuid(filter.channelId));
      conditions.push(`external_event.channel_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`external_event.status = $${params.length}`);
    }
    if (filter.eventType) {
      params.push(filter.eventType);
      conditions.push(`external_event.event_type = $${params.length}`);
    }
    const result = await this.q.query<ExternalEventDbRow>(
      `select ${EXTERNAL_EVENT_SELECT}
       from external_event
       ${EXTERNAL_EVENT_JOINS}
       where ${conditions.join(" and ")}
       order by external_event.occurred_at, external_event.id`,
      params
    );
    return result.rows.map(externalEventFromRow);
  }

  async count(filter: { channelId?: ID; status?: string } = {}): Promise<number> {
    const conditions = ["workspace_id = $1"];
    const params: unknown[] = [this.workspaceId];
    if (filter.channelId) {
      params.push(entityUuid(filter.channelId));
      conditions.push(`channel_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    const result = await this.q.query<{ count: string }>(
      `select count(*)::text as count from external_event where ${conditions.join(" and ")}`,
      params
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async upsert(event: ExternalEvent): Promise<void> {
    const row = { ...externalEventTableSpec.serialize(event as unknown as RuntimeEntity), workspace_id: this.workspaceId, public_id: event.id } as RowRecord;
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const updates = columns.filter((column) => column !== "id").map((column) => `${column} = excluded.${column}`).join(", ");
    await this.q.query(
      `insert into external_event (${columns.join(", ")}) values (${placeholders}) on conflict (id) do update set ${updates}`,
      columns.map((column) => row[column])
    );
  }

  async deleteByIds(ids: ID[]): Promise<void> {
    if (ids.length === 0) return;
    await this.q.query("delete from external_event where workspace_id = $1 and public_id = any($2::text[])", [this.workspaceId, ids]);
  }
}

const observedStockTableSpec = TABLES.find((table) => table.collection === "observedStocks")!;

/** Postgres-реализация ObservedStockStore: остатки в таблице observed_stock, вне snapshot. */
export class PostgresObservedStockStore implements ObservedStockStore {
  constructor(private readonly q: Queryable, private readonly workspaceId: string) {}

  async getById(id: ID): Promise<ObservedStock | undefined> {
    const result = await this.q.query<ObservedStockDbRow>(
      `select ${OBSERVED_STOCK_SELECT}
       from observed_stock
       ${OBSERVED_STOCK_JOINS}
       where observed_stock.workspace_id = $1 and observed_stock.public_id = $2
       limit 1`,
      [this.workspaceId, id]
    );
    return result.rows[0] ? observedStockFromRow(result.rows[0]) : undefined;
  }

  async findByKey(channelId: ID, externalProductId: ID, warehouseId: ID | undefined, observedAt: string): Promise<ObservedStock | undefined> {
    const result = await this.q.query<ObservedStockDbRow>(
      `select ${OBSERVED_STOCK_SELECT}
       from observed_stock
       ${OBSERVED_STOCK_JOINS}
       where observed_stock.workspace_id = $1 and observed_stock.channel_id = $2 and observed_stock.external_product_id = $3
         and observed_stock.observed_at = $4 and observed_stock.warehouse_id is not distinct from $5
       limit 1`,
      [this.workspaceId, entityUuid(channelId), entityUuid(externalProductId), observedAt, warehouseId ? entityUuid(warehouseId) : null]
    );
    return result.rows[0] ? observedStockFromRow(result.rows[0]) : undefined;
  }

  async list(filter: ObservedStockListFilter = {}): Promise<ObservedStock[]> {
    const conditions = ["observed_stock.workspace_id = $1"];
    const params: unknown[] = [this.workspaceId];
    if (filter.channelId) {
      params.push(entityUuid(filter.channelId));
      conditions.push(`observed_stock.channel_id = $${params.length}`);
    }
    if (filter.externalProductId) {
      params.push(entityUuid(filter.externalProductId));
      conditions.push(`observed_stock.external_product_id = $${params.length}`);
    }
    const result = await this.q.query<ObservedStockDbRow>(
      `select ${OBSERVED_STOCK_SELECT}
       from observed_stock
       ${OBSERVED_STOCK_JOINS}
       where ${conditions.join(" and ")}
       order by observed_stock.observed_at, observed_stock.id`,
      params
    );
    return result.rows.map(observedStockFromRow);
  }

  async count(filter: { channelId?: ID } = {}): Promise<number> {
    const conditions = ["workspace_id = $1"];
    const params: unknown[] = [this.workspaceId];
    if (filter.channelId) {
      params.push(entityUuid(filter.channelId));
      conditions.push(`channel_id = $${params.length}`);
    }
    const result = await this.q.query<{ count: string }>(
      `select count(*)::text as count from observed_stock where ${conditions.join(" and ")}`,
      params
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async upsert(observed: ObservedStock): Promise<void> {
    const row = { ...observedStockTableSpec.serialize(observed as unknown as RuntimeEntity), workspace_id: this.workspaceId, public_id: observed.id } as RowRecord;
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const updates = columns.filter((column) => column !== "id").map((column) => `${column} = excluded.${column}`).join(", ");
    await this.q.query(
      `insert into observed_stock (${columns.join(", ")}) values (${placeholders}) on conflict (id) do update set ${updates}`,
      columns.map((column) => row[column])
    );
  }

  async deleteByIds(ids: ID[]): Promise<void> {
    if (ids.length === 0) return;
    await this.q.query("delete from observed_stock where workspace_id = $1 and public_id = any($2::text[])", [this.workspaceId, ids]);
  }
}

const syncRunTableSpec = TABLES.find((table) => table.collection === "syncRuns")!;

/** Postgres-реализация SyncRunStore: запуски синхронизации в таблице sync_run, вне snapshot. */
export class PostgresSyncRunStore implements SyncRunStore {
  constructor(private readonly q: Queryable, private readonly workspaceId: string) {}

  async getById(id: ID): Promise<SyncRun | undefined> {
    const result = await this.q.query<SyncRunDbRow>(
      `select ${SYNC_RUN_SELECT}
       from sync_run
       ${SYNC_RUN_JOINS}
       where sync_run.workspace_id = $1 and sync_run.public_id = $2
       limit 1`,
      [this.workspaceId, id]
    );
    return result.rows[0] ? syncRunFromRow(result.rows[0]) : undefined;
  }

  async listAll(): Promise<SyncRun[]> {
    const result = await this.q.query<SyncRunDbRow>(
      `select ${SYNC_RUN_SELECT}
       from sync_run
       ${SYNC_RUN_JOINS}
       where sync_run.workspace_id = $1
       order by sync_run.started_at, sync_run.id`,
      [this.workspaceId]
    );
    return result.rows.map(syncRunFromRow);
  }

  async listByChannel(channelId: ID): Promise<SyncRun[]> {
    const result = await this.q.query<SyncRunDbRow>(
      `select ${SYNC_RUN_SELECT}
       from sync_run
       ${SYNC_RUN_JOINS}
       where sync_run.workspace_id = $1 and sync_run.channel_id = $2
       order by sync_run.started_at, sync_run.id`,
      [this.workspaceId, entityUuid(channelId)]
    );
    return result.rows.map(syncRunFromRow);
  }

  async upsert(run: SyncRun): Promise<void> {
    const row = { ...syncRunTableSpec.serialize(run as unknown as RuntimeEntity), workspace_id: this.workspaceId, public_id: run.id } as RowRecord;
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const updates = columns.filter((column) => column !== "id").map((column) => `${column} = excluded.${column}`).join(", ");
    await this.q.query(
      `insert into sync_run (${columns.join(", ")}) values (${placeholders}) on conflict (id) do update set ${updates}`,
      columns.map((column) => row[column])
    );
  }

  async deleteByIds(ids: ID[]): Promise<void> {
    if (ids.length === 0) return;
    await this.q.query("delete from sync_run where workspace_id = $1 and public_id = any($2::text[])", [this.workspaceId, ids]);
  }
}

async function readRuntimeCollection(source: Queryable, workspaceId: string | undefined, name: string): Promise<{ found: boolean; data?: unknown }> {
  const scope = normalizeWorkspaceId(workspaceId);
  if (name === "organization") {
    return { found: true, data: await readRuntimeSingleton(source, scope, "organization") };
  }
  if (name === "accountingPolicy") {
    return { found: true, data: await readRuntimeSingleton(source, scope, "accounting_policy") };
  }

  const table = TABLES.find((candidate) => candidate.collection === name);
  if (!table) return { found: false };
  const tableWorkspaceId = workspaceIdForTable(table, scope);
  const result = await source.query<RowRecord>(
    tableReadSql(table, `${table.table}.workspace_id = $1`),
    [tableWorkspaceId]
  );
  return { found: true, data: result.rows.map((row) => hydrateTableRow(table, row)) };
}

export async function readRuntimeLedgerBalances(source: Queryable, workspaceId: string | undefined): Promise<RuntimeLedgerBalances> {
  const scope = normalizeWorkspaceId(workspaceId);
  const result = await source.query<{ account_code: string; debit: string; credit: string }>(
    `
      select
        journal_line.account_code,
        coalesce(sum(journal_line.debit), 0)::text as debit,
        coalesce(sum(journal_line.credit), 0)::text as credit
      from journal_line
      join journal_entry on journal_entry.id = journal_line.journal_entry_id
      where journal_entry.workspace_id = $1 and journal_line.workspace_id = $1
      group by journal_line.account_code
      order by journal_line.account_code
    `,
    [scope]
  );
  return result.rows.reduce<RuntimeLedgerBalances>((acc, row) => {
    acc[row.account_code] = {
      debit: round2(Number(row.debit ?? 0)),
      credit: round2(Number(row.credit ?? 0))
    };
    return acc;
  }, {});
}

export async function readRuntimeDashboard(source: Queryable, workspaceId: string | undefined) {
  const scope = normalizeWorkspaceId(workspaceId);
  const [
    organization,
    accountingPolicy,
    periods,
    products,
    documents,
    inventoryLots,
    correctionCases,
    stockStates,
    sales,
    purchaseOrders,
    balances
  ] = await Promise.all([
    readRuntimeSingleton(source, scope, "organization"),
    readRuntimeSingleton(source, scope, "accounting_policy"),
    readCollectionData<RuntimeEntity>(source, scope, "periods"),
    readCollectionData<RuntimeEntity>(source, scope, "products"),
    readCollectionData<RuntimeEntity>(source, scope, "documents"),
    readCollectionData<RuntimeEntity>(source, scope, "inventoryLots"),
    readCollectionData<RuntimeEntity>(source, scope, "correctionCases"),
    readCollectionData<RuntimeEntity>(source, scope, "stockStates"),
    readCollectionData<RuntimeEntity>(source, scope, "sales"),
    readCollectionData<RuntimeEntity>(source, scope, "purchaseOrders"),
    readRuntimeLedgerBalances(source, scope)
  ]);

  return {
    organization,
    configured: Boolean(organization),
    policy: accountingPolicy,
    currentPeriod: periods.find((period) => period.status === "open"),
    periods,
    counters: {
      products: products.length,
      documents: documents.length,
      postedDocuments: documents.filter((document) => document.status === "posted").length,
      inventoryLots: inventoryLots.filter((lot) => Number(lot.qtyRemaining ?? 0) > 0).length,
      sales: sales.length,
      purchaseOrders: purchaseOrders.length,
      openCorrections: correctionCases.filter((correction) => correction.status !== "applied").length
    },
    inventoryCostRub: round2(stockStates.reduce((sum, stock) => sum + Number(stock.costRub ?? 0), 0)),
    recentDocuments: documents
      .slice()
      .sort((left, right) => String(right.accountingDate).localeCompare(String(left.accountingDate)) || String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
      .slice(0, 6),
    balances
  };
}

export async function readRuntimeReports(source: Queryable, workspaceId: string | undefined) {
  const scope = normalizeWorkspaceId(workspaceId);
  const balances = await readRuntimeLedgerBalances(source, scope);
  const [
    chartAccounts,
    products,
    warehouses,
    payments,
    saleLines,
    stockStates
  ] = await Promise.all([
    readCollectionData<RuntimeEntity>(source, scope, "chartAccounts"),
    readCollectionData<RuntimeEntity>(source, scope, "products"),
    readCollectionData<RuntimeEntity>(source, scope, "warehouses"),
    readCollectionData<RuntimeEntity>(source, scope, "payments"),
    readCollectionData<RuntimeEntity>(source, scope, "saleLines"),
    readCollectionData<RuntimeEntity>(source, scope, "stockStates")
  ]);

  const revenue = creditTurnover(balances["90.01"]);
  const costOfSales = debitTurnover(balances["90.02"]);
  const operatingExpenses = round2(debitTurnover(balances["26"]) + debitTurnover(balances["44"]) + debitTurnover(balances["91.02"]));
  const otherIncome = creditTurnover(balances["91.01"]);
  const pnl = {
    revenue,
    costOfSales,
    operatingExpenses,
    otherIncome,
    netProfit: round2(revenue + otherIncome - costOfSales - operatingExpenses)
  };
  const inventory = stockStates.map((stock) => ({
    ...stock,
    product: products.find((product) => product.id === stock.productId),
    warehouse: warehouses.find((warehouse) => warehouse.id === stock.warehouseId)
  }));
  return {
    trialBalance: chartAccounts.map((account) => ({
      account,
      debit: balances[String(account.code)]?.debit ?? 0,
      credit: balances[String(account.code)]?.credit ?? 0,
      balance: round2((balances[String(account.code)]?.debit ?? 0) - (balances[String(account.code)]?.credit ?? 0))
    })),
    pnl,
    balanceSheet: {
      assets: debitBalance(balances["41.01"]) + debitBalance(balances["41.02"]) + debitBalance(balances["41.03"]) + debitBalance(balances["45.03"]) + debitBalance(balances["50"]) + debitBalance(balances["51"]) + debitBalance(balances["76.02"]) + debitBalance(balances["76.ТП"]),
      liabilities: creditBalance(balances["60.01"]) + creditBalance(balances["60.02"]) + creditBalance(balances["76.ТП"]),
      equity: creditBalance(balances["80.01"]) - debitBalance(balances["80.02"]) + pnl.netProfit
    },
    cashFlow: {
      cashBalance: debitBalance(balances["51"]) + debitBalance(balances["50"]),
      incoming: payments.filter((payment) => payment.paymentDirection === "incoming").reduce((sum, payment) => sum + Number(payment.amountRub ?? 0), 0),
      outgoing: payments.filter((payment) => payment.paymentDirection === "outgoing").reduce((sum, payment) => sum + Number(payment.amountRub ?? 0), 0)
    },
    inventory,
    unitEconomics: saleLines.map((line) => ({
      saleLine: line,
      product: products.find((product) => product.id === line.productId),
      grossMarginRub: round2(Number(line.revenueRub ?? 0) - Number(line.costRub ?? 0)),
      grossMarginPercent: Number(line.revenueRub ?? 0) > 0 ? round2(((Number(line.revenueRub ?? 0) - Number(line.costRub ?? 0)) / Number(line.revenueRub ?? 0)) * 100) : 0
    }))
  };
}

export async function readRuntimeReportWorkspace(source: Queryable, workspaceId: string | undefined, options: ReportsWorkspaceOptions) {
  const scope = normalizeWorkspaceId(workspaceId);
  const [
    channelFinanceEvents,
    chartAccounts,
    documents,
    journalEntries,
    journalLines,
    operatingExpenses,
    ownerTransactions,
    products,
    saleLines,
    sales,
    salesChannels
  ] = await Promise.all([
    readCollectionData<RuntimeEntity>(source, scope, "channelFinanceEvents"),
    readCollectionData<RuntimeEntity>(source, scope, "chartAccounts"),
    readCollectionData<RuntimeEntity>(source, scope, "documents"),
    readCollectionData<RuntimeEntity>(source, scope, "journalEntries"),
    readCollectionData<RuntimeEntity>(source, scope, "journalLines"),
    readCollectionData<RuntimeEntity>(source, scope, "operatingExpenses"),
    readCollectionData<RuntimeEntity>(source, scope, "ownerTransactions"),
    readCollectionData<RuntimeEntity>(source, scope, "products"),
    readCollectionData<RuntimeEntity>(source, scope, "saleLines"),
    readCollectionData<RuntimeEntity>(source, scope, "sales"),
    readCollectionData<RuntimeEntity>(source, scope, "salesChannels")
  ]);
  return buildReportsWorkspacePayload({
    channelFinanceEvents,
    chartAccounts,
    documents,
    journalEntries,
    journalLines,
    operatingExpenses,
    ownerTransactions,
    products,
    saleLines,
    sales,
    salesChannels
  }, options);
}

export async function readRuntimeProductWorkspace(source: Queryable, workspaceId: string | undefined, productId: string) {
  const scope = normalizeWorkspaceId(workspaceId);
  const productRows = await readRuntimeRows<RuntimeEntity>(source, scope, "products", "product.public_id = $2", [productId], "limit 1");
  const product = productRows[0];
  const productUuid = entityUuid(productId);
  const [
    accountingPolicy,
    inventoryLots,
    stockMovements,
    stockStates,
    costApplications,
    productExternalLinks,
    purchaseOrderLines,
    externalEvents
  ] = await Promise.all([
    readRuntimeSingleton(source, scope, "accounting_policy"),
    readRuntimeRows<RuntimeEntity>(source, scope, "inventoryLots", "inventory_lot.product_id = $2", [productUuid]),
    readRuntimeRows<RuntimeEntity>(source, scope, "stockMovements", "stock_movement.product_id = $2", [productUuid]),
    readRuntimeRows<RuntimeEntity>(source, scope, "stockStates", "stock_state.product_id = $2", [productUuid]),
    readRuntimeRows<RuntimeEntity>(source, scope, "costApplications", "cost_application.product_id = $2", [productUuid]),
    readRuntimeRows<RuntimeEntity>(source, scope, "productExternalLinks", "product_external_link.product_id = $2", [productUuid]),
    readRuntimeRows<RuntimeEntity>(source, scope, "purchaseOrderLines", "purchase_order_line.product_id = $2", [productUuid]),
    readRuntimeRows<RuntimeEntity>(
      source,
      scope,
      "externalEvents",
      "external_event.product_id = $2 and external_event.status not in ('processed', 'ignored')",
      [productUuid]
    )
  ]);
  const purchaseOrders = await readRuntimeRowsByPublicIds<RuntimeEntity>(
    source,
    scope,
    "purchaseOrders",
    purchaseOrderLines.map((line) => String(line.purchaseOrderId ?? ""))
  );
  const documentIds = [
    ...inventoryLots.map((lot) => String(lot.sourceDocumentId ?? "")),
    ...stockMovements.map((movement) => String(movement.documentId ?? "")),
    ...costApplications.flatMap((application) => [String(application.sourceDocumentId ?? ""), String(application.outboundDocumentId ?? "")]),
    ...purchaseOrders.map((order) => String(order.documentId ?? ""))
  ];
  const documents = await readRuntimeRowsByPublicIds<RuntimeEntity>(source, scope, "documents", documentIds);
  const journalEntries = await readRuntimeRowsByForeignPublicIds<RuntimeEntity>(
    source,
    scope,
    "journalEntries",
    "journal_entry.document_id",
    documents.map((document) => String(document.id ?? ""))
  );
  const warehouses = await readRuntimeRowsByPublicIds<RuntimeEntity>(
    source,
    scope,
    "warehouses",
    [
      ...inventoryLots.map((lot) => String(lot.warehouseId ?? "")),
      ...stockMovements.map((movement) => String(movement.warehouseId ?? "")),
      ...stockStates.map((stock) => String(stock.warehouseId ?? ""))
    ]
  );
  const externalProducts = await readRuntimeRowsByPublicIds<RuntimeEntity>(
    source,
    scope,
    "externalProducts",
    productExternalLinks.map((link) => String(link.externalProductId ?? ""))
  );
  const salesChannels = await readRuntimeRowsByPublicIds<RuntimeEntity>(
    source,
    scope,
    "salesChannels",
    productExternalLinks.map((link) => String(link.channelId ?? ""))
  );

  return buildProductCardWorkspacePayload({
    accountingPolicy: accountingPolicy as RuntimeEntity | undefined,
    products: product ? [product] : [],
    warehouses,
    documents,
    journalEntries,
    costApplications,
    externalProducts,
    productExternalLinks,
    salesChannels,
    inventoryLots,
    stockMovements,
    stockStates,
    purchaseOrders,
    purchaseOrderLines,
    externalEvents
  }, productId);
}

async function readCollectionData<T extends RuntimeEntity>(source: Queryable, workspaceId: string, name: RuntimeCollectionName): Promise<T[]> {
  const result = await readRuntimeCollection(source, workspaceId, name);
  return (result.data ?? []) as T[];
}

async function readRuntimeRows<T extends RuntimeEntity>(
  source: Queryable,
  workspaceId: string,
  name: RuntimeCollectionName,
  whereSql: string,
  params: unknown[],
  suffix = ""
): Promise<T[]> {
  const table = tableForCollection(name);
  const result = await source.query<RowRecord>(
    tableReadSql(table, `${table.table}.workspace_id = $1 and ${whereSql}`, suffix),
    [workspaceIdForTable(table, workspaceId), ...params]
  );
  return result.rows.map((row) => hydrateTableRow(table, row) as T);
}

async function readRuntimeRowsByPublicIds<T extends RuntimeEntity>(
  source: Queryable,
  workspaceId: string,
  name: RuntimeCollectionName,
  publicIds: string[]
): Promise<T[]> {
  const ids = uniqueNonEmpty(publicIds);
  if (ids.length === 0) return [];
  return await readRuntimeRows<T>(source, workspaceId, name, `${tableForCollection(name).table}.public_id = any($2::text[])`, [ids]);
}

async function readRuntimeRowsByForeignPublicIds<T extends RuntimeEntity>(
  source: Queryable,
  workspaceId: string,
  name: RuntimeCollectionName,
  foreignColumn: string,
  publicIds: string[]
): Promise<T[]> {
  const ids = uniqueNonEmpty(publicIds).map(entityUuid);
  if (ids.length === 0) return [];
  return await readRuntimeRows<T>(source, workspaceId, name, `${foreignColumn} = any($2::uuid[])`, [ids]);
}

function debitBalance(balance?: { debit: number; credit: number }): number {
  if (!balance) return 0;
  return round2(Math.max(0, balance.debit - balance.credit));
}

function creditBalance(balance?: { debit: number; credit: number }): number {
  if (!balance) return 0;
  return round2(Math.max(0, balance.credit - balance.debit));
}

function debitTurnover(balance?: { debit: number; credit: number }): number {
  if (!balance) return 0;
  return round2(balance.debit - balance.credit);
}

function creditTurnover(balance?: { debit: number; credit: number }): number {
  if (!balance) return 0;
  return round2(balance.credit - balance.debit);
}

async function openPostgresRepositoryBackedApp(source: Queryable, workspaceId: string | undefined): Promise<AccountingApp> {
  const scope = normalizeWorkspaceId(workspaceId);
  const state = createEmptyState();
  state.organization = await readRuntimeSingleton(source, scope, "organization") as AccountingState["organization"];
  state.accountingPolicy = await readRuntimeSingleton(source, scope, "accounting_policy") as AccountingState["accountingPolicy"];
  const app = new AccountingApp(state);
  app.repos = buildPostgresRuntimeRepositories(source, scope);
  app.externalEvents = new PostgresExternalEventStore(source, scope);
  app.observedStocks = new PostgresObservedStockStore(source, scope);
  app.syncRuns = new PostgresSyncRunStore(source, scope);
  await app.ensureRequiredSystemMetadata();
  return app;
}

export async function openPostgresReadContext(source: Queryable, workspaceId: string | undefined): Promise<RuntimeReadContext> {
  const scope = normalizeWorkspaceId(workspaceId);
  const [organization, accountingPolicy] = await Promise.all([
    readRuntimeSingleton(source, scope, "organization") as Promise<AccountingState["organization"]>,
    readRuntimeSingleton(source, scope, "accounting_policy") as Promise<AccountingState["accountingPolicy"]>
  ]);
  return {
    repos: buildPostgresRuntimeRepositories(source, scope),
    externalEvents: new PostgresExternalEventStore(source, scope),
    observedStocks: new PostgresObservedStockStore(source, scope),
    syncRuns: new PostgresSyncRunStore(source, scope),
    channelCredentialStatus: (channelId) => readRuntimeChannelCredentialStatus(source, scope, channelId),
    setupMetadata: () => ({
      organization,
      accountingPolicy,
      configured: Boolean(organization)
    })
  };
}

export async function openPostgresWriteContext(source: Queryable, workspaceId: string | undefined): Promise<RuntimeWriteContext> {
  return await openPostgresReadContext(source, workspaceId);
}

export function buildPostgresRuntimeRepositories(source: Queryable, workspaceId: string | undefined): Repositories {
  const repos = {} as Repositories;
  const scope = normalizeWorkspaceId(workspaceId);
  for (const table of TABLES) {
    (repos as Record<string, unknown>)[table.collection] = new PostgresRuntimeCollectionRepo(source, scope, table);
  }
  repos.saveSingletons = async (singletons) => {
    await saveRuntimeSingleton(source, scope, "organization", singletons.organization as unknown as RuntimeEntity | undefined);
    await saveRuntimeSingleton(source, scope, "accounting_policy", singletons.accountingPolicy as unknown as RuntimeEntity | undefined);
  };
  return repos;
}

async function readRuntimeChannelCredentialStatus(source: Queryable, workspaceId: string, channelId: string) {
  const result = await source.query<{ fields: string[] | null }>(
    `
      select channel_credential.fields
      from channel_credential
      join sales_channel on sales_channel.id = channel_credential.channel_id
      where channel_credential.workspace_id = $1
        and sales_channel.workspace_id = $1
        and sales_channel.public_id = $2
      limit 1
    `,
    [workspaceId, channelId]
  );
  const fields = result.rows[0]?.fields;
  return {
    channelId,
    saved: Array.isArray(fields) && fields.length > 0,
    fields: Array.isArray(fields) ? fields : []
  };
}

async function readRuntimeAgentTokenPrincipal(
  source: Queryable,
  workspaceId: string,
  tokenId: string,
  tokenHash: string,
  lockClause = ""
): Promise<RuntimeAgentTokenPrincipal | null> {
  const result = await source.query<{ token_id: string; name: string; mode: string | null; scopes: unknown }>(
    `
      select
        agent_token.public_id as token_id,
        agent_token.name,
        agent_token.mode,
        agent_token.scopes
      from agent_token
      where agent_token.workspace_id = $1
        and agent_token.public_id = $2
        and agent_token.token_hash = $3
        and agent_token.status = 'active'
      limit 1
      ${lockClause}
    `,
    [workspaceId, tokenId, tokenHash]
  );
  const row = result.rows[0];
  if (!row) return null;
  const mode = row.mode === "read_write" ? "read_write" : "read_only";
  return {
    tokenId: row.token_id,
    workspaceId,
    name: row.name,
    mode,
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : []
  };
}

class PostgresRuntimeCollectionRepo<T> implements CollectionRepo<T> {
  constructor(private readonly q: Queryable, private readonly workspaceId: string, private readonly table: TableSpec) {}

  async all(): Promise<T[]> {
    const tableWorkspaceId = workspaceIdForTable(this.table, this.workspaceId);
    const result = await this.q.query<RowRecord>(
      tableReadSql(this.table, `${this.table.table}.workspace_id = $1`),
      [tableWorkspaceId]
    );
    return result.rows.map((row) => hydrateTableRow(this.table, row) as T);
  }

  async getById(id: string): Promise<T | undefined> {
    const tableWorkspaceId = workspaceIdForTable(this.table, this.workspaceId);
    const result = await this.q.query<RowRecord>(
      tableReadSql(this.table, `${this.table.table}.workspace_id = $1 and ${this.table.table}.public_id = $2`, "limit 1"),
      [tableWorkspaceId, id]
    );
    return result.rows[0] ? hydrateTableRow(this.table, result.rows[0]) as T : undefined;
  }

  async add(item: T): Promise<T> {
    await this.upsert(item);
    return item;
  }

  async upsert(item: T): Promise<T> {
    const row = {
      ...this.table.serialize(item as unknown as RuntimeEntity),
      workspace_id: workspaceIdForTable(this.table, this.workspaceId),
      public_id: entityId(this.table.collection, item as unknown as RuntimeEntity)
    };
    await upsertRow(this.q, this.table.table, this.table.keyColumns, row);
    return item;
  }

  async removeById(id: string): Promise<void> {
    await this.q.query(
      `delete from ${this.table.table} where workspace_id = $1 and public_id = $2`,
      [workspaceIdForTable(this.table, this.workspaceId), id]
    );
  }

  async removeWhere(pred: (item: T) => boolean): Promise<void> {
    const keep = (await this.all()).filter((item) => !pred(item));
    await this.replaceAll(keep);
  }

  async replaceAll(items: T[]): Promise<void> {
    const tableWorkspaceId = workspaceIdForTable(this.table, this.workspaceId);
    if (!GLOBAL_REFERENCE_TABLES.has(this.table.table)) {
      await this.q.query(`delete from ${this.table.table} where workspace_id = $1`, [tableWorkspaceId]);
    }
    for (const item of items) await this.upsert(item);
  }
}

async function readRuntimeSingleton(source: Queryable, workspaceId: string, table: "organization" | "accounting_policy") {
  if (table === "organization") {
    const result = await source.query<OrganizationDbRow>(
      `select ${ORGANIZATION_SELECT}
       from organization
       where organization.workspace_id = $1
       order by organization.id
       limit 1`,
      [workspaceId]
    );
    return result.rows[0] ? organizationFromRow(result.rows[0]) : undefined;
  }
  const result = await source.query<AccountingPolicyDbRow>(
    `select ${ACCOUNTING_POLICY_SELECT}
     from accounting_policy
     ${ACCOUNTING_POLICY_JOINS}
     where accounting_policy.workspace_id = $1
     order by accounting_policy.id
     limit 1`,
    [workspaceId]
  );
  return result.rows[0] ? accountingPolicyFromRow(result.rows[0]) : undefined;
}

async function saveRuntimeSingleton(source: Queryable, workspaceId: string, table: "organization" | "accounting_policy", entity: RuntimeEntity | undefined) {
  if (!entity) {
    await source.query(`delete from ${table} where workspace_id = $1`, [workspaceId]);
    return;
  }

  const row = table === "organization"
    ? {
        id: entityUuid(requiredString(entity.id, "organization.id")),
        display_name: requiredString(entity.displayName, "organization.displayName"),
        legal_form: requiredString(entity.legalForm, "organization.legalForm"),
        inn: optionalString(entity.inn),
        timezone: requiredString(entity.timezone, "organization.timezone"),
        tax_mode: requiredString(entity.taxMode, "organization.taxMode"),
        created_at: requiredString(entity.createdAt, "organization.createdAt"),
        updated_at: optionalString(entity.updatedAt),
        workspace_id: workspaceId,
        public_id: requiredString(entity.id, "organization.id")
      }
    : {
        id: entityUuid(requiredString(entity.id, "accountingPolicy.id")),
        organization_id: entityUuid(requiredString(entity.organizationId, "accountingPolicy.organizationId")),
        accounting_start_date: requiredString(entity.accountingStartDate, "accountingPolicy.accountingStartDate"),
        cost_method: requiredString(entity.costMethod, "accountingPolicy.costMethod"),
        accounting_currency: requiredString(entity.accountingCurrency, "accountingPolicy.accountingCurrency"),
        allow_open_period_edits: typeof entity.allowOpenPeriodEdits === "boolean" ? entity.allowOpenPeriodEdits : null,
        comment: optionalString(entity.comment),
        workspace_id: workspaceId,
        public_id: requiredString(entity.id, "accountingPolicy.id")
      };

  await upsertRow(source, table, ["id"], row);
  const result = await source.query<{ id: string }>(`select id from ${table} where workspace_id = $1`, [workspaceId]);
  const currentIds = new Set([String(row.id)]);
  for (const candidate of result.rows) {
    if (!currentIds.has(candidate.id)) {
      await source.query(`delete from ${table} where id = $1 and workspace_id = $2`, [candidate.id, workspaceId]);
    }
  }
}

function tableReadSql(table: TableSpec, whereSql: string, suffix = "") {
  if (!table.select || !table.hydrate) {
    throw new Error(`Runtime table ${table.collection} must declare typed select/hydrate; state_json fallback is disabled`);
  }
  const select = table.select;
  const joins = table.joins ? ` ${table.joins}` : "";
  const orderBy = table.orderBy && !suffix ? ` order by ${table.orderBy}` : "";
  return `select ${select} from ${table.table}${joins} where ${whereSql}${orderBy}${suffix ? ` ${suffix}` : ""}`;
}

function tableForCollection(name: RuntimeCollectionName): TableSpec {
  const table = TABLES.find((candidate) => candidate.collection === name);
  if (!table) throw new Error(`Unknown runtime collection ${name}`);
  return table;
}

function hydrateTableRow(table: TableSpec, row: RowRecord): RuntimeEntity {
  if (!table.hydrate) {
    throw new Error(`Runtime table ${table.collection} must declare typed hydrate; state_json fallback is disabled`);
  }
  return table.hydrate(row);
}

function spec(
  collection: RuntimeCollectionName,
  table: string,
  keyColumns: string[],
  serialize: (entity: RuntimeEntity) => RowRecord,
  orderBy?: string,
  read?: Pick<TableSpec, "select" | "joins" | "hydrate">
): TableSpec {
  return { collection, table, keyColumns, serialize, orderBy, ...read };
}

async function upsertRow(client: Queryable, table: string, keyColumns: string[], row: RowRecord) {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const updates = columns
    .filter((column) => !keyColumns.includes(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");

  await client.query(
    `
      insert into ${table} (${columns.join(", ")})
      values (${placeholders})
      on conflict (${keyColumns.join(", ")}) do update set
        ${updates}
    `,
    columns.map((column) => row[column])
  );
}

function workspaceIdForTable(table: TableSpec, workspaceId: string) {
  return GLOBAL_REFERENCE_TABLES.has(table.table) ? DEFAULT_WORKSPACE_ID : workspaceId;
}

function cleanCredentials(credentials: Record<string, string | undefined>): CleanCredentials {
  return Object.fromEntries(
    Object.entries(credentials).filter(([, value]) => typeof value === "string" && value.length > 0)
  ) as CleanCredentials;
}

function entityId(collection: RuntimeCollectionName, entity: RuntimeEntity): string {
  if (typeof entity.id === "string" && entity.id.length > 0) return entity.id;
  if (typeof entity.code === "string" && entity.code.length > 0) return entity.code;
  if (collection === "stockStates" && typeof entity.productId === "string" && typeof entity.warehouseId === "string") {
    return `${entity.productId}:${entity.warehouseId}:${typeof entity.stateCode === "string" && entity.stateCode.length > 0 ? entity.stateCode : "sellable"}`;
  }
  throw new Error(`Нельзя сохранить ${collection}: нет id/code/composite key`);
}

function entityUuid(id: string) {
  return stableUuid(id);
}

function optionalUuid(value: unknown) {
  return typeof value === "string" && value.length > 0 ? stableUuid(value) : null;
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function normalizeWorkspaceId(workspaceId: string | undefined) {
  const value = workspaceId?.trim();
  return value || DEFAULT_WORKSPACE_ID;
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Нельзя сохранить ${field}: ожидается непустая строка`);
  }
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredNumber(value: unknown, field: string) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Нельзя сохранить ${field}: ожидается число`);
  }
  return value;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

function requiredBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw new Error(`Нельзя сохранить ${field}: ожидается boolean`);
  }
  return value;
}
