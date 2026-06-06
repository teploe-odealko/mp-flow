import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { AccountingApp } from "../../core/accounting-app";
import type { AccountingState, ExternalEvent, ObservedStock, SyncRun, ID } from "../../core/models";
import type { ExternalEventStore, ExternalEventListFilter } from "../../core/external-event-store";
import type { ObservedStockStore, ObservedStockListFilter } from "../../core/observed-stock-store";
import type { SyncRunStore } from "../../core/sync-run-store";
import { createEmptyState, currentIdSequence, restoreIdSequence } from "../../core/utils";

export interface RuntimeSession {
  app: AccountingApp;
  nextId: number;
  commit?(): Promise<void>;
  rollback?(): Promise<void>;
  close?(): Promise<void>;
}

export interface RuntimePersistence {
  save?(app: AccountingApp, workspaceId?: string): Promise<void>;
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
  serialize(entity: RuntimeEntity): RowRecord;
}

interface PreparedTableSnapshot {
  table: TableSpec;
  rows: RowRecord[];
  signatureByKey: Map<string, string>;
}

interface PreparedStateSnapshot {
  organization?: RuntimeEntity;
  accountingPolicy?: RuntimeEntity;
  organizationSignature: string;
  accountingPolicySignature: string;
  tables: PreparedTableSnapshot[];
  tablesByCollection: Map<RuntimeCollectionName, PreparedTableSnapshot>;
}

const RUNTIME_SCHEMA_VERSION = 3;
const RUNTIME_ROW_KEY = "default";
const DEFAULT_WORKSPACE_ID = "default";
const WRITE_LOCK_SQL = "select pg_advisory_xact_lock(684201, 3)";
const CREDENTIALS_AAD = Buffer.from("mpflow-channel-credentials");
const GLOBAL_REFERENCE_TABLES = new Set(["document_type_registry"]);

// Коллекции, вынесенные из snapshot в классические репозитории: их НЕ грузим в state
// на запрос и НЕ удаляем при сохранении. Append-only потоки (пишутся через loop-upsert,
// читаются репозиторием напрямую). Это шаг переезда на controllers→services→repositories.
const SNAPSHOT_APPEND_ONLY = new Set<RuntimeCollectionName>(["auditEvents", "externalEvents", "observedStocks", "syncRuns"]);

const COLLECTIONS: RuntimeCollectionName[] = [
  "periods",
  "chartAccounts",
  "documentTypes",
  "documents",
  "documentLines",
  "documentVersions",
  "documentLinks",
  "journalEntries",
  "journalLines",
  "auditEvents",
  "counterparties",
  "products",
  "productAssets",
  "warehouses",
  "stockStates",
  "inventoryLots",
  "stockMovements",
  "costApplications",
  "purchaseOrders",
  "purchaseOrderLines",
  "cashAccounts",
  "payments",
  "paymentAllocations",
  "settlementEntries",
  "goodsReceipts",
  "goodsReceiptLines",
  "procurementCosts",
  "procurementCostLines",
  "shortageResolutions",
  "shortageResolutionLines",
  "supplierClaims",
  "stockTransfers",
  "stockTransferLines",
  "pluginStateRecords",
  "integrationPlugins",
  "salesChannels",
  "externalProducts",
  "productExternalLinks",
  "syncRuns",
  "externalEvents",
  "observedStocks",
  "sales",
  "saleLines",
  "salesReturns",
  "channelFinanceEvents",
  "payouts",
  "payoutLines",
  "expenseCategories",
  "operatingExpenses",
  "ownerTransactions",
  "stocktakes",
  "stocktakeLines",
  "correctionCases",
  "recalculationJobs",
  "reportSnapshots",
  "backfillProjects",
  "backfillItems",
  "users",
  "roles",
  "agentTokens",
  "channelAgentPermissions"
];

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
  alter table channel_credential add column if not exists encrypted_credentials jsonb;
  alter table channel_credential add column if not exists fields text[] not null default '{}';
  alter table channel_credential add column if not exists created_at timestamptz not null default now();
  alter table channel_credential add column if not exists updated_at timestamptz not null default now();
  alter table plugin_secret_record add column if not exists created_at timestamptz not null default now();
  alter table plugin_secret_record add column if not exists updated_at timestamptz not null default now();
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
`;

const STATE_JSON_ALTERS = STATE_JSON_TABLES
  .map((table) => `alter table ${table} add column if not exists state_json jsonb not null default '{}'::jsonb;`)
  .join("\n");

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
    status: requiredString(entity.status, "periods.status"),
    state_json: entity
  }), "starts_on, id"),
  spec("chartAccounts", "chart_account", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "chartAccounts.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "chartAccounts.organizationId")),
    code: requiredString(entity.code, "chartAccounts.code"),
    name: requiredString(entity.name, "chartAccounts.name"),
    kind: requiredString(entity.kind, "chartAccounts.kind"),
    normal_side: requiredString(entity.normalSide, "chartAccounts.normalSide"),
    is_active: requiredBoolean(entity.isActive, "chartAccounts.isActive"),
    state_json: entity
  }), "code"),
  spec("documentTypes", "document_type_registry", ["code"], (entity) => ({
    code: requiredString(entity.code, "documentTypes.code"),
    module_code: requiredString(entity.moduleCode, "documentTypes.moduleCode"),
    display_name: requiredString(entity.displayName, "documentTypes.displayName"),
    is_posting: requiredBoolean(entity.isPosting, "documentTypes.isPosting"),
    posting_rule_code: optionalString(entity.postingRuleCode),
    allows_draft: requiredBoolean(entity.allowsDraft, "documentTypes.allowsDraft"),
    allows_reversal: requiredBoolean(entity.allowsReversal, "documentTypes.allowsReversal"),
    allows_correction: requiredBoolean(entity.allowsCorrection, "documentTypes.allowsCorrection"),
    state_json: entity
  }), "code"),
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
    state_json: entity
  }), "accounting_date, id"),
  spec("documentLines", "document_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "documentLines.id")),
    document_id: entityUuid(requiredString(entity.documentId, "documentLines.documentId")),
    line_no: requiredNumber(entity.lineNo, "documentLines.lineNo"),
    line_type: requiredString(entity.lineType, "documentLines.lineType"),
    qty: optionalNumber(entity.qty),
    amount_rub: optionalNumber(entity.amountRub),
    payload: entity.payload ?? {},
    state_json: entity
  }), "document_id, line_no"),
  spec("documentVersions", "document_version", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "documentVersions.id")),
    document_id: entityUuid(requiredString(entity.documentId, "documentVersions.documentId")),
    version_no: requiredNumber(entity.versionNo, "documentVersions.versionNo"),
    snapshot: entity.snapshot ?? {},
    reason: requiredString(entity.reason, "documentVersions.reason"),
    created_at: requiredString(entity.createdAt, "documentVersions.createdAt"),
    state_json: entity
  }), "document_id, version_no"),
  spec("documentLinks", "document_link", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "documentLinks.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "documentLinks.organizationId")),
    from_document_id: entityUuid(requiredString(entity.fromDocumentId, "documentLinks.fromDocumentId")),
    to_document_id: entityUuid(requiredString(entity.toDocumentId, "documentLinks.toDocumentId")),
    link_type: requiredString(entity.linkType, "documentLinks.linkType"),
    state_json: entity
  }), "id"),
  spec("journalEntries", "journal_entry", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "journalEntries.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "journalEntries.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "journalEntries.documentId")),
    accounting_date: requiredString(entity.accountingDate, "journalEntries.accountingDate"),
    memo: requiredString(entity.memo, "journalEntries.memo"),
    reversal_of_entry_id: optionalUuid(entity.reversalOfEntryId),
    created_at: requiredString(entity.createdAt, "journalEntries.createdAt"),
    state_json: entity
  }), "accounting_date, id"),
  spec("journalLines", "journal_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "journalLines.id")),
    journal_entry_id: entityUuid(requiredString(entity.journalEntryId, "journalLines.journalEntryId")),
    account_code: requiredString(entity.accountCode, "journalLines.accountCode"),
    debit: requiredNumber(entity.debit, "journalLines.debit"),
    credit: requiredNumber(entity.credit, "journalLines.credit"),
    memo: requiredString(entity.memo, "journalLines.memo"),
    state_json: entity
  }), "journal_entry_id, id"),
  spec("auditEvents", "audit_event", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "auditEvents.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "auditEvents.organizationId")),
    actor_label: requiredString(entity.actorLabel, "auditEvents.actorLabel"),
    entity_type: requiredString(entity.entityType, "auditEvents.entityType"),
    entity_id: stableUuid(requiredString(entity.entityId, "auditEvents.entityId")),
    event_type: requiredString(entity.eventType, "auditEvents.eventType"),
    before_json: entity.before ?? null,
    after_json: entity.after ?? null,
    reason: optionalString(entity.reason),
    created_at: requiredString(entity.createdAt, "auditEvents.createdAt"),
    state_json: entity
  }), "created_at, id"),
  spec("counterparties", "counterparty", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "counterparties.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "counterparties.organizationId")),
    name: requiredString(entity.name, "counterparties.name"),
    counterparty_type: requiredString(entity.counterpartyType, "counterparties.counterpartyType"),
    inn: optionalString(entity.inn),
    country: optionalString(entity.country),
    is_active: requiredBoolean(entity.isActive, "counterparties.isActive"),
    state_json: entity
  }), "name, id"),
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
    comment: optionalString(entity.comment),
    state_json: entity
  }), "sku, id"),
  spec("productAssets", "product_asset", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "productAssets.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "productAssets.organizationId")),
    product_id: entityUuid(requiredString(entity.productId, "productAssets.productId")),
    role: requiredString(entity.role, "productAssets.role"),
    slide_type: optionalString(entity.slideType),
    url: requiredString(entity.url, "productAssets.url"),
    storage_key: requiredString(entity.storageKey, "productAssets.storageKey"),
    status: requiredString(entity.status, "productAssets.status"),
    sort_order: requiredNumber(entity.sortOrder, "productAssets.sortOrder"),
    created_at: requiredString(entity.createdAt, "productAssets.createdAt"),
    state_json: entity
  }), "product_id, sort_order, created_at"),
  spec("warehouses", "warehouse", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "warehouses.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "warehouses.organizationId")),
    name: requiredString(entity.name, "warehouses.name"),
    warehouse_type: requiredString(entity.warehouseType, "warehouses.warehouseType"),
    channel_id: optionalUuid(entity.channelId),
    is_active: requiredBoolean(entity.isActive, "warehouses.isActive"),
    state_json: entity
  }), "name, id"),
  spec("stockStates", "stock_state", ["product_id", "warehouse_id"], (entity) => ({
    product_id: entityUuid(requiredString(entity.productId, "stockStates.productId")),
    warehouse_id: entityUuid(requiredString(entity.warehouseId, "stockStates.warehouseId")),
    qty: requiredNumber(entity.qty, "stockStates.qty"),
    cost_rub: requiredNumber(entity.costRub, "stockStates.costRub"),
    state_json: entity
  }), "product_id, warehouse_id"),
  spec("inventoryLots", "inventory_lot", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "inventoryLots.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "inventoryLots.organizationId")),
    product_id: entityUuid(requiredString(entity.productId, "inventoryLots.productId")),
    warehouse_id: entityUuid(requiredString(entity.warehouseId, "inventoryLots.warehouseId")),
    source_document_id: entityUuid(requiredString(entity.sourceDocumentId, "inventoryLots.sourceDocumentId")),
    source_line_id: optionalUuid(entity.sourceLineId),
    received_at: requiredString(entity.receivedAt, "inventoryLots.receivedAt"),
    qty_initial: requiredNumber(entity.qtyInitial, "inventoryLots.qtyInitial"),
    qty_remaining: requiredNumber(entity.qtyRemaining, "inventoryLots.qtyRemaining"),
    cost_initial_rub: requiredNumber(entity.costInitialRub, "inventoryLots.costInitialRub"),
    cost_remaining_rub: requiredNumber(entity.costRemainingRub, "inventoryLots.costRemainingRub"),
    unit_cost_rub: requiredNumber(entity.unitCostRub, "inventoryLots.unitCostRub"),
    status: requiredString(entity.status, "inventoryLots.status"),
    state_json: entity
  }), "received_at, id"),
  spec("stockMovements", "stock_movement", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "stockMovements.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "stockMovements.organizationId")),
    product_id: entityUuid(requiredString(entity.productId, "stockMovements.productId")),
    warehouse_id: entityUuid(requiredString(entity.warehouseId, "stockMovements.warehouseId")),
    document_id: entityUuid(requiredString(entity.documentId, "stockMovements.documentId")),
    movement_type: requiredString(entity.movementType, "stockMovements.movementType"),
    qty: requiredNumber(entity.qty, "stockMovements.qty"),
    cost_rub: requiredNumber(entity.costRub, "stockMovements.costRub"),
    occurred_at: requiredString(entity.occurredAt, "stockMovements.occurredAt"),
    lot_id: optionalUuid(entity.lotId),
    state_json: entity
  }), "occurred_at, id"),
  spec("costApplications", "cost_application", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "costApplications.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "costApplications.organizationId")),
    source_document_id: entityUuid(requiredString(entity.sourceDocumentId, "costApplications.sourceDocumentId")),
    outbound_document_id: entityUuid(requiredString(entity.outboundDocumentId, "costApplications.outboundDocumentId")),
    product_id: entityUuid(requiredString(entity.productId, "costApplications.productId")),
    from_lot_id: entityUuid(requiredString(entity.fromLotId, "costApplications.fromLotId")),
    qty: requiredNumber(entity.qty, "costApplications.qty"),
    cost_rub: requiredNumber(entity.costRub, "costApplications.costRub"),
    application_type: requiredString(entity.applicationType, "costApplications.applicationType"),
    created_at: requiredString(entity.createdAt, "costApplications.createdAt"),
    state_json: entity
  }), "created_at, id"),
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
    comment: optionalString(entity.comment),
    state_json: entity
  }), "ordered_at, id"),
  spec("purchaseOrderLines", "purchase_order_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "purchaseOrderLines.id")),
    purchase_order_id: entityUuid(requiredString(entity.purchaseOrderId, "purchaseOrderLines.purchaseOrderId")),
    product_id: entityUuid(requiredString(entity.productId, "purchaseOrderLines.productId")),
    line_no: requiredNumber(entity.lineNo, "purchaseOrderLines.lineNo"),
    qty_ordered: requiredNumber(entity.qtyOrdered, "purchaseOrderLines.qtyOrdered"),
    supplier_unit_price: requiredNumber(entity.supplierUnitPrice, "purchaseOrderLines.supplierUnitPrice"),
    supplier_amount: requiredNumber(entity.supplierAmount, "purchaseOrderLines.supplierAmount"),
    line_note: optionalString(entity.lineNote),
    state_json: entity
  }), "purchase_order_id, line_no"),
  spec("cashAccounts", "cash_account", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "cashAccounts.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "cashAccounts.organizationId")),
    name: requiredString(entity.name, "cashAccounts.name"),
    account_code: requiredString(entity.accountCode, "cashAccounts.accountCode"),
    balance_rub: requiredNumber(entity.balanceRub, "cashAccounts.balanceRub"),
    is_active: requiredBoolean(entity.isActive, "cashAccounts.isActive"),
    state_json: entity
  }), "name, id"),
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
    comment: optionalString(entity.comment),
    state_json: entity
  }), "paid_at, id"),
  spec("paymentAllocations", "payment_allocation", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "paymentAllocations.id")),
    payment_id: entityUuid(requiredString(entity.paymentId, "paymentAllocations.paymentId")),
    allocation_purpose: requiredString(entity.allocationPurpose, "paymentAllocations.allocationPurpose"),
    purchase_order_id: optionalUuid(entity.purchaseOrderId),
    document_id: optionalUuid(entity.documentId),
    amount_rub: requiredNumber(entity.amountRub, "paymentAllocations.amountRub"),
    state_json: entity
  }), "payment_id, id"),
  spec("settlementEntries", "settlement_entry", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "settlementEntries.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "settlementEntries.organizationId")),
    counterparty_id: optionalUuid(entity.counterpartyId),
    channel_id: optionalUuid(entity.channelId),
    document_id: entityUuid(requiredString(entity.documentId, "settlementEntries.documentId")),
    settlement_type: requiredString(entity.settlementType, "settlementEntries.settlementType"),
    debit_rub: requiredNumber(entity.debitRub, "settlementEntries.debitRub"),
    credit_rub: requiredNumber(entity.creditRub, "settlementEntries.creditRub"),
    created_at: requiredString(entity.createdAt, "settlementEntries.createdAt"),
    state_json: entity
  }), "created_at, id"),
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
    manual_cost_reason: optionalString(entity.manualCostReason),
    state_json: entity
  }), "receipt_date, id"),
  spec("goodsReceiptLines", "goods_receipt_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "goodsReceiptLines.id")),
    goods_receipt_id: entityUuid(requiredString(entity.goodsReceiptId, "goodsReceiptLines.goodsReceiptId")),
    purchase_order_line_id: entityUuid(requiredString(entity.purchaseOrderLineId, "goodsReceiptLines.purchaseOrderLineId")),
    product_id: entityUuid(requiredString(entity.productId, "goodsReceiptLines.productId")),
    qty_received: requiredNumber(entity.qtyReceived, "goodsReceiptLines.qtyReceived"),
    supplier_amount_basis: requiredNumber(entity.supplierAmountBasis, "goodsReceiptLines.supplierAmountBasis"),
    allocated_goods_cost_rub: requiredNumber(entity.allocatedGoodsCostRub, "goodsReceiptLines.allocatedGoodsCostRub"),
    unit_cost_rub: requiredNumber(entity.unitCostRub, "goodsReceiptLines.unitCostRub"),
    state_json: entity
  }), "goods_receipt_id, id"),
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
    state_json: entity
  }), "cost_date, id"),
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
    sold_cost_amount_rub: requiredNumber(entity.soldCostAmountRub, "procurementCostLines.soldCostAmountRub"),
    state_json: entity
  }), "procurement_cost_id, id"),
  spec("shortageResolutions", "shortage_resolution", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "shortageResolutions.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "shortageResolutions.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "shortageResolutions.documentId")),
    purchase_order_id: entityUuid(requiredString(entity.purchaseOrderId, "shortageResolutions.purchaseOrderId")),
    status: requiredString(entity.status, "shortageResolutions.status"),
    reason: requiredString(entity.reason, "shortageResolutions.reason"),
    resolved_at: requiredString(entity.resolvedAt, "shortageResolutions.resolvedAt"),
    state_json: entity
  }), "resolved_at, id"),
  spec("shortageResolutionLines", "shortage_resolution_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "shortageResolutionLines.id")),
    shortage_resolution_id: entityUuid(requiredString(entity.shortageResolutionId, "shortageResolutionLines.shortageResolutionId")),
    purchase_order_line_id: entityUuid(requiredString(entity.purchaseOrderLineId, "shortageResolutionLines.purchaseOrderLineId")),
    product_id: entityUuid(requiredString(entity.productId, "shortageResolutionLines.productId")),
    qty_shortage: requiredNumber(entity.qtyShortage, "shortageResolutionLines.qtyShortage"),
    paid_share_rub: requiredNumber(entity.paidShareRub, "shortageResolutionLines.paidShareRub"),
    action: requiredString(entity.action, "shortageResolutionLines.action"),
    state_json: entity
  }), "shortage_resolution_id, id"),
  spec("supplierClaims", "supplier_claim", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "supplierClaims.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "supplierClaims.organizationId")),
    shortage_resolution_line_id: entityUuid(requiredString(entity.shortageResolutionLineId, "supplierClaims.shortageResolutionLineId")),
    supplier_id: entityUuid(requiredString(entity.supplierId, "supplierClaims.supplierId")),
    amount_rub: requiredNumber(entity.amountRub, "supplierClaims.amountRub"),
    status: requiredString(entity.status, "supplierClaims.status"),
    state_json: entity
  }), "id"),
  spec("stockTransfers", "stock_transfer", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "stockTransfers.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "stockTransfers.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "stockTransfers.documentId")),
    from_warehouse_id: entityUuid(requiredString(entity.fromWarehouseId, "stockTransfers.fromWarehouseId")),
    to_warehouse_id: entityUuid(requiredString(entity.toWarehouseId, "stockTransfers.toWarehouseId")),
    status: requiredString(entity.status, "stockTransfers.status"),
    transfer_date: requiredString(entity.transferDate, "stockTransfers.transferDate"),
    state_json: entity
  }), "transfer_date, id"),
  spec("stockTransferLines", "stock_transfer_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "stockTransferLines.id")),
    stock_transfer_id: entityUuid(requiredString(entity.stockTransferId, "stockTransferLines.stockTransferId")),
    product_id: entityUuid(requiredString(entity.productId, "stockTransferLines.productId")),
    qty: requiredNumber(entity.qty, "stockTransferLines.qty"),
    cost_rub: requiredNumber(entity.costRub, "stockTransferLines.costRub"),
    state_json: entity
  }), "stock_transfer_id, id"),
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
    updated_at: requiredString(entity.updatedAt, "pluginStateRecords.updatedAt"),
    state_json: entity
  }), "plugin_code, namespace, scope_type, scope_id, state_key"),
  spec("integrationPlugins", "integration_plugin", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "integrationPlugins.id")),
    code: requiredString(entity.code, "integrationPlugins.code"),
    display_name: requiredString(entity.displayName, "integrationPlugins.displayName"),
    status: requiredString(entity.status, "integrationPlugins.status"),
    state_json: entity
  }), "code"),
  spec("salesChannels", "sales_channel", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "salesChannels.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "salesChannels.organizationId")),
    name: requiredString(entity.name, "salesChannels.name"),
    channel_type: requiredString(entity.channelType, "salesChannels.channelType"),
    plugin_id: optionalUuid(entity.pluginId),
    sales_point_warehouse_id: entityUuid(requiredString(entity.salesPointWarehouseId, "salesChannels.salesPointWarehouseId")),
    clearing_account_code: requiredString(entity.clearingAccountCode, "salesChannels.clearingAccountCode"),
    status: requiredString(entity.status, "salesChannels.status"),
    state_json: entity
  }), "name, id"),
  spec("externalProducts", "external_product", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "externalProducts.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "externalProducts.organizationId")),
    channel_id: entityUuid(requiredString(entity.channelId, "externalProducts.channelId")),
    external_sku: requiredString(entity.externalSku, "externalProducts.externalSku"),
    external_name: requiredString(entity.externalName, "externalProducts.externalName"),
    image_url: optionalString(entity.imageUrl),
    status: requiredString(entity.status, "externalProducts.status"),
    state_json: entity
  }), "external_sku, id"),
  spec("productExternalLinks", "product_external_link", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "productExternalLinks.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "productExternalLinks.organizationId")),
    product_id: entityUuid(requiredString(entity.productId, "productExternalLinks.productId")),
    external_product_id: entityUuid(requiredString(entity.externalProductId, "productExternalLinks.externalProductId")),
    channel_id: entityUuid(requiredString(entity.channelId, "productExternalLinks.channelId")),
    status: requiredString(entity.status, "productExternalLinks.status"),
    state_json: entity
  }), "id"),
  spec("syncRuns", "sync_run", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "syncRuns.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "syncRuns.organizationId")),
    channel_id: entityUuid(requiredString(entity.channelId, "syncRuns.channelId")),
    status: requiredString(entity.status, "syncRuns.status"),
    started_at: requiredString(entity.startedAt, "syncRuns.startedAt"),
    finished_at: optionalString(entity.finishedAt),
    stats: entity.stats ?? {},
    state_json: entity
  }), "started_at, id"),
  spec("externalEvents", "external_event", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "externalEvents.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "externalEvents.organizationId")),
    channel_id: entityUuid(requiredString(entity.channelId, "externalEvents.channelId")),
    event_type: requiredString(entity.eventType, "externalEvents.eventType"),
    external_id: requiredString(entity.externalId, "externalEvents.externalId"),
    occurred_at: requiredString(entity.occurredAt, "externalEvents.occurredAt"),
    raw_payload: entity.rawPayload ?? {},
    normalized_payload: entity.normalizedPayload ?? {},
    status: requiredString(entity.status, "externalEvents.status"),
    materialized_document_id: optionalUuid(entity.materializedDocumentId),
    state_json: entity
  }), "occurred_at, id"),
  spec("observedStocks", "observed_stock", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "observedStocks.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "observedStocks.organizationId")),
    channel_id: entityUuid(requiredString(entity.channelId, "observedStocks.channelId")),
    external_product_id: entityUuid(requiredString(entity.externalProductId, "observedStocks.externalProductId")),
    product_id: optionalUuid(entity.productId),
    warehouse_id: optionalUuid(entity.warehouseId),
    observed_at: requiredString(entity.observedAt, "observedStocks.observedAt"),
    qty_observed: requiredNumber(entity.qtyObserved, "observedStocks.qtyObserved"),
    location_status: requiredString(entity.locationStatus, "observedStocks.locationStatus"),
    state_json: entity
  }), "observed_at, id"),
  spec("sales", "sale", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "sales.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "sales.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "sales.documentId")),
    channel_id: entityUuid(requiredString(entity.channelId, "sales.channelId")),
    sale_date: requiredString(entity.saleDate, "sales.saleDate"),
    external_event_id: optionalUuid(entity.externalEventId),
    gross_amount_rub: requiredNumber(entity.grossAmountRub, "sales.grossAmountRub"),
    status: requiredString(entity.status, "sales.status"),
    state_json: entity
  }), "sale_date, id"),
  spec("saleLines", "sale_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "saleLines.id")),
    sale_id: entityUuid(requiredString(entity.saleId, "saleLines.saleId")),
    product_id: entityUuid(requiredString(entity.productId, "saleLines.productId")),
    qty: requiredNumber(entity.qty, "saleLines.qty"),
    price_rub: requiredNumber(entity.priceRub, "saleLines.priceRub"),
    revenue_rub: requiredNumber(entity.revenueRub, "saleLines.revenueRub"),
    cost_rub: requiredNumber(entity.costRub, "saleLines.costRub"),
    state_json: entity
  }), "sale_id, id"),
  spec("salesReturns", "sales_return", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "salesReturns.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "salesReturns.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "salesReturns.documentId")),
    sale_id: entityUuid(requiredString(entity.saleId, "salesReturns.saleId")),
    channel_id: entityUuid(requiredString(entity.channelId, "salesReturns.channelId")),
    return_date: requiredString(entity.returnDate, "salesReturns.returnDate"),
    refund_rub: requiredNumber(entity.refundRub, "salesReturns.refundRub"),
    restored_cost_rub: requiredNumber(entity.restoredCostRub, "salesReturns.restoredCostRub"),
    state_json: entity
  }), "return_date, id"),
  spec("payouts", "payout", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "payouts.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "payouts.organizationId")),
    channel_id: entityUuid(requiredString(entity.channelId, "payouts.channelId")),
    document_id: entityUuid(requiredString(entity.documentId, "payouts.documentId")),
    payment_id: entityUuid(requiredString(entity.paymentId, "payouts.paymentId")),
    payout_date: requiredString(entity.payoutDate, "payouts.payoutDate"),
    gross_events_rub: requiredNumber(entity.grossEventsRub, "payouts.grossEventsRub"),
    bank_receipt_rub: requiredNumber(entity.bankReceiptRub, "payouts.bankReceiptRub"),
    difference_rub: requiredNumber(entity.differenceRub, "payouts.differenceRub"),
    status: requiredString(entity.status, "payouts.status"),
    state_json: entity
  }), "payout_date, id"),
  spec("channelFinanceEvents", "channel_finance_event", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "channelFinanceEvents.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "channelFinanceEvents.organizationId")),
    channel_id: entityUuid(requiredString(entity.channelId, "channelFinanceEvents.channelId")),
    external_event_id: optionalUuid(entity.externalEventId),
    document_id: entityUuid(requiredString(entity.documentId, "channelFinanceEvents.documentId")),
    payout_id: optionalUuid(entity.payoutId),
    event_kind: requiredString(entity.eventKind, "channelFinanceEvents.eventKind"),
    amount_rub: requiredNumber(entity.amountRub, "channelFinanceEvents.amountRub"),
    occurred_at: requiredString(entity.occurredAt, "channelFinanceEvents.occurredAt"),
    state_json: entity
  }), "occurred_at, id"),
  spec("payoutLines", "payout_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "payoutLines.id")),
    payout_id: entityUuid(requiredString(entity.payoutId, "payoutLines.payoutId")),
    channel_finance_event_id: optionalUuid(entity.channelFinanceEventId),
    sale_id: optionalUuid(entity.saleId),
    amount_rub: requiredNumber(entity.amountRub, "payoutLines.amountRub"),
    state_json: entity
  }), "payout_id, id"),
  spec("expenseCategories", "expense_category", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "expenseCategories.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "expenseCategories.organizationId")),
    name: requiredString(entity.name, "expenseCategories.name"),
    account_code: requiredString(entity.accountCode, "expenseCategories.accountCode"),
    state_json: entity
  }), "name, id"),
  spec("operatingExpenses", "operating_expense", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "operatingExpenses.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "operatingExpenses.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "operatingExpenses.documentId")),
    category_id: entityUuid(requiredString(entity.categoryId, "operatingExpenses.categoryId")),
    payment_id: entityUuid(requiredString(entity.paymentId, "operatingExpenses.paymentId")),
    expense_date: requiredString(entity.expenseDate, "operatingExpenses.expenseDate"),
    amount_rub: requiredNumber(entity.amountRub, "operatingExpenses.amountRub"),
    comment: optionalString(entity.comment),
    state_json: entity
  }), "expense_date, id"),
  spec("ownerTransactions", "owner_transaction", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "ownerTransactions.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "ownerTransactions.organizationId")),
    document_id: entityUuid(requiredString(entity.documentId, "ownerTransactions.documentId")),
    payment_id: entityUuid(requiredString(entity.paymentId, "ownerTransactions.paymentId")),
    transaction_type: requiredString(entity.transactionType, "ownerTransactions.transactionType"),
    amount_rub: requiredNumber(entity.amountRub, "ownerTransactions.amountRub"),
    state_json: entity
  }), "id"),
  spec("stocktakes", "stocktake", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "stocktakes.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "stocktakes.organizationId")),
    warehouse_id: entityUuid(requiredString(entity.warehouseId, "stocktakes.warehouseId")),
    document_id: entityUuid(requiredString(entity.documentId, "stocktakes.documentId")),
    stocktake_date: requiredString(entity.stocktakeDate, "stocktakes.stocktakeDate"),
    status: requiredString(entity.status, "stocktakes.status"),
    state_json: entity
  }), "stocktake_date, id"),
  spec("stocktakeLines", "stocktake_line", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "stocktakeLines.id")),
    stocktake_id: entityUuid(requiredString(entity.stocktakeId, "stocktakeLines.stocktakeId")),
    product_id: entityUuid(requiredString(entity.productId, "stocktakeLines.productId")),
    book_qty: requiredNumber(entity.bookQty, "stocktakeLines.bookQty"),
    observed_qty: requiredNumber(entity.observedQty, "stocktakeLines.observedQty"),
    difference_qty: requiredNumber(entity.differenceQty, "stocktakeLines.differenceQty"),
    book_cost_rub: requiredNumber(entity.bookCostRub, "stocktakeLines.bookCostRub"),
    adjustment_cost_rub: requiredNumber(entity.adjustmentCostRub, "stocktakeLines.adjustmentCostRub"),
    state_json: entity
  }), "stocktake_id, id"),
  spec("correctionCases", "correction_case", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "correctionCases.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "correctionCases.organizationId")),
    source_document_id: entityUuid(requiredString(entity.sourceDocumentId, "correctionCases.sourceDocumentId")),
    correction_type: requiredString(entity.correctionType, "correctionCases.correctionType"),
    reason: requiredString(entity.reason, "correctionCases.reason"),
    status: requiredString(entity.status, "correctionCases.status"),
    impact_summary: entity.impactSummary ?? {},
    created_at: requiredString(entity.createdAt, "correctionCases.createdAt"),
    applied_at: optionalString(entity.appliedAt),
    state_json: entity
  }), "created_at, id"),
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
    created_at: requiredString(entity.createdAt, "recalculationJobs.createdAt"),
    state_json: entity
  }), "created_at, id"),
  spec("reportSnapshots", "report_snapshot", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "reportSnapshots.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "reportSnapshots.organizationId")),
    period_id: optionalUuid(entity.periodId),
    report_type: requiredString(entity.reportType, "reportSnapshots.reportType"),
    payload: entity.payload ?? {},
    created_at: requiredString(entity.createdAt, "reportSnapshots.createdAt"),
    state_json: entity
  }), "created_at, id"),
  spec("backfillProjects", "backfill_project", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "backfillProjects.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "backfillProjects.organizationId")),
    name: requiredString(entity.name, "backfillProjects.name"),
    status: requiredString(entity.status, "backfillProjects.status"),
    payload: entity.payload ?? {},
    created_at: requiredString(entity.createdAt, "backfillProjects.createdAt"),
    state_json: entity
  }), "created_at, id"),
  spec("backfillItems", "backfill_item", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "backfillItems.id")),
    backfill_project_id: entityUuid(requiredString(entity.backfillProjectId, "backfillItems.backfillProjectId")),
    item_type: requiredString(entity.itemType, "backfillItems.itemType"),
    payload: entity.payload ?? {},
    status: requiredString(entity.status, "backfillItems.status"),
    state_json: entity
  }), "backfill_project_id, id"),
  spec("users", "user_account", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "users.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "users.organizationId")),
    email: requiredString(entity.email, "users.email"),
    name: requiredString(entity.name, "users.name"),
    status: requiredString(entity.status, "users.status"),
    state_json: entity
  }), "email, id"),
  spec("roles", "role", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "roles.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "roles.organizationId")),
    code: requiredString(entity.code, "roles.code"),
    name: requiredString(entity.name, "roles.name"),
    state_json: entity
  }), "code, id"),
  spec("agentTokens", "agent_token", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "agentTokens.id")),
    organization_id: entityUuid(requiredString(entity.organizationId, "agentTokens.organizationId")),
    name: requiredString(entity.name, "agentTokens.name"),
    status: requiredString(entity.status, "agentTokens.status"),
    scopes: JSON.stringify(entity.scopes ?? []),
    state_json: entity
  }), "name, id"),
  spec("channelAgentPermissions", "channel_agent_permission", ["id"], (entity) => ({
    id: entityUuid(requiredString(entity.id, "channelAgentPermissions.id")),
    agent_token_id: entityUuid(requiredString(entity.agentTokenId, "channelAgentPermissions.agentTokenId")),
    channel_id: entityUuid(requiredString(entity.channelId, "channelAgentPermissions.channelId")),
    permission_code: requiredString(entity.permissionCode, "channelAgentPermissions.permissionCode"),
    state_json: entity
  }), "id")
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

  async loadApp(): Promise<AccountingApp> {
    await this.init();
    const session = await this.openReadSession();
    try {
      restoreIdSequence(session.nextId);
      return session.app;
    } finally {
      await session.close?.();
    }
  }

  async save(app: AccountingApp, workspaceId = DEFAULT_WORKSPACE_ID): Promise<void> {
    await this.init();
    const scope = normalizeWorkspaceId(workspaceId);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(WRITE_LOCK_SQL);
      await this.saveState(client, scope, app.state, app.exportChannelCredentials(), currentIdSequence(), app.exportPluginSecrets());
      await client.query("commit");
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
    const snapshot = await this.loadSnapshot(this.pool, scope);
    snapshot.app.externalEvents = new PostgresExternalEventStore(this.pool, scope);
    snapshot.app.observedStocks = new PostgresObservedStockStore(this.pool, scope);
    snapshot.app.syncRuns = new PostgresSyncRunStore(this.pool, scope);
    return {
      app: snapshot.app,
      nextId: snapshot.nextId,
      close: async () => undefined
    };
  }

  async openWriteSession(workspaceId = DEFAULT_WORKSPACE_ID): Promise<RuntimeSession> {
    await this.init();
    const scope = normalizeWorkspaceId(workspaceId);
    const client = await this.pool.connect();
    await client.query("begin");
    await client.query(WRITE_LOCK_SQL);
    const snapshot = await this.loadSnapshot(client, scope);
    restoreIdSequence(snapshot.nextId);
    const app = snapshot.app;
    app.externalEvents = new PostgresExternalEventStore(client, scope);
    app.observedStocks = new PostgresObservedStockStore(client, scope);
    app.syncRuns = new PostgresSyncRunStore(client, scope);
    const baseline = snapshot.baseline;
    let finished = false;

    const finalize = async (mode: "commit" | "rollback") => {
      if (finished) return;
      try {
        if (mode === "commit") {
          await app.flushPendingExternalEventUpdates();
          await this.saveState(client, scope, app.state, app.exportChannelCredentials(), currentIdSequence(), app.exportPluginSecrets(), baseline);
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
      nextId: snapshot.nextId,
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
    await this.pool.query(SCHEMA_ALTERS);
    await this.pool.query(STATE_JSON_ALTERS);
    await this.pool.query(WORKSPACE_ALTERS);
    await this.migrateLegacyState();
  }

  private async migrateLegacyState() {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(WRITE_LOCK_SQL);
      const configured = await this.hasNormalizedData(client);
      if (!configured) {
        const legacy = await this.loadLegacyState(client);
        if (legacy) {
          await this.saveState(client, DEFAULT_WORKSPACE_ID, legacy.state, legacy.credentials, legacy.nextId);
        } else {
          await this.saveMeta(client, 1);
        }
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

  private async loadSnapshot(source: Queryable, workspaceId: string): Promise<{ app: AccountingApp; nextId: number; baseline: PreparedStateSnapshot }> {
    const state = createEmptyState();

    state.organization = await this.loadSingleton(source, workspaceId, "organization") as AccountingState["organization"];
    state.accountingPolicy = await this.loadSingleton(source, workspaceId, "accounting_policy") as AccountingState["accountingPolicy"];

    for (const table of TABLES) {
      if (SNAPSHOT_APPEND_ONLY.has(table.collection)) continue;
      const tableWorkspaceId = workspaceIdForTable(table, workspaceId);
      const rows = await source.query<{ state_json: unknown }>(
        `select state_json from ${table.table} where workspace_id = $1${table.orderBy ? ` order by ${table.orderBy}` : ""}`,
        [tableWorkspaceId]
      );
      state[table.collection] = rows.rows.map((row) => hydrateEntity(row.state_json)) as never;
    }

    const meta = await this.loadMeta(source);
    const nextId = Math.max(meta?.next_id ?? 1, inferNextIdFromState(state));

    const baseline = prepareStateSnapshot(state, workspaceId);
    const app = new AccountingApp(state);
    app.importChannelCredentials(await this.loadChannelCredentials(source, workspaceId));
    app.importPluginSecrets(await this.loadPluginSecrets(source, workspaceId));
    return { app, nextId, baseline };
  }

  private async loadSingleton(source: Queryable, workspaceId: string, table: "organization" | "accounting_policy") {
    const result = await source.query<{ state_json: unknown }>(
      `select state_json from ${table} where workspace_id = $1 order by id limit 1`,
      [workspaceId]
    );
    return result.rows[0] ? hydrateEntity(result.rows[0].state_json) : undefined;
  }

  private async loadMeta(source: Queryable) {
    const result = await source.query<RuntimeMetaRow>(
      "select next_id, singletons from accounting_runtime_meta where key = $1",
      [RUNTIME_ROW_KEY]
    );
    return result.rows[0];
  }

  private async saveState(
    client: PoolClient,
    workspaceId: string,
    state: AccountingState,
    credentials: ChannelCredentials,
    nextId: number,
    pluginSecrets: PluginSecretRecords = {},
    baseline?: PreparedStateSnapshot
  ) {
    const preparedState = prepareStateSnapshot(state, workspaceId);
    const prepared = preparedState.tables;

    if (!state.organization && !state.accountingPolicy) {
      await this.saveChannelCredentials(client, workspaceId, credentials);
      await this.savePluginSecrets(client, workspaceId, undefined, pluginSecrets);
      for (const entry of [...prepared].reverse()) {
        if (SNAPSHOT_APPEND_ONLY.has(entry.table.collection)) continue;
        await deleteObsoleteRows(client, workspaceId, entry.table, [], baseline?.tablesByCollection.get(entry.table.collection)?.rows);
      }
      if (!baseline || baseline.accountingPolicy) await this.saveSingleton(client, workspaceId, "accounting_policy", undefined);
      if (!baseline || baseline.organization) await this.saveSingleton(client, workspaceId, "organization", undefined);
      await this.saveMeta(client, nextId);
      return;
    }

    if (!state.accountingPolicy && (!baseline || baseline.accountingPolicy)) {
      await this.saveSingleton(client, workspaceId, "accounting_policy", undefined);
    }
    if (!state.organization && (!baseline || baseline.organization)) {
      await this.saveSingleton(client, workspaceId, "organization", undefined);
    }
    if (state.organization && (!baseline || preparedState.organizationSignature !== baseline.organizationSignature)) {
      await this.saveSingleton(client, workspaceId, "organization", state.organization as unknown as RuntimeEntity);
    }
    if (state.accountingPolicy && (!baseline || preparedState.accountingPolicySignature !== baseline.accountingPolicySignature)) {
      await this.saveSingleton(client, workspaceId, "accounting_policy", state.accountingPolicy as unknown as RuntimeEntity);
    }

    for (const entry of prepared) {
      const baselineEntry = baseline?.tablesByCollection.get(entry.table.collection);
      for (const row of entry.rows) {
        const rowKey = rowKeyFromValues(entry.table.keyColumns, row);
        const nextSignature = rowSignature(row);
        if (baselineEntry?.signatureByKey.get(rowKey) === nextSignature) continue;
        await upsertRow(client, entry.table.table, entry.table.keyColumns, row);
      }
    }

    for (const entry of [...prepared].reverse()) {
      if (SNAPSHOT_APPEND_ONLY.has(entry.table.collection)) continue;
      await deleteObsoleteRows(client, workspaceId, entry.table, entry.rows, baseline?.tablesByCollection.get(entry.table.collection)?.rows);
    }

    await this.saveChannelCredentials(client, workspaceId, credentials);
    await this.savePluginSecrets(client, workspaceId, state.organization?.id, pluginSecrets);
    await this.saveMeta(client, nextId);
  }

  private async saveSingleton(client: PoolClient, workspaceId: string, table: "organization" | "accounting_policy", entity: RuntimeEntity | undefined) {
    if (!entity) {
      await client.query(`delete from ${table} where workspace_id = $1`, [workspaceId]);
      return;
    }

    const row = table === "organization"
      ? {
          id: entityUuid(requiredString(entity.id, "organization.id")),
          display_name: requiredString(entity.displayName, "organization.displayName"),
          legal_form: requiredString(entity.legalForm, "organization.legalForm"),
          timezone: requiredString(entity.timezone, "organization.timezone"),
          tax_mode: requiredString(entity.taxMode, "organization.taxMode"),
          created_at: requiredString(entity.createdAt, "organization.createdAt"),
          workspace_id: workspaceId,
          state_json: entity
        }
      : {
          id: entityUuid(requiredString(entity.id, "accountingPolicy.id")),
          organization_id: entityUuid(requiredString(entity.organizationId, "accountingPolicy.organizationId")),
          accounting_start_date: requiredString(entity.accountingStartDate, "accountingPolicy.accountingStartDate"),
          cost_method: requiredString(entity.costMethod, "accountingPolicy.costMethod"),
          accounting_currency: requiredString(entity.accountingCurrency, "accountingPolicy.accountingCurrency"),
          workspace_id: workspaceId,
          state_json: entity
        };

    await upsertRow(client, table, ["id"], row);
    const result = await client.query<{ id: string }>(`select id from ${table} where workspace_id = $1`, [workspaceId]);
    const currentIds = new Set([String(row.id)]);
    for (const candidate of result.rows) {
      if (!currentIds.has(candidate.id)) {
        await client.query(`delete from ${table} where id = $1 and workspace_id = $2`, [candidate.id, workspaceId]);
      }
    }
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
        sales_channel.state_json->>'id' as public_channel_id,
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

  private async loadLegacyState(client: PoolClient) {
    const entityState = await this.loadLegacyEntityStore(client);
    if (entityState) return entityState;
    return await this.loadLegacySnapshot(client);
  }

  private async loadLegacyEntityStore(client: PoolClient) {
    const tableExists = await client.query<{ exists: boolean }>(
      "select to_regclass('public.accounting_runtime_entity') is not null as exists"
    );
    if (!tableExists.rows[0]?.exists) return undefined;

    const meta = await this.loadMeta(client);
    const rows = await client.query<{ collection: RuntimeCollectionName; data: unknown }>(
      "select collection, data from accounting_runtime_entity"
    );
    if (rows.rowCount === 0 && !(meta?.singletons && Object.keys((meta.singletons as Record<string, unknown>) ?? {}).length > 0)) {
      return undefined;
    }

    const state = hydrateState(meta?.singletons);
    for (const row of rows.rows) {
      if (!COLLECTIONS.includes(row.collection)) continue;
      state[row.collection].push(hydrateEntity(row.data) as never);
    }

    return {
      state,
      nextId: Math.max(meta?.next_id ?? 1, inferNextIdFromState(state)),
      credentials: await this.loadLegacyRuntimeCredentials(client)
    };
  }

  private async loadLegacySnapshot(client: PoolClient) {
    const tableExists = await client.query<{ exists: boolean }>(
      "select to_regclass('public.accounting_runtime_snapshot') is not null as exists"
    );
    if (!tableExists.rows[0]?.exists) return undefined;

    const result = await client.query<{
      state: unknown;
      next_id: number;
      encrypted_channel_credentials: unknown;
    }>(
      "select state, next_id, encrypted_channel_credentials from accounting_runtime_snapshot where key = $1",
      [RUNTIME_ROW_KEY]
    );
    if (result.rowCount === 0) return undefined;

    const row = result.rows[0];
    const state = hydrateState(row.state);
    return {
      state,
      nextId: Math.max(row.next_id ?? 1, inferNextIdFromState(state)),
      credentials: this.decryptCredentialMap(row.encrypted_channel_credentials)
    };
  }

  private async loadLegacyRuntimeCredentials(source: Queryable): Promise<ChannelCredentials> {
    const exists = await source.query<{ exists: boolean }>(
      "select to_regclass('public.accounting_runtime_channel_credential') is not null as exists"
    );
    if (!exists.rows[0]?.exists) return {};
    const result = await source.query<{ channel_id: string; encrypted_credentials: unknown }>(
      "select channel_id, encrypted_credentials from accounting_runtime_channel_credential"
    );
    return Object.fromEntries(
      result.rows.map((row) => [row.channel_id, this.decryptCredentials(row.encrypted_credentials)])
    ) as ChannelCredentials;
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

  private decryptCredentialMap(payload: unknown): ChannelCredentials {
    return this.decryptPayload<ChannelCredentials>(payload) ?? {};
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
 * Чтение — по state_json (источник истины); запись — через тот же spec-сериализатор, что и snapshot.
 * Инжектится в сессию (read: pool, write: транзакционный client). См. SNAPSHOT_APPEND_ONLY.
 */
export class PostgresExternalEventStore implements ExternalEventStore {
  constructor(private readonly q: Queryable, private readonly workspaceId: string) {}

  async getById(id: ID): Promise<ExternalEvent | undefined> {
    const result = await this.q.query<{ state_json: ExternalEvent }>(
      "select state_json from external_event where workspace_id = $1 and state_json->>'id' = $2 limit 1",
      [this.workspaceId, id]
    );
    return result.rows[0]?.state_json;
  }

  async findByIdentity(channelId: ID, externalId: string, idempotencyKey?: string): Promise<ExternalEvent | undefined> {
    const result = await this.q.query<{ state_json: ExternalEvent }>(
      `select state_json from external_event
       where workspace_id = $1 and state_json->>'channelId' = $2
         and (external_id = $3 or state_json->>'idempotencyKey' = $4)
       order by (state_json->>'idempotencyKey' = $4) desc
       limit 1`,
      [this.workspaceId, channelId, externalId, idempotencyKey ?? externalId]
    );
    return result.rows[0]?.state_json;
  }

  async list(filter: ExternalEventListFilter = {}): Promise<ExternalEvent[]> {
    const conditions = ["workspace_id = $1"];
    const params: unknown[] = [this.workspaceId];
    if (filter.channelId) {
      params.push(filter.channelId);
      conditions.push(`state_json->>'channelId' = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.eventType) {
      params.push(filter.eventType);
      conditions.push(`event_type = $${params.length}`);
    }
    const result = await this.q.query<{ state_json: ExternalEvent }>(
      `select state_json from external_event where ${conditions.join(" and ")} order by occurred_at, id`,
      params
    );
    return result.rows.map((row) => row.state_json);
  }

  async count(filter: { channelId?: ID; status?: string } = {}): Promise<number> {
    const conditions = ["workspace_id = $1"];
    const params: unknown[] = [this.workspaceId];
    if (filter.channelId) {
      params.push(filter.channelId);
      conditions.push(`state_json->>'channelId' = $${params.length}`);
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
    const row = { ...externalEventTableSpec.serialize(event as unknown as RuntimeEntity), workspace_id: this.workspaceId } as RowRecord;
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
    await this.q.query("delete from external_event where workspace_id = $1 and state_json->>'id' = any($2)", [this.workspaceId, ids]);
  }
}

const observedStockTableSpec = TABLES.find((table) => table.collection === "observedStocks")!;

/** Postgres-реализация ObservedStockStore: остатки в таблице observed_stock, вне snapshot. */
export class PostgresObservedStockStore implements ObservedStockStore {
  constructor(private readonly q: Queryable, private readonly workspaceId: string) {}

  async getById(id: ID): Promise<ObservedStock | undefined> {
    const result = await this.q.query<{ state_json: ObservedStock }>(
      "select state_json from observed_stock where workspace_id = $1 and state_json->>'id' = $2 limit 1",
      [this.workspaceId, id]
    );
    return result.rows[0]?.state_json;
  }

  async findByKey(channelId: ID, externalProductId: ID, warehouseId: ID | undefined, observedAt: string): Promise<ObservedStock | undefined> {
    const result = await this.q.query<{ state_json: ObservedStock }>(
      `select state_json from observed_stock
       where workspace_id = $1 and state_json->>'channelId' = $2 and state_json->>'externalProductId' = $3
         and state_json->>'observedAt' = $4 and (state_json->>'warehouseId') is not distinct from $5
       limit 1`,
      [this.workspaceId, channelId, externalProductId, observedAt, warehouseId ?? null]
    );
    return result.rows[0]?.state_json;
  }

  async list(filter: ObservedStockListFilter = {}): Promise<ObservedStock[]> {
    const conditions = ["workspace_id = $1"];
    const params: unknown[] = [this.workspaceId];
    if (filter.channelId) {
      params.push(filter.channelId);
      conditions.push(`state_json->>'channelId' = $${params.length}`);
    }
    if (filter.externalProductId) {
      params.push(filter.externalProductId);
      conditions.push(`state_json->>'externalProductId' = $${params.length}`);
    }
    const result = await this.q.query<{ state_json: ObservedStock }>(
      `select state_json from observed_stock where ${conditions.join(" and ")} order by observed_at, id`,
      params
    );
    return result.rows.map((row) => row.state_json);
  }

  async count(filter: { channelId?: ID } = {}): Promise<number> {
    const conditions = ["workspace_id = $1"];
    const params: unknown[] = [this.workspaceId];
    if (filter.channelId) {
      params.push(filter.channelId);
      conditions.push(`state_json->>'channelId' = $${params.length}`);
    }
    const result = await this.q.query<{ count: string }>(
      `select count(*)::text as count from observed_stock where ${conditions.join(" and ")}`,
      params
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async upsert(observed: ObservedStock): Promise<void> {
    const row = { ...observedStockTableSpec.serialize(observed as unknown as RuntimeEntity), workspace_id: this.workspaceId } as RowRecord;
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
    await this.q.query("delete from observed_stock where workspace_id = $1 and state_json->>'id' = any($2)", [this.workspaceId, ids]);
  }
}

const syncRunTableSpec = TABLES.find((table) => table.collection === "syncRuns")!;

/** Postgres-реализация SyncRunStore: запуски синхронизации в таблице sync_run, вне snapshot. */
export class PostgresSyncRunStore implements SyncRunStore {
  constructor(private readonly q: Queryable, private readonly workspaceId: string) {}

  async getById(id: ID): Promise<SyncRun | undefined> {
    const result = await this.q.query<{ state_json: SyncRun }>(
      "select state_json from sync_run where workspace_id = $1 and state_json->>'id' = $2 limit 1",
      [this.workspaceId, id]
    );
    return result.rows[0]?.state_json;
  }

  async listAll(): Promise<SyncRun[]> {
    const result = await this.q.query<{ state_json: SyncRun }>(
      "select state_json from sync_run where workspace_id = $1 order by started_at, id",
      [this.workspaceId]
    );
    return result.rows.map((row) => row.state_json);
  }

  async listByChannel(channelId: ID): Promise<SyncRun[]> {
    const result = await this.q.query<{ state_json: SyncRun }>(
      "select state_json from sync_run where workspace_id = $1 and state_json->>'channelId' = $2 order by started_at, id",
      [this.workspaceId, channelId]
    );
    return result.rows.map((row) => row.state_json);
  }

  async upsert(run: SyncRun): Promise<void> {
    const row = { ...syncRunTableSpec.serialize(run as unknown as RuntimeEntity), workspace_id: this.workspaceId } as RowRecord;
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
    await this.q.query("delete from sync_run where workspace_id = $1 and state_json->>'id' = any($2)", [this.workspaceId, ids]);
  }
}

export function exportRuntimeEntities(state: AccountingState) {
  return COLLECTIONS.flatMap((collection) => {
    const entities = collectionEntities(state, collection);
    return entities.map((entity) => ({
      collection,
      entityId: entityId(collection, entity),
      data: entity
    }));
  });
}

function spec(collection: RuntimeCollectionName, table: string, keyColumns: string[], serialize: (entity: RuntimeEntity) => RowRecord, orderBy?: string): TableSpec {
  return { collection, table, keyColumns, serialize, orderBy };
}

async function upsertRow(client: PoolClient, table: string, keyColumns: string[], row: RowRecord) {
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

async function deleteObsoleteRows(client: PoolClient, workspaceId: string, table: TableSpec, rows: RowRecord[], baselineRows?: RowRecord[]) {
  if (GLOBAL_REFERENCE_TABLES.has(table.table)) return;

  const tableWorkspaceId = workspaceIdForTable(table, workspaceId);
  const keep = new Set(rows.map((row) => rowKeyFromValues(table.keyColumns, row)));
  const staleRows = baselineRows
    ? baselineRows.filter((row) => !keep.has(rowKeyFromValues(table.keyColumns, row)))
    : (await client.query<RowRecord>(
        `select ${table.keyColumns.join(", ")} from ${table.table} where workspace_id = $1`,
        [tableWorkspaceId]
      )).rows
        .filter((row) => !keep.has(rowKeyFromValues(table.keyColumns, row)));

  if (table.table === "journal_entry" && staleRows.length > 0) {
    const staleIds = staleRows
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (staleIds.length > 0) {
      await client.query(
        "update journal_entry set reversal_of_entry_id = null where workspace_id = $2 and (id = any($1::uuid[]) or reversal_of_entry_id = any($1::uuid[]))",
        [staleIds, tableWorkspaceId]
      );
    }
  }

  for (const row of staleRows) {
    await client.query(
      `delete from ${table.table} where ${table.keyColumns.map((column, index) => `${column} = $${index + 1}`).join(" and ")} and workspace_id = $${table.keyColumns.length + 1}`,
      [...table.keyColumns.map((column) => row[column]), tableWorkspaceId]
    );
  }
}

function collectionEntities(state: AccountingState, collection: RuntimeCollectionName): RuntimeEntity[] {
  return state[collection] as unknown as RuntimeEntity[];
}

function prepareStateSnapshot(state: AccountingState, workspaceId: string): PreparedStateSnapshot {
  const tables = TABLES.map((table) => {
    const tableWorkspaceId = workspaceIdForTable(table, workspaceId);
    const rows = collectionEntities(state, table.collection).map((entity) => ({
      ...table.serialize(entity),
      workspace_id: tableWorkspaceId
    }));
    return {
      table,
      rows,
      signatureByKey: new Map(rows.map((row) => [rowKeyFromValues(table.keyColumns, row), rowSignature(row)]))
    } satisfies PreparedTableSnapshot;
  });
  return {
    organization: state.organization as unknown as RuntimeEntity | undefined,
    accountingPolicy: state.accountingPolicy as unknown as RuntimeEntity | undefined,
    organizationSignature: singletonSignature(state.organization as unknown as RuntimeEntity | undefined),
    accountingPolicySignature: singletonSignature(state.accountingPolicy as unknown as RuntimeEntity | undefined),
    tables,
    tablesByCollection: new Map(tables.map((entry) => [entry.table.collection, entry]))
  };
}

function workspaceIdForTable(table: TableSpec, workspaceId: string) {
  return GLOBAL_REFERENCE_TABLES.has(table.table) ? DEFAULT_WORKSPACE_ID : workspaceId;
}

function hydrateState(raw: unknown): AccountingState {
  return Object.assign(createEmptyState(), raw ?? {}) as AccountingState;
}

function hydrateEntity(raw: unknown) {
  return (raw ?? {}) as RuntimeEntity;
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
    return `${entity.productId}:${entity.warehouseId}`;
  }
  throw new Error(`Нельзя сохранить ${collection}: нет id/code/composite key`);
}

function rowKeyFromValues(columns: string[], row: RowRecord) {
  return columns.map((column) => String(row[column] ?? "")).join("|");
}

function rowSignature(row: RowRecord) {
  return JSON.stringify(row);
}

function singletonSignature(entity: RuntimeEntity | undefined) {
  return entity ? JSON.stringify(entity) : "";
}

function entityUuid(id: string) {
  return stableUuid(id);
}

function optionalUuid(value: unknown) {
  return typeof value === "string" && value.length > 0 ? stableUuid(value) : null;
}

function stableUuid(value: string) {
  const normalized = `mpflow:${value}`;
  const hex = createHash("sha1").update(normalized).digest("hex");
  const part1 = hex.slice(0, 8);
  const part2 = hex.slice(8, 12);
  const part3 = `5${hex.slice(13, 16)}`;
  const part4 = `a${hex.slice(17, 20)}`;
  const part5 = hex.slice(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
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

function inferNextIdFromState(state: AccountingState): number {
  let max = 0;
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const match = value.match(/_(\d{6})$/);
      if (match) max = Math.max(max, Number(match[1]));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(state);
  return max + 1;
}
