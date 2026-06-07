import type {
  AccountingPeriod,
  AccountingPolicy,
  AuditEvent,
  CashAccount,
  ChartAccount,
  Counterparty,
  Document,
  DocumentLine,
  DocumentLink,
  DocumentVersion,
  DocumentTypeRegistry,
  ExternalEvent,
  IntegrationPlugin,
  JournalEntry,
  JournalLine,
  ObservedStock,
  Product,
  SyncRun,
  Warehouse,
  Organization
} from "../../core/models";

export const ORGANIZATION_SELECT = `
  organization.public_id as id,
  organization.display_name,
  organization.legal_form,
  organization.inn,
  organization.timezone,
  organization.tax_mode,
  organization.created_at,
  organization.updated_at
`;

export interface OrganizationDbRow {
  id: string;
  display_name: string;
  legal_form: Organization["legalForm"];
  inn: string | null;
  timezone: string;
  tax_mode: Organization["taxMode"];
  created_at: unknown;
  updated_at: unknown;
}

export function organizationFromRow(row: OrganizationDbRow): Organization {
  return stripUndefined({
    id: row.id,
    displayName: row.display_name,
    legalForm: row.legal_form,
    inn: optionalText(row.inn),
    timezone: row.timezone,
    taxMode: row.tax_mode,
    createdAt: dateTimeString(row.created_at),
    updatedAt: optionalDateTimeString(row.updated_at)
  });
}

export const ACCOUNTING_POLICY_SELECT = `
  accounting_policy.public_id as id,
  accounting_policy_organization.public_id as organization_id,
  accounting_policy.accounting_start_date,
  accounting_policy.cost_method,
  accounting_policy.accounting_currency,
  accounting_policy.allow_open_period_edits,
  accounting_policy.comment
`;

export const ACCOUNTING_POLICY_JOINS = `
  left join organization accounting_policy_organization on accounting_policy_organization.id = accounting_policy.organization_id
`;

export interface AccountingPolicyDbRow {
  id: string;
  organization_id: string;
  accounting_start_date: unknown;
  cost_method: AccountingPolicy["costMethod"];
  accounting_currency: AccountingPolicy["accountingCurrency"];
  allow_open_period_edits: boolean | null;
  comment: string | null;
}

export function accountingPolicyFromRow(row: AccountingPolicyDbRow): AccountingPolicy {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    accountingStartDate: dateString(row.accounting_start_date),
    costMethod: row.cost_method,
    accountingCurrency: row.accounting_currency,
    allowOpenPeriodEdits: row.allow_open_period_edits ?? undefined,
    comment: optionalText(row.comment)
  });
}

export const ACCOUNTING_PERIOD_SELECT = `
  accounting_period.public_id as id,
  accounting_period_organization.public_id as organization_id,
  accounting_period.label,
  accounting_period.starts_on,
  accounting_period.ends_on,
  accounting_period.status
`;

export const ACCOUNTING_PERIOD_JOINS = `
  left join organization accounting_period_organization on accounting_period_organization.id = accounting_period.organization_id
`;

export interface AccountingPeriodDbRow {
  id: string;
  organization_id: string;
  label: string;
  starts_on: unknown;
  ends_on: unknown;
  status: AccountingPeriod["status"];
}

export function accountingPeriodFromRow(row: AccountingPeriodDbRow): AccountingPeriod {
  return {
    id: row.id,
    organizationId: row.organization_id,
    label: row.label,
    startsOn: dateString(row.starts_on),
    endsOn: dateString(row.ends_on),
    status: row.status
  };
}

export const CHART_ACCOUNT_SELECT = `
  chart_account.public_id as id,
  chart_account_organization.public_id as organization_id,
  chart_account.code,
  chart_account.name,
  chart_account.kind,
  chart_account.normal_side,
  chart_account.is_active
`;

export const CHART_ACCOUNT_JOINS = `
  left join organization chart_account_organization on chart_account_organization.id = chart_account.organization_id
`;

export interface ChartAccountDbRow {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  kind: ChartAccount["kind"];
  normal_side: ChartAccount["normalSide"];
  is_active: boolean;
}

export function chartAccountFromRow(row: ChartAccountDbRow): ChartAccount {
  return {
    id: row.id,
    organizationId: row.organization_id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    normalSide: row.normal_side,
    isActive: row.is_active
  };
}

export const DOCUMENT_TYPE_SELECT = `
  document_type_registry.public_id as code,
  document_type_registry.module_code,
  document_type_registry.display_name,
  document_type_registry.is_posting,
  document_type_registry.posting_rule_code,
  document_type_registry.allows_draft,
  document_type_registry.allows_reversal,
  document_type_registry.allows_correction
`;

export interface DocumentTypeDbRow {
  code: string;
  module_code: string;
  display_name: string;
  is_posting: boolean;
  posting_rule_code: string | null;
  allows_draft: boolean;
  allows_reversal: boolean;
  allows_correction: boolean;
}

export function documentTypeFromRow(row: DocumentTypeDbRow): DocumentTypeRegistry {
  return stripUndefined({
    code: row.code,
    moduleCode: row.module_code,
    displayName: row.display_name,
    isPosting: row.is_posting,
    postingRuleCode: optionalText(row.posting_rule_code),
    allowsDraft: row.allows_draft,
    allowsReversal: row.allows_reversal,
    allowsCorrection: row.allows_correction
  });
}

export const COUNTERPARTY_SELECT = `
  counterparty.public_id as id,
  counterparty_organization.public_id as organization_id,
  counterparty.name,
  counterparty.counterparty_type,
  counterparty.inn,
  counterparty.country,
  counterparty.is_active
`;

export const COUNTERPARTY_JOINS = `
  left join organization counterparty_organization on counterparty_organization.id = counterparty.organization_id
`;

export interface CounterpartyDbRow {
  id: string;
  organization_id: string;
  name: string;
  counterparty_type: Counterparty["counterpartyType"];
  inn: string | null;
  country: string | null;
  is_active: boolean;
}

export function counterpartyFromRow(row: CounterpartyDbRow): Counterparty {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    counterpartyType: row.counterparty_type,
    inn: optionalText(row.inn),
    country: optionalText(row.country),
    isActive: row.is_active
  });
}

export const PRODUCT_SELECT = `
  product.public_id as id,
  product_organization.public_id as organization_id,
  product.sku,
  product.name,
  product.unit,
  product.barcode,
  product.category,
  product.brand,
  product.description,
  product.weight_grams,
  product.length_mm,
  product.width_mm,
  product.height_mm,
  product.manufacturer_article,
  product.comment,
  product.image_url,
  product.status,
  product.created_at
`;

export const PRODUCT_JOINS = `
  left join organization product_organization on product_organization.id = product.organization_id
`;

export interface ProductDbRow {
  id: string;
  organization_id: string;
  sku: string;
  name: string;
  unit: string | null;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  description: string | null;
  weight_grams: number | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  manufacturer_article: string | null;
  comment: string | null;
  image_url: string | null;
  status: Product["status"];
  created_at: unknown;
}

export function productFromRow(row: ProductDbRow): Product {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    sku: row.sku,
    name: row.name,
    unit: row.unit ?? "шт",
    barcode: optionalText(row.barcode),
    category: optionalText(row.category),
    brand: optionalText(row.brand),
    description: optionalText(row.description),
    weightGrams: optionalNumber(row.weight_grams),
    lengthMm: optionalNumber(row.length_mm),
    widthMm: optionalNumber(row.width_mm),
    heightMm: optionalNumber(row.height_mm),
    manufacturerArticle: optionalText(row.manufacturer_article),
    comment: optionalText(row.comment),
    imageUrl: optionalText(row.image_url),
    status: row.status,
    createdAt: dateTimeString(row.created_at)
  });
}

export const WAREHOUSE_SELECT = `
  warehouse.public_id as id,
  warehouse_organization.public_id as organization_id,
  warehouse.name,
  warehouse.warehouse_type,
  warehouse_channel.public_id as channel_id,
  warehouse.is_active
`;

export const WAREHOUSE_JOINS = `
  left join organization warehouse_organization on warehouse_organization.id = warehouse.organization_id
  left join sales_channel warehouse_channel on warehouse_channel.id = warehouse.channel_id
`;

export interface WarehouseDbRow {
  id: string;
  organization_id: string;
  name: string;
  warehouse_type: Warehouse["warehouseType"];
  channel_id: string | null;
  is_active: boolean;
}

export function warehouseFromRow(row: WarehouseDbRow): Warehouse {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    warehouseType: row.warehouse_type,
    channelId: optionalText(row.channel_id),
    isActive: row.is_active
  });
}

export const CASH_ACCOUNT_SELECT = `
  cash_account.public_id as id,
  cash_account_organization.public_id as organization_id,
  cash_account.name,
  cash_account.account_code,
  cash_account.balance_rub,
  cash_account.is_active
`;

export const CASH_ACCOUNT_JOINS = `
  left join organization cash_account_organization on cash_account_organization.id = cash_account.organization_id
`;

export interface CashAccountDbRow {
  id: string;
  organization_id: string;
  name: string;
  account_code: CashAccount["accountCode"];
  balance_rub: string | number;
  is_active: boolean;
}

export function cashAccountFromRow(row: CashAccountDbRow): CashAccount {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    accountCode: row.account_code,
    balanceRub: Number(row.balance_rub),
    isActive: row.is_active
  };
}

export const INTEGRATION_PLUGIN_SELECT = `
  integration_plugin.public_id as id,
  integration_plugin.code,
  integration_plugin.display_name,
  integration_plugin.status
`;

export interface IntegrationPluginDbRow {
  id: string;
  code: string;
  display_name: string;
  status: IntegrationPlugin["status"];
}

export function integrationPluginFromRow(row: IntegrationPluginDbRow): IntegrationPlugin {
  return {
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    status: row.status
  };
}

export const DOCUMENT_SELECT = `
  document.public_id as id,
  document_organization.public_id as organization_id,
  document.document_type,
  document.number,
  document.status,
  document.accounting_date,
  document.source,
  document.amount_rub,
  document.title,
  document.comment,
  document_corrected_from.public_id as corrected_from_document_id,
  document.created_at,
  document.posted_at,
  document.cancelled_at
`;

export const DOCUMENT_JOINS = `
  left join organization document_organization on document_organization.id = document.organization_id
  left join document document_corrected_from on document_corrected_from.id = document.corrected_from_document_id
`;

export interface DocumentDbRow {
  id: string;
  organization_id: string;
  document_type: string;
  number: string;
  status: Document["status"];
  accounting_date: unknown;
  source: Document["source"];
  amount_rub: string | number;
  title: string;
  comment: string | null;
  corrected_from_document_id: string | null;
  created_at: unknown;
  posted_at: unknown;
  cancelled_at: unknown;
}

export function documentFromRow(row: DocumentDbRow): Document {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    documentType: row.document_type,
    number: row.number,
    status: row.status,
    accountingDate: dateString(row.accounting_date),
    source: row.source,
    amountRub: Number(row.amount_rub),
    title: row.title,
    comment: optionalText(row.comment),
    correctedFromDocumentId: optionalText(row.corrected_from_document_id),
    createdAt: dateTimeString(row.created_at),
    postedAt: optionalDateTimeString(row.posted_at),
    cancelledAt: optionalDateTimeString(row.cancelled_at)
  });
}

export const DOCUMENT_LINE_SELECT = `
  document_line.public_id as id,
  document_line_document.public_id as document_id,
  document_line.line_no,
  document_line.line_type,
  document_line.qty,
  document_line.amount_rub,
  document_line.payload
`;

export const DOCUMENT_LINE_JOINS = `
  left join document document_line_document on document_line_document.id = document_line.document_id
`;

export interface DocumentLineDbRow {
  id: string;
  document_id: string;
  line_no: number;
  line_type: string;
  qty: string | number | null;
  amount_rub: string | number | null;
  payload: Record<string, unknown>;
}

export function documentLineFromRow(row: DocumentLineDbRow): DocumentLine {
  return stripUndefined({
    id: row.id,
    documentId: row.document_id,
    lineNo: Number(row.line_no),
    lineType: row.line_type,
    qty: optionalNumber(row.qty),
    amountRub: optionalNumber(row.amount_rub),
    payload: row.payload ?? {}
  });
}

export const DOCUMENT_VERSION_SELECT = `
  document_version.public_id as id,
  document_version_document.public_id as document_id,
  document_version.version_no,
  document_version.snapshot,
  document_version.reason,
  document_version.created_at
`;

export const DOCUMENT_VERSION_JOINS = `
  left join document document_version_document on document_version_document.id = document_version.document_id
`;

export interface DocumentVersionDbRow {
  id: string;
  document_id: string;
  version_no: number;
  snapshot: unknown;
  reason: string;
  created_at: unknown;
}

export function documentVersionFromRow(row: DocumentVersionDbRow): DocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    versionNo: Number(row.version_no),
    snapshot: row.snapshot,
    reason: row.reason,
    createdAt: dateTimeString(row.created_at)
  };
}

export const DOCUMENT_LINK_SELECT = `
  document_link.public_id as id,
  document_link_organization.public_id as organization_id,
  document_link_from.public_id as from_document_id,
  document_link_to.public_id as to_document_id,
  document_link.link_type
`;

export const DOCUMENT_LINK_JOINS = `
  left join organization document_link_organization on document_link_organization.id = document_link.organization_id
  left join document document_link_from on document_link_from.id = document_link.from_document_id
  left join document document_link_to on document_link_to.id = document_link.to_document_id
`;

export interface DocumentLinkDbRow {
  id: string;
  organization_id: string;
  from_document_id: string;
  to_document_id: string;
  link_type: string;
}

export function documentLinkFromRow(row: DocumentLinkDbRow): DocumentLink {
  return {
    id: row.id,
    organizationId: row.organization_id,
    fromDocumentId: row.from_document_id,
    toDocumentId: row.to_document_id,
    linkType: row.link_type
  };
}

export const JOURNAL_ENTRY_SELECT = `
  journal_entry.public_id as id,
  journal_entry_organization.public_id as organization_id,
  journal_entry_document.public_id as document_id,
  journal_entry.accounting_date,
  journal_entry.memo,
  journal_entry_reversal.public_id as reversal_of_entry_id,
  journal_entry.created_at
`;

export const JOURNAL_ENTRY_JOINS = `
  left join organization journal_entry_organization on journal_entry_organization.id = journal_entry.organization_id
  left join document journal_entry_document on journal_entry_document.id = journal_entry.document_id
  left join journal_entry journal_entry_reversal on journal_entry_reversal.id = journal_entry.reversal_of_entry_id
`;

export interface JournalEntryDbRow {
  id: string;
  organization_id: string;
  document_id: string;
  accounting_date: unknown;
  memo: string;
  reversal_of_entry_id: string | null;
  created_at: unknown;
}

export function journalEntryFromRow(row: JournalEntryDbRow): JournalEntry {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    documentId: row.document_id,
    accountingDate: dateString(row.accounting_date),
    memo: row.memo,
    reversalOfEntryId: optionalText(row.reversal_of_entry_id),
    createdAt: dateTimeString(row.created_at)
  });
}

export const JOURNAL_LINE_SELECT = `
  journal_line.public_id as id,
  journal_line_entry.public_id as journal_entry_id,
  journal_line.account_code,
  journal_line.debit,
  journal_line.credit,
  journal_line.memo
`;

export const JOURNAL_LINE_JOINS = `
  left join journal_entry journal_line_entry on journal_line_entry.id = journal_line.journal_entry_id
`;

export interface JournalLineDbRow {
  id: string;
  journal_entry_id: string;
  account_code: string;
  debit: string | number;
  credit: string | number;
  memo: string;
}

export function journalLineFromRow(row: JournalLineDbRow): JournalLine {
  return {
    id: row.id,
    journalEntryId: row.journal_entry_id,
    accountCode: row.account_code,
    debit: Number(row.debit),
    credit: Number(row.credit),
    memo: row.memo
  };
}

export const EXTERNAL_EVENT_SELECT = `
  external_event.public_id as id,
  external_event_organization.public_id as organization_id,
  external_event_channel.public_id as channel_id,
  external_event_sync_run.public_id as sync_run_id,
  external_event.event_type,
  external_event.external_id,
  external_event.idempotency_key,
  external_event.occurred_at,
  external_event.raw_payload,
  external_event.normalized_payload,
  external_event.status,
  external_event_materialized_document.public_id as materialized_document_id,
  external_event_external_product.public_id as external_product_id,
  external_event_product.public_id as product_id,
  external_event.reason,
  external_event.last_error,
  external_event.created_at,
  external_event.updated_at
`;

export const EXTERNAL_EVENT_JOINS = `
  left join organization external_event_organization on external_event_organization.id = external_event.organization_id
  left join sales_channel external_event_channel on external_event_channel.id = external_event.channel_id
  left join sync_run external_event_sync_run on external_event_sync_run.id = external_event.sync_run_id
  left join document external_event_materialized_document on external_event_materialized_document.id = external_event.materialized_document_id
  left join external_product external_event_external_product on external_event_external_product.id = external_event.external_product_id
  left join product external_event_product on external_event_product.id = external_event.product_id
`;

export interface ExternalEventDbRow {
  id: string;
  organization_id: string;
  channel_id: string;
  sync_run_id: string | null;
  event_type: ExternalEvent["eventType"];
  external_id: string;
  idempotency_key: string | null;
  occurred_at: unknown;
  raw_payload: unknown;
  normalized_payload: unknown;
  status: ExternalEvent["status"];
  materialized_document_id: string | null;
  external_product_id: string | null;
  product_id: string | null;
  reason: string | null;
  last_error: string | null;
  created_at: unknown;
  updated_at: unknown;
}

export function externalEventFromRow(row: ExternalEventDbRow): ExternalEvent {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    channelId: row.channel_id,
    syncRunId: optionalText(row.sync_run_id),
    eventType: row.event_type,
    externalId: row.external_id,
    idempotencyKey: row.idempotency_key ?? row.external_id,
    occurredAt: dateTimeString(row.occurred_at),
    rawPayload: row.raw_payload,
    normalizedPayload: row.normalized_payload,
    status: row.status,
    materializedDocumentId: optionalText(row.materialized_document_id),
    externalProductId: optionalText(row.external_product_id),
    productId: optionalText(row.product_id),
    reason: optionalText(row.reason),
    lastError: optionalText(row.last_error),
    createdAt: dateTimeString(row.created_at),
    updatedAt: dateTimeString(row.updated_at)
  });
}

export const OBSERVED_STOCK_SELECT = `
  observed_stock.public_id as id,
  observed_stock_organization.public_id as organization_id,
  observed_stock_channel.public_id as channel_id,
  observed_stock_external_product.public_id as external_product_id,
  observed_stock_product.public_id as product_id,
  observed_stock_warehouse.public_id as warehouse_id,
  observed_stock.observed_at,
  observed_stock.qty_observed,
  observed_stock.location_status
`;

export const OBSERVED_STOCK_JOINS = `
  left join organization observed_stock_organization on observed_stock_organization.id = observed_stock.organization_id
  left join sales_channel observed_stock_channel on observed_stock_channel.id = observed_stock.channel_id
  left join external_product observed_stock_external_product on observed_stock_external_product.id = observed_stock.external_product_id
  left join product observed_stock_product on observed_stock_product.id = observed_stock.product_id
  left join warehouse observed_stock_warehouse on observed_stock_warehouse.id = observed_stock.warehouse_id
`;

export interface ObservedStockDbRow {
  id: string;
  organization_id: string;
  channel_id: string;
  external_product_id: string;
  product_id: string | null;
  warehouse_id: string | null;
  observed_at: unknown;
  qty_observed: string | number;
  location_status: ObservedStock["locationStatus"];
}

export function observedStockFromRow(row: ObservedStockDbRow): ObservedStock {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    channelId: row.channel_id,
    externalProductId: row.external_product_id,
    productId: optionalText(row.product_id),
    warehouseId: optionalText(row.warehouse_id),
    observedAt: dateTimeString(row.observed_at),
    qtyObserved: Number(row.qty_observed),
    locationStatus: row.location_status
  });
}

export const SYNC_RUN_SELECT = `
  sync_run.public_id as id,
  sync_run_organization.public_id as organization_id,
  sync_run_channel.public_id as channel_id,
  sync_run.status,
  sync_run.started_at,
  sync_run.finished_at,
  sync_run.stats,
  sync_run.mode,
  sync_run.streams,
  sync_run.errors,
  sync_run.since,
  sync_run.summary,
  sync_run.stream_runs,
  sync_run.last_error
`;

export const SYNC_RUN_JOINS = `
  left join organization sync_run_organization on sync_run_organization.id = sync_run.organization_id
  left join sales_channel sync_run_channel on sync_run_channel.id = sync_run.channel_id
`;

export interface SyncRunDbRow {
  id: string;
  organization_id: string;
  channel_id: string;
  status: SyncRun["status"];
  started_at: unknown;
  finished_at: unknown;
  stats: Record<string, number>;
  mode: SyncRun["mode"] | null;
  streams: SyncRun["streams"] | null;
  errors: string[] | null;
  since: string | null;
  summary: SyncRun["summary"] | null;
  stream_runs: SyncRun["streamRuns"] | null;
  last_error: string | null;
}

export function syncRunFromRow(row: SyncRunDbRow): SyncRun {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    channelId: row.channel_id,
    status: row.status,
    startedAt: dateTimeString(row.started_at),
    finishedAt: optionalDateTimeString(row.finished_at),
    stats: row.stats ?? {},
    mode: optionalText(row.mode) as SyncRun["mode"] | undefined,
    streams: row.streams ?? undefined,
    errors: row.errors ?? undefined,
    since: optionalText(row.since),
    summary: row.summary ?? undefined,
    streamRuns: row.stream_runs ?? undefined,
    lastError: optionalText(row.last_error)
  });
}

export const AUDIT_EVENT_SELECT = `
  audit_event.public_id as id,
  audit_event_organization.public_id as organization_id,
  audit_event.actor_label,
  audit_event.entity_type,
  audit_event.entity_public_id,
  audit_event.event_type,
  audit_event.before_json,
  audit_event.after_json,
  audit_event.reason,
  audit_event.created_at
`;

export const AUDIT_EVENT_JOINS = `
  left join organization audit_event_organization on audit_event_organization.id = audit_event.organization_id
`;

export interface AuditEventDbRow {
  id: string;
  organization_id: string;
  actor_label: string;
  entity_type: string;
  entity_public_id: string;
  event_type: string;
  before_json: unknown;
  after_json: unknown;
  reason: string | null;
  created_at: unknown;
}

export function auditEventFromRow(row: AuditEventDbRow): AuditEvent {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    actorLabel: row.actor_label,
    entityType: row.entity_type,
    entityId: row.entity_public_id,
    eventType: row.event_type,
    before: row.before_json ?? undefined,
    after: row.after_json ?? undefined,
    reason: optionalText(row.reason),
    createdAt: dateTimeString(row.created_at)
  });
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalDateTimeString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return dateTimeString(value);
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  return Number(value);
}

function dateTimeString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function dateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "");
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
