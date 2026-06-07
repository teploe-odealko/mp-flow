import type {
  AccountingPeriod,
  AccountingPolicy,
  AgentToken,
  AuditEvent,
  BackfillItem,
  BackfillProject,
  CashAccount,
  ChartAccount,
  ChannelAgentPermission,
  CorrectionCase,
  Counterparty,
  Document,
  DocumentLine,
  DocumentLink,
  DocumentVersion,
  DocumentTypeRegistry,
  ExternalEvent,
  ExternalProduct,
  ExpenseCategory,
  IntegrationPlugin,
  JournalEntry,
  JournalLine,
  OwnerTransaction,
  Payment,
  PaymentAllocation,
  PluginStateRecord,
  ProcurementCost,
  ProcurementCostLine,
  ProductExternalLink,
  PurchaseOrder,
  PurchaseOrderLine,
  RecalculationJob,
  ReportSnapshot,
  Role,
  SalesChannel,
  SettlementEntry,
  GoodsReceipt,
  GoodsReceiptLine,
  ShortageResolution,
  ShortageResolutionLine,
  Stocktake,
  StocktakeLine,
  SupplierClaim,
  ObservedStock,
  Product,
  ProductAsset,
  SyncRun,
  UserAccount,
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

export const PRODUCT_ASSET_SELECT = `
  product_asset.public_id as id,
  product_asset_organization.public_id as organization_id,
  product_asset_product.public_id as product_id,
  product_asset.role,
  product_asset.slide_type,
  product_asset.storage_key,
  product_asset.url,
  product_asset.mime_type,
  product_asset.width,
  product_asset.height,
  product_asset.sort_order,
  product_asset.status,
  product_asset.created_by,
  product_asset.created_at,
  product_asset.updated_at,
  product_asset.meta
`;

export const PRODUCT_ASSET_JOINS = `
  left join organization product_asset_organization on product_asset_organization.id = product_asset.organization_id
  left join product product_asset_product on product_asset_product.id = product_asset.product_id
`;

export interface ProductAssetDbRow {
  id: string;
  organization_id: string;
  product_id: string;
  role: ProductAsset["role"];
  slide_type: string | null;
  storage_key: string;
  url: string;
  mime_type: string | null;
  width: string | number | null;
  height: string | number | null;
  sort_order: string | number;
  status: ProductAsset["status"];
  created_by: ProductAsset["createdBy"];
  created_at: unknown;
  updated_at: unknown;
  meta: Record<string, unknown> | null;
}

export function productAssetFromRow(row: ProductAssetDbRow): ProductAsset {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    productId: row.product_id,
    role: row.role,
    slideType: optionalText(row.slide_type),
    storageKey: row.storage_key,
    url: row.url,
    mimeType: optionalText(row.mime_type),
    width: optionalNumber(row.width),
    height: optionalNumber(row.height),
    sortOrder: Number(row.sort_order),
    status: row.status,
    createdBy: row.created_by,
    createdAt: dateTimeString(row.created_at),
    updatedAt: optionalDateTimeString(row.updated_at),
    meta: row.meta ?? undefined
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

export const SALES_CHANNEL_SELECT = `
  sales_channel.public_id as id,
  sales_channel_organization.public_id as organization_id,
  sales_channel.name,
  sales_channel.channel_type,
  sales_channel_plugin.public_id as plugin_id,
  sales_channel_warehouse.public_id as sales_point_warehouse_id,
  sales_channel.clearing_account_code,
  sales_channel.status,
  sales_channel.enabled_streams,
  sales_channel.last_checked_at,
  sales_channel.last_error,
  sales_channel.last_sync_at
`;

export const SALES_CHANNEL_JOINS = `
  left join organization sales_channel_organization on sales_channel_organization.id = sales_channel.organization_id
  left join integration_plugin sales_channel_plugin on sales_channel_plugin.id = sales_channel.plugin_id
  left join warehouse sales_channel_warehouse on sales_channel_warehouse.id = sales_channel.sales_point_warehouse_id
`;

export interface SalesChannelDbRow {
  id: string;
  organization_id: string;
  name: string;
  channel_type: SalesChannel["channelType"];
  plugin_id: string | null;
  sales_point_warehouse_id: string;
  clearing_account_code: SalesChannel["clearingAccountCode"];
  status: SalesChannel["status"];
  enabled_streams: SalesChannel["enabledStreams"] | null;
  last_checked_at: unknown;
  last_error: string | null;
  last_sync_at: unknown;
}

export function salesChannelFromRow(row: SalesChannelDbRow): SalesChannel {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    channelType: row.channel_type,
    pluginId: optionalText(row.plugin_id),
    salesPointWarehouseId: row.sales_point_warehouse_id,
    clearingAccountCode: row.clearing_account_code,
    status: row.status,
    enabledStreams: row.enabled_streams ?? undefined,
    lastCheckedAt: optionalDateTimeString(row.last_checked_at),
    lastError: optionalText(row.last_error),
    lastSyncAt: optionalDateTimeString(row.last_sync_at)
  });
}

export const EXTERNAL_PRODUCT_SELECT = `
  external_product.public_id as id,
  external_product_organization.public_id as organization_id,
  external_product_channel.public_id as channel_id,
  external_product.external_sku,
  external_product.external_name,
  external_product.image_url,
  external_product.status
`;

export const EXTERNAL_PRODUCT_JOINS = `
  left join organization external_product_organization on external_product_organization.id = external_product.organization_id
  left join sales_channel external_product_channel on external_product_channel.id = external_product.channel_id
`;

export interface ExternalProductDbRow {
  id: string;
  organization_id: string;
  channel_id: string;
  external_sku: string;
  external_name: string;
  image_url: string | null;
  status: ExternalProduct["status"];
}

export function externalProductFromRow(row: ExternalProductDbRow): ExternalProduct {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    channelId: row.channel_id,
    externalSku: row.external_sku,
    externalName: row.external_name,
    imageUrl: optionalText(row.image_url),
    status: row.status
  });
}

export const PRODUCT_EXTERNAL_LINK_SELECT = `
  product_external_link.public_id as id,
  product_external_link_organization.public_id as organization_id,
  product_external_link_product.public_id as product_id,
  product_external_link_external_product.public_id as external_product_id,
  product_external_link_channel.public_id as channel_id,
  product_external_link.status
`;

export const PRODUCT_EXTERNAL_LINK_JOINS = `
  left join organization product_external_link_organization on product_external_link_organization.id = product_external_link.organization_id
  left join product product_external_link_product on product_external_link_product.id = product_external_link.product_id
  left join external_product product_external_link_external_product on product_external_link_external_product.id = product_external_link.external_product_id
  left join sales_channel product_external_link_channel on product_external_link_channel.id = product_external_link.channel_id
`;

export interface ProductExternalLinkDbRow {
  id: string;
  organization_id: string;
  product_id: string;
  external_product_id: string;
  channel_id: string;
  status: ProductExternalLink["status"];
}

export function productExternalLinkFromRow(row: ProductExternalLinkDbRow): ProductExternalLink {
  return {
    id: row.id,
    organizationId: row.organization_id,
    productId: row.product_id,
    externalProductId: row.external_product_id,
    channelId: row.channel_id,
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

export const PAYMENT_SELECT = `
  payment.public_id as id,
  payment_organization.public_id as organization_id,
  payment_document.public_id as document_id,
  payment_cash_account.public_id as cash_account_id,
  payment.payment_direction,
  payment.payment_type,
  payment_counterparty.public_id as counterparty_id,
  payment.paid_at,
  payment.amount_rub,
  payment.comment
`;

export const PAYMENT_JOINS = `
  left join organization payment_organization on payment_organization.id = payment.organization_id
  left join document payment_document on payment_document.id = payment.document_id
  left join cash_account payment_cash_account on payment_cash_account.id = payment.cash_account_id
  left join counterparty payment_counterparty on payment_counterparty.id = payment.counterparty_id
`;

export interface PaymentDbRow {
  id: string;
  organization_id: string;
  document_id: string;
  cash_account_id: string;
  payment_direction: Payment["paymentDirection"];
  payment_type: Payment["paymentType"];
  counterparty_id: string | null;
  paid_at: unknown;
  amount_rub: string | number;
  comment: string | null;
}

export function paymentFromRow(row: PaymentDbRow): Payment {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    documentId: row.document_id,
    cashAccountId: row.cash_account_id,
    paymentDirection: row.payment_direction,
    paymentType: row.payment_type,
    counterpartyId: optionalText(row.counterparty_id),
    paidAt: dateString(row.paid_at),
    amountRub: Number(row.amount_rub),
    comment: optionalText(row.comment)
  });
}

export const PAYMENT_ALLOCATION_SELECT = `
  payment_allocation.public_id as id,
  payment_allocation_payment.public_id as payment_id,
  payment_allocation.allocation_purpose,
  payment_allocation_purchase_order.public_id as purchase_order_id,
  payment_allocation_document.public_id as document_id,
  payment_allocation.amount_rub
`;

export const PAYMENT_ALLOCATION_JOINS = `
  left join payment payment_allocation_payment on payment_allocation_payment.id = payment_allocation.payment_id
  left join purchase_order payment_allocation_purchase_order on payment_allocation_purchase_order.id = payment_allocation.purchase_order_id
  left join document payment_allocation_document on payment_allocation_document.id = payment_allocation.document_id
`;

export interface PaymentAllocationDbRow {
  id: string;
  payment_id: string;
  allocation_purpose: PaymentAllocation["allocationPurpose"];
  purchase_order_id: string | null;
  document_id: string | null;
  amount_rub: string | number;
}

export function paymentAllocationFromRow(row: PaymentAllocationDbRow): PaymentAllocation {
  return stripUndefined({
    id: row.id,
    paymentId: row.payment_id,
    allocationPurpose: row.allocation_purpose,
    purchaseOrderId: optionalText(row.purchase_order_id),
    documentId: optionalText(row.document_id),
    amountRub: Number(row.amount_rub)
  });
}

export const SETTLEMENT_ENTRY_SELECT = `
  settlement_entry.public_id as id,
  settlement_entry_organization.public_id as organization_id,
  settlement_entry_counterparty.public_id as counterparty_id,
  settlement_entry_channel.public_id as channel_id,
  settlement_entry_document.public_id as document_id,
  settlement_entry.settlement_type,
  settlement_entry.debit_rub,
  settlement_entry.credit_rub,
  settlement_entry.created_at
`;

export const SETTLEMENT_ENTRY_JOINS = `
  left join organization settlement_entry_organization on settlement_entry_organization.id = settlement_entry.organization_id
  left join counterparty settlement_entry_counterparty on settlement_entry_counterparty.id = settlement_entry.counterparty_id
  left join sales_channel settlement_entry_channel on settlement_entry_channel.id = settlement_entry.channel_id
  left join document settlement_entry_document on settlement_entry_document.id = settlement_entry.document_id
`;

export interface SettlementEntryDbRow {
  id: string;
  organization_id: string;
  counterparty_id: string | null;
  channel_id: string | null;
  document_id: string;
  settlement_type: SettlementEntry["settlementType"];
  debit_rub: string | number;
  credit_rub: string | number;
  created_at: unknown;
}

export function settlementEntryFromRow(row: SettlementEntryDbRow): SettlementEntry {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    counterpartyId: optionalText(row.counterparty_id),
    channelId: optionalText(row.channel_id),
    documentId: row.document_id,
    settlementType: row.settlement_type,
    debitRub: Number(row.debit_rub),
    creditRub: Number(row.credit_rub),
    createdAt: dateTimeString(row.created_at)
  });
}

export const PURCHASE_ORDER_SELECT = `
  purchase_order.public_id as id,
  purchase_order_organization.public_id as organization_id,
  purchase_order_document.public_id as document_id,
  purchase_order_supplier.public_id as supplier_id,
  purchase_order_destination_warehouse.public_id as destination_warehouse_id,
  purchase_order.supplier_currency,
  purchase_order.status,
  purchase_order.ordered_at,
  purchase_order.total_supplier_amount,
  purchase_order.total_qty,
  purchase_order.expected_dispatch_date,
  purchase_order.tracking_ref,
  purchase_order.expected_arrival_date,
  purchase_order.comment
`;

export const PURCHASE_ORDER_JOINS = `
  left join organization purchase_order_organization on purchase_order_organization.id = purchase_order.organization_id
  left join document purchase_order_document on purchase_order_document.id = purchase_order.document_id
  left join counterparty purchase_order_supplier on purchase_order_supplier.id = purchase_order.supplier_id
  left join warehouse purchase_order_destination_warehouse on purchase_order_destination_warehouse.id = purchase_order.destination_warehouse_id
`;

export interface PurchaseOrderDbRow {
  id: string;
  organization_id: string;
  document_id: string;
  supplier_id: string;
  destination_warehouse_id: string;
  supplier_currency: PurchaseOrder["supplierCurrency"];
  status: PurchaseOrder["status"];
  ordered_at: unknown;
  total_supplier_amount: string | number;
  total_qty: string | number;
  expected_dispatch_date: unknown;
  tracking_ref: string | null;
  expected_arrival_date: unknown;
  comment: string | null;
}

export function purchaseOrderFromRow(row: PurchaseOrderDbRow): PurchaseOrder {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    documentId: row.document_id,
    supplierId: row.supplier_id,
    destinationWarehouseId: row.destination_warehouse_id,
    supplierCurrency: row.supplier_currency,
    status: row.status,
    orderedAt: dateString(row.ordered_at),
    totalSupplierAmount: Number(row.total_supplier_amount),
    totalQty: Number(row.total_qty),
    expectedDispatchDate: optionalDateString(row.expected_dispatch_date),
    trackingRef: optionalText(row.tracking_ref),
    expectedArrivalDate: optionalDateString(row.expected_arrival_date),
    comment: optionalText(row.comment)
  });
}

export const PURCHASE_ORDER_LINE_SELECT = `
  purchase_order_line.public_id as id,
  purchase_order_line_order.public_id as purchase_order_id,
  purchase_order_line_product.public_id as product_id,
  purchase_order_line.line_no,
  purchase_order_line.qty_ordered,
  purchase_order_line.supplier_unit_price,
  purchase_order_line.supplier_amount,
  purchase_order_line.line_note
`;

export const PURCHASE_ORDER_LINE_JOINS = `
  left join purchase_order purchase_order_line_order on purchase_order_line_order.id = purchase_order_line.purchase_order_id
  left join product purchase_order_line_product on purchase_order_line_product.id = purchase_order_line.product_id
`;

export interface PurchaseOrderLineDbRow {
  id: string;
  purchase_order_id: string;
  product_id: string;
  line_no: number;
  qty_ordered: string | number;
  supplier_unit_price: string | number;
  supplier_amount: string | number;
  line_note: string | null;
}

export function purchaseOrderLineFromRow(row: PurchaseOrderLineDbRow): PurchaseOrderLine {
  return stripUndefined({
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    productId: row.product_id,
    lineNo: Number(row.line_no),
    qtyOrdered: Number(row.qty_ordered),
    supplierUnitPrice: Number(row.supplier_unit_price),
    supplierAmount: Number(row.supplier_amount),
    lineNote: optionalText(row.line_note)
  });
}

export const GOODS_RECEIPT_SELECT = `
  goods_receipt.public_id as id,
  goods_receipt_organization.public_id as organization_id,
  goods_receipt_document.public_id as document_id,
  goods_receipt_purchase_order.public_id as purchase_order_id,
  goods_receipt_warehouse.public_id as warehouse_id,
  goods_receipt.receipt_date,
  goods_receipt.status,
  goods_receipt.goods_cost_rub_total,
  goods_receipt.goods_cost_source,
  goods_receipt.suggested_goods_cost_rub,
  goods_receipt.manual_cost_reason
`;

export const GOODS_RECEIPT_JOINS = `
  left join organization goods_receipt_organization on goods_receipt_organization.id = goods_receipt.organization_id
  left join document goods_receipt_document on goods_receipt_document.id = goods_receipt.document_id
  left join purchase_order goods_receipt_purchase_order on goods_receipt_purchase_order.id = goods_receipt.purchase_order_id
  left join warehouse goods_receipt_warehouse on goods_receipt_warehouse.id = goods_receipt.warehouse_id
`;

export interface GoodsReceiptDbRow {
  id: string;
  organization_id: string;
  document_id: string;
  purchase_order_id: string;
  warehouse_id: string;
  receipt_date: unknown;
  status: GoodsReceipt["status"];
  goods_cost_rub_total: string | number;
  goods_cost_source: GoodsReceipt["goodsCostSource"];
  suggested_goods_cost_rub: string | number;
  manual_cost_reason: string | null;
}

export function goodsReceiptFromRow(row: GoodsReceiptDbRow): GoodsReceipt {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    documentId: row.document_id,
    purchaseOrderId: row.purchase_order_id,
    warehouseId: row.warehouse_id,
    receiptDate: dateString(row.receipt_date),
    status: row.status,
    goodsCostRubTotal: Number(row.goods_cost_rub_total),
    goodsCostSource: row.goods_cost_source,
    suggestedGoodsCostRub: Number(row.suggested_goods_cost_rub),
    manualCostReason: optionalText(row.manual_cost_reason)
  });
}

export const GOODS_RECEIPT_LINE_SELECT = `
  goods_receipt_line.public_id as id,
  goods_receipt_line_receipt.public_id as goods_receipt_id,
  goods_receipt_line_order_line.public_id as purchase_order_line_id,
  goods_receipt_line_product.public_id as product_id,
  goods_receipt_line.qty_received,
  goods_receipt_line.supplier_amount_basis,
  goods_receipt_line.allocated_goods_cost_rub,
  goods_receipt_line.unit_cost_rub
`;

export const GOODS_RECEIPT_LINE_JOINS = `
  left join goods_receipt goods_receipt_line_receipt on goods_receipt_line_receipt.id = goods_receipt_line.goods_receipt_id
  left join purchase_order_line goods_receipt_line_order_line on goods_receipt_line_order_line.id = goods_receipt_line.purchase_order_line_id
  left join product goods_receipt_line_product on goods_receipt_line_product.id = goods_receipt_line.product_id
`;

export interface GoodsReceiptLineDbRow {
  id: string;
  goods_receipt_id: string;
  purchase_order_line_id: string;
  product_id: string;
  qty_received: string | number;
  supplier_amount_basis: string | number;
  allocated_goods_cost_rub: string | number;
  unit_cost_rub: string | number;
}

export function goodsReceiptLineFromRow(row: GoodsReceiptLineDbRow): GoodsReceiptLine {
  return {
    id: row.id,
    goodsReceiptId: row.goods_receipt_id,
    purchaseOrderLineId: row.purchase_order_line_id,
    productId: row.product_id,
    qtyReceived: Number(row.qty_received),
    supplierAmountBasis: Number(row.supplier_amount_basis),
    allocatedGoodsCostRub: Number(row.allocated_goods_cost_rub),
    unitCostRub: Number(row.unit_cost_rub)
  };
}

export const PROCUREMENT_COST_SELECT = `
  procurement_cost.public_id as id,
  procurement_cost_organization.public_id as organization_id,
  procurement_cost_document.public_id as document_id,
  procurement_cost_purchase_order.public_id as purchase_order_id,
  procurement_cost.cost_type,
  procurement_cost.allocation_basis,
  procurement_cost.status,
  procurement_cost.cost_date,
  procurement_cost.amount_rub,
  procurement_cost.paid_immediately,
  procurement_cost.comment,
  procurement_cost.pending_allocation
`;

export const PROCUREMENT_COST_JOINS = `
  left join organization procurement_cost_organization on procurement_cost_organization.id = procurement_cost.organization_id
  left join document procurement_cost_document on procurement_cost_document.id = procurement_cost.document_id
  left join purchase_order procurement_cost_purchase_order on procurement_cost_purchase_order.id = procurement_cost.purchase_order_id
`;

export interface ProcurementCostDbRow {
  id: string;
  organization_id: string;
  document_id: string;
  purchase_order_id: string | null;
  cost_type: ProcurementCost["costType"];
  allocation_basis: ProcurementCost["allocationBasis"];
  status: ProcurementCost["status"];
  cost_date: unknown;
  amount_rub: string | number;
  paid_immediately: boolean;
  comment: string | null;
  pending_allocation: boolean | null;
}

export function procurementCostFromRow(row: ProcurementCostDbRow): ProcurementCost {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    documentId: row.document_id,
    purchaseOrderId: optionalText(row.purchase_order_id),
    costType: row.cost_type,
    allocationBasis: row.allocation_basis,
    status: row.status,
    costDate: dateString(row.cost_date),
    amountRub: Number(row.amount_rub),
    paidImmediately: row.paid_immediately,
    comment: optionalText(row.comment),
    pendingAllocation: row.pending_allocation ?? undefined
  });
}

export const PROCUREMENT_COST_LINE_SELECT = `
  procurement_cost_line.public_id as id,
  procurement_cost_line_cost.public_id as procurement_cost_id,
  procurement_cost_line_product.public_id as product_id,
  procurement_cost_line_lot.public_id as lot_id,
  procurement_cost_line_warehouse.public_id as warehouse_id,
  procurement_cost_line.basis_value,
  procurement_cost_line.qty_initial,
  procurement_cost_line.qty_remaining,
  procurement_cost_line.qty_sold,
  procurement_cost_line.allocated_amount_rub,
  procurement_cost_line.remaining_inventory_amount_rub,
  procurement_cost_line.sold_cost_amount_rub
`;

export const PROCUREMENT_COST_LINE_JOINS = `
  left join procurement_cost procurement_cost_line_cost on procurement_cost_line_cost.id = procurement_cost_line.procurement_cost_id
  left join product procurement_cost_line_product on procurement_cost_line_product.id = procurement_cost_line.product_id
  left join inventory_lot procurement_cost_line_lot on procurement_cost_line_lot.id = procurement_cost_line.lot_id
  left join warehouse procurement_cost_line_warehouse on procurement_cost_line_warehouse.id = procurement_cost_line.warehouse_id
`;

export interface ProcurementCostLineDbRow {
  id: string;
  procurement_cost_id: string;
  product_id: string;
  lot_id: string | null;
  warehouse_id: string | null;
  basis_value: string | number | null;
  qty_initial: string | number | null;
  qty_remaining: string | number | null;
  qty_sold: string | number | null;
  allocated_amount_rub: string | number;
  remaining_inventory_amount_rub: string | number;
  sold_cost_amount_rub: string | number;
}

export function procurementCostLineFromRow(row: ProcurementCostLineDbRow): ProcurementCostLine {
  return stripUndefined({
    id: row.id,
    procurementCostId: row.procurement_cost_id,
    productId: row.product_id,
    lotId: optionalText(row.lot_id),
    warehouseId: optionalText(row.warehouse_id),
    basisValue: optionalNumber(row.basis_value),
    qtyInitial: optionalNumber(row.qty_initial),
    qtyRemaining: optionalNumber(row.qty_remaining),
    qtySold: optionalNumber(row.qty_sold),
    allocatedAmountRub: Number(row.allocated_amount_rub),
    remainingInventoryAmountRub: Number(row.remaining_inventory_amount_rub),
    soldCostAmountRub: Number(row.sold_cost_amount_rub)
  });
}

export const SHORTAGE_RESOLUTION_SELECT = `
  shortage_resolution.public_id as id,
  shortage_resolution_organization.public_id as organization_id,
  shortage_resolution_document.public_id as document_id,
  shortage_resolution_purchase_order.public_id as purchase_order_id,
  shortage_resolution.status,
  shortage_resolution.reason,
  shortage_resolution.resolved_at
`;

export const SHORTAGE_RESOLUTION_JOINS = `
  left join organization shortage_resolution_organization on shortage_resolution_organization.id = shortage_resolution.organization_id
  left join document shortage_resolution_document on shortage_resolution_document.id = shortage_resolution.document_id
  left join purchase_order shortage_resolution_purchase_order on shortage_resolution_purchase_order.id = shortage_resolution.purchase_order_id
`;

export interface ShortageResolutionDbRow {
  id: string;
  organization_id: string;
  document_id: string;
  purchase_order_id: string;
  status: ShortageResolution["status"];
  reason: string;
  resolved_at: unknown;
}

export function shortageResolutionFromRow(row: ShortageResolutionDbRow): ShortageResolution {
  return {
    id: row.id,
    organizationId: row.organization_id,
    documentId: row.document_id,
    purchaseOrderId: row.purchase_order_id,
    status: row.status,
    reason: row.reason,
    resolvedAt: dateString(row.resolved_at)
  };
}

export const SHORTAGE_RESOLUTION_LINE_SELECT = `
  shortage_resolution_line.public_id as id,
  shortage_resolution_line_resolution.public_id as shortage_resolution_id,
  shortage_resolution_line_order_line.public_id as purchase_order_line_id,
  shortage_resolution_line_product.public_id as product_id,
  shortage_resolution_line.qty_shortage,
  shortage_resolution_line.paid_share_rub,
  shortage_resolution_line.action
`;

export const SHORTAGE_RESOLUTION_LINE_JOINS = `
  left join shortage_resolution shortage_resolution_line_resolution on shortage_resolution_line_resolution.id = shortage_resolution_line.shortage_resolution_id
  left join purchase_order_line shortage_resolution_line_order_line on shortage_resolution_line_order_line.id = shortage_resolution_line.purchase_order_line_id
  left join product shortage_resolution_line_product on shortage_resolution_line_product.id = shortage_resolution_line.product_id
`;

export interface ShortageResolutionLineDbRow {
  id: string;
  shortage_resolution_id: string;
  purchase_order_line_id: string;
  product_id: string;
  qty_shortage: string | number;
  paid_share_rub: string | number;
  action: ShortageResolutionLine["action"];
}

export function shortageResolutionLineFromRow(row: ShortageResolutionLineDbRow): ShortageResolutionLine {
  return {
    id: row.id,
    shortageResolutionId: row.shortage_resolution_id,
    purchaseOrderLineId: row.purchase_order_line_id,
    productId: row.product_id,
    qtyShortage: Number(row.qty_shortage),
    paidShareRub: Number(row.paid_share_rub),
    action: row.action
  };
}

export const SUPPLIER_CLAIM_SELECT = `
  supplier_claim.public_id as id,
  supplier_claim_organization.public_id as organization_id,
  supplier_claim_shortage_line.public_id as shortage_resolution_line_id,
  supplier_claim_supplier.public_id as supplier_id,
  supplier_claim.amount_rub,
  supplier_claim.status
`;

export const SUPPLIER_CLAIM_JOINS = `
  left join organization supplier_claim_organization on supplier_claim_organization.id = supplier_claim.organization_id
  left join shortage_resolution_line supplier_claim_shortage_line on supplier_claim_shortage_line.id = supplier_claim.shortage_resolution_line_id
  left join counterparty supplier_claim_supplier on supplier_claim_supplier.id = supplier_claim.supplier_id
`;

export interface SupplierClaimDbRow {
  id: string;
  organization_id: string;
  shortage_resolution_line_id: string;
  supplier_id: string;
  amount_rub: string | number;
  status: SupplierClaim["status"];
}

export function supplierClaimFromRow(row: SupplierClaimDbRow): SupplierClaim {
  return {
    id: row.id,
    organizationId: row.organization_id,
    shortageResolutionLineId: row.shortage_resolution_line_id,
    supplierId: row.supplier_id,
    amountRub: Number(row.amount_rub),
    status: row.status
  };
}

export const EXPENSE_CATEGORY_SELECT = `
  expense_category.public_id as id,
  expense_category_organization.public_id as organization_id,
  expense_category.name,
  expense_category.account_code
`;

export const EXPENSE_CATEGORY_JOINS = `
  left join organization expense_category_organization on expense_category_organization.id = expense_category.organization_id
`;

export interface ExpenseCategoryDbRow {
  id: string;
  organization_id: string;
  name: string;
  account_code: ExpenseCategory["accountCode"];
}

export function expenseCategoryFromRow(row: ExpenseCategoryDbRow): ExpenseCategory {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    accountCode: row.account_code
  };
}

export const CORRECTION_CASE_SELECT = `
  correction_case.public_id as id,
  correction_case_organization.public_id as organization_id,
  correction_case_source_document.public_id as source_document_id,
  correction_case.correction_type,
  correction_case.reason,
  correction_case.status,
  correction_case.impact_summary,
  correction_case.created_at,
  correction_case.applied_at
`;

export const CORRECTION_CASE_JOINS = `
  left join organization correction_case_organization on correction_case_organization.id = correction_case.organization_id
  left join document correction_case_source_document on correction_case_source_document.id = correction_case.source_document_id
`;

export interface CorrectionCaseDbRow {
  id: string;
  organization_id: string;
  source_document_id: string;
  correction_type: CorrectionCase["correctionType"];
  reason: string;
  status: CorrectionCase["status"];
  impact_summary: Record<string, unknown>;
  created_at: unknown;
  applied_at: unknown;
}

export function correctionCaseFromRow(row: CorrectionCaseDbRow): CorrectionCase {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    sourceDocumentId: row.source_document_id,
    correctionType: row.correction_type,
    reason: row.reason,
    status: row.status,
    impactSummary: row.impact_summary ?? {},
    createdAt: dateTimeString(row.created_at),
    appliedAt: optionalDateTimeString(row.applied_at)
  });
}

export const RECALCULATION_JOB_SELECT = `
  recalculation_job.public_id as id,
  recalculation_job_organization.public_id as organization_id,
  recalculation_job.job_type,
  recalculation_job.scope,
  recalculation_job.status,
  recalculation_job.progress,
  recalculation_job.created_at,
  recalculation_job.finished_at
`;

export const RECALCULATION_JOB_JOINS = `
  left join organization recalculation_job_organization on recalculation_job_organization.id = recalculation_job.organization_id
`;

export interface RecalculationJobDbRow {
  id: string;
  organization_id: string;
  job_type: RecalculationJob["jobType"];
  scope: Record<string, unknown>;
  status: RecalculationJob["status"];
  progress: string | number;
  created_at: unknown;
  finished_at: unknown;
}

export function recalculationJobFromRow(row: RecalculationJobDbRow): RecalculationJob {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    jobType: row.job_type,
    scope: row.scope ?? {},
    status: row.status,
    progress: Number(row.progress),
    createdAt: dateTimeString(row.created_at),
    finishedAt: optionalDateTimeString(row.finished_at)
  });
}

export const REPORT_SNAPSHOT_SELECT = `
  report_snapshot.public_id as id,
  report_snapshot_organization.public_id as organization_id,
  report_snapshot_period.public_id as period_id,
  report_snapshot.report_type,
  report_snapshot.payload,
  report_snapshot.created_at
`;

export const REPORT_SNAPSHOT_JOINS = `
  left join organization report_snapshot_organization on report_snapshot_organization.id = report_snapshot.organization_id
  left join accounting_period report_snapshot_period on report_snapshot_period.id = report_snapshot.period_id
`;

export interface ReportSnapshotDbRow {
  id: string;
  organization_id: string;
  period_id: string | null;
  report_type: ReportSnapshot["reportType"];
  payload: unknown;
  created_at: unknown;
}

export function reportSnapshotFromRow(row: ReportSnapshotDbRow): ReportSnapshot {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    periodId: optionalText(row.period_id),
    reportType: row.report_type,
    payload: row.payload,
    createdAt: dateTimeString(row.created_at)
  });
}

export const BACKFILL_PROJECT_SELECT = `
  backfill_project.public_id as id,
  backfill_project_organization.public_id as organization_id,
  backfill_project.name,
  backfill_project.status,
  backfill_project.payload,
  backfill_project.created_at
`;

export const BACKFILL_PROJECT_JOINS = `
  left join organization backfill_project_organization on backfill_project_organization.id = backfill_project.organization_id
`;

export interface BackfillProjectDbRow {
  id: string;
  organization_id: string;
  name: string;
  status: BackfillProject["status"];
  payload: Record<string, unknown>;
  created_at: unknown;
}

export function backfillProjectFromRow(row: BackfillProjectDbRow): BackfillProject {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    status: row.status,
    payload: row.payload ?? {},
    createdAt: dateTimeString(row.created_at)
  };
}

export const BACKFILL_ITEM_SELECT = `
  backfill_item.public_id as id,
  backfill_item_project.public_id as backfill_project_id,
  backfill_item.item_type,
  backfill_item.payload,
  backfill_item.status
`;

export const BACKFILL_ITEM_JOINS = `
  left join backfill_project backfill_item_project on backfill_item_project.id = backfill_item.backfill_project_id
`;

export interface BackfillItemDbRow {
  id: string;
  backfill_project_id: string;
  item_type: BackfillItem["itemType"];
  payload: Record<string, unknown>;
  status: BackfillItem["status"];
}

export function backfillItemFromRow(row: BackfillItemDbRow): BackfillItem {
  return {
    id: row.id,
    backfillProjectId: row.backfill_project_id,
    itemType: row.item_type,
    payload: row.payload ?? {},
    status: row.status
  };
}

export const ROLE_SELECT = `
  role.public_id as id,
  role_organization.public_id as organization_id,
  role.code,
  role.name
`;

export const ROLE_JOINS = `
  left join organization role_organization on role_organization.id = role.organization_id
`;

export interface RoleDbRow {
  id: string;
  organization_id: string;
  code: Role["code"];
  name: string;
}

export function roleFromRow(row: RoleDbRow): Role {
  return {
    id: row.id,
    organizationId: row.organization_id,
    code: row.code,
    name: row.name
  };
}

export const USER_ACCOUNT_SELECT = `
  user_account.public_id as id,
  user_account_organization.public_id as organization_id,
  user_account.email,
  user_account.name,
  user_account.role_code,
  user_account.status,
  user_account.invited_at,
  user_account.last_active_at
`;

export const USER_ACCOUNT_JOINS = `
  left join organization user_account_organization on user_account_organization.id = user_account.organization_id
`;

export interface UserAccountDbRow {
  id: string;
  organization_id: string;
  email: string;
  name: string;
  role_code: UserAccount["roleCode"];
  status: UserAccount["status"];
  invited_at: unknown;
  last_active_at: unknown;
}

export function userAccountFromRow(row: UserAccountDbRow): UserAccount {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    name: row.name,
    roleCode: row.role_code,
    status: row.status,
    invitedAt: optionalDateTimeString(row.invited_at),
    lastActiveAt: optionalDateTimeString(row.last_active_at)
  });
}

export const AGENT_TOKEN_SELECT = `
  agent_token.public_id as id,
  agent_token_organization.public_id as organization_id,
  agent_token.name,
  agent_token.mode,
  agent_token.status,
  agent_token.scopes,
  agent_token.masked_token,
  agent_token.token_hash,
  agent_token.created_at,
  agent_token.last_used_at,
  agent_token.revoked_at
`;

export const AGENT_TOKEN_JOINS = `
  left join organization agent_token_organization on agent_token_organization.id = agent_token.organization_id
`;

export interface AgentTokenDbRow {
  id: string;
  organization_id: string;
  name: string;
  mode: AgentToken["mode"];
  status: AgentToken["status"];
  scopes: unknown;
  masked_token: string | null;
  token_hash: string | null;
  created_at: unknown;
  last_used_at: unknown;
  revoked_at: unknown;
}

export function agentTokenFromRow(row: AgentTokenDbRow): AgentToken {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    mode: row.mode,
    status: row.status,
    scopes: stringArray(row.scopes),
    maskedToken: optionalText(row.masked_token),
    tokenHash: optionalText(row.token_hash),
    createdAt: dateTimeString(row.created_at),
    lastUsedAt: optionalDateTimeString(row.last_used_at),
    revokedAt: optionalDateTimeString(row.revoked_at)
  });
}

export const PLUGIN_STATE_RECORD_SELECT = `
  plugin_state_record.public_id as id,
  plugin_state_record_organization.public_id as organization_id,
  plugin_state_record.plugin_code,
  plugin_state_record.namespace,
  plugin_state_record.visibility,
  plugin_state_record.scope_type,
  plugin_state_record.scope_id,
  plugin_state_record.state_key,
  plugin_state_record.revision,
  plugin_state_record.payload_json,
  plugin_state_record.created_at,
  plugin_state_record.updated_at
`;

export const PLUGIN_STATE_RECORD_JOINS = `
  left join organization plugin_state_record_organization on plugin_state_record_organization.id = plugin_state_record.organization_id
`;

export interface PluginStateRecordDbRow {
  id: string;
  organization_id: string;
  plugin_code: string;
  namespace: string;
  visibility: PluginStateRecord["visibility"];
  scope_type: PluginStateRecord["scopeType"];
  scope_id: string;
  state_key: string;
  revision: string | number;
  payload_json: Record<string, unknown>;
  created_at: unknown;
  updated_at: unknown;
}

export function pluginStateRecordFromRow(row: PluginStateRecordDbRow): PluginStateRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    pluginCode: row.plugin_code,
    namespace: row.namespace,
    visibility: row.visibility,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    stateKey: row.state_key,
    revision: Number(row.revision),
    payload: row.payload_json ?? {},
    createdAt: dateTimeString(row.created_at),
    updatedAt: dateTimeString(row.updated_at)
  };
}

export const OWNER_TRANSACTION_SELECT = `
  owner_transaction.public_id as id,
  owner_transaction_organization.public_id as organization_id,
  owner_transaction_document.public_id as document_id,
  owner_transaction_payment.public_id as payment_id,
  owner_transaction.transaction_type,
  owner_transaction.amount_rub
`;

export const OWNER_TRANSACTION_JOINS = `
  left join organization owner_transaction_organization on owner_transaction_organization.id = owner_transaction.organization_id
  left join document owner_transaction_document on owner_transaction_document.id = owner_transaction.document_id
  left join payment owner_transaction_payment on owner_transaction_payment.id = owner_transaction.payment_id
`;

export interface OwnerTransactionDbRow {
  id: string;
  organization_id: string;
  document_id: string;
  payment_id: string;
  transaction_type: OwnerTransaction["transactionType"];
  amount_rub: string | number;
}

export function ownerTransactionFromRow(row: OwnerTransactionDbRow): OwnerTransaction {
  return {
    id: row.id,
    organizationId: row.organization_id,
    documentId: row.document_id,
    paymentId: row.payment_id,
    transactionType: row.transaction_type,
    amountRub: Number(row.amount_rub)
  };
}

export const STOCKTAKE_SELECT = `
  stocktake.public_id as id,
  stocktake_organization.public_id as organization_id,
  stocktake_warehouse.public_id as warehouse_id,
  stocktake_document.public_id as document_id,
  stocktake.stocktake_date,
  stocktake.status
`;

export const STOCKTAKE_JOINS = `
  left join organization stocktake_organization on stocktake_organization.id = stocktake.organization_id
  left join warehouse stocktake_warehouse on stocktake_warehouse.id = stocktake.warehouse_id
  left join document stocktake_document on stocktake_document.id = stocktake.document_id
`;

export interface StocktakeDbRow {
  id: string;
  organization_id: string;
  warehouse_id: string;
  document_id: string;
  stocktake_date: unknown;
  status: Stocktake["status"];
}

export function stocktakeFromRow(row: StocktakeDbRow): Stocktake {
  return {
    id: row.id,
    organizationId: row.organization_id,
    warehouseId: row.warehouse_id,
    documentId: row.document_id,
    stocktakeDate: dateString(row.stocktake_date),
    status: row.status
  };
}

export const STOCKTAKE_LINE_SELECT = `
  stocktake_line.public_id as id,
  stocktake_line_stocktake.public_id as stocktake_id,
  stocktake_line_product.public_id as product_id,
  stocktake_line.book_qty,
  stocktake_line.observed_qty,
  stocktake_line.difference_qty,
  stocktake_line.book_cost_rub,
  stocktake_line.adjustment_cost_rub
`;

export const STOCKTAKE_LINE_JOINS = `
  left join stocktake stocktake_line_stocktake on stocktake_line_stocktake.id = stocktake_line.stocktake_id
  left join product stocktake_line_product on stocktake_line_product.id = stocktake_line.product_id
`;

export interface StocktakeLineDbRow {
  id: string;
  stocktake_id: string;
  product_id: string;
  book_qty: string | number;
  observed_qty: string | number;
  difference_qty: string | number;
  book_cost_rub: string | number;
  adjustment_cost_rub: string | number;
}

export function stocktakeLineFromRow(row: StocktakeLineDbRow): StocktakeLine {
  return {
    id: row.id,
    stocktakeId: row.stocktake_id,
    productId: row.product_id,
    bookQty: Number(row.book_qty),
    observedQty: Number(row.observed_qty),
    differenceQty: Number(row.difference_qty),
    bookCostRub: Number(row.book_cost_rub),
    adjustmentCostRub: Number(row.adjustment_cost_rub)
  };
}

export const CHANNEL_AGENT_PERMISSION_SELECT = `
  channel_agent_permission.public_id as id,
  channel_agent_permission_token.public_id as agent_token_id,
  channel_agent_permission_channel.public_id as channel_id,
  channel_agent_permission.permission_code
`;

export const CHANNEL_AGENT_PERMISSION_JOINS = `
  left join agent_token channel_agent_permission_token on channel_agent_permission_token.id = channel_agent_permission.agent_token_id
  left join sales_channel channel_agent_permission_channel on channel_agent_permission_channel.id = channel_agent_permission.channel_id
`;

export interface ChannelAgentPermissionDbRow {
  id: string;
  agent_token_id: string;
  channel_id: string;
  permission_code: string;
}

export function channelAgentPermissionFromRow(row: ChannelAgentPermissionDbRow): ChannelAgentPermission {
  return {
    id: row.id,
    agentTokenId: row.agent_token_id,
    channelId: row.channel_id,
    permissionCode: row.permission_code
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

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function optionalDateTimeString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return dateTimeString(value);
}

function optionalDateString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return dateString(value);
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
