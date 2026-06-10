export type ID = string;

export type MoneyDirection = "incoming" | "outgoing";
export type DocumentStatus = "draft" | "posted" | "cancelled" | "corrected";
export type WarehouseType = "own" | "transit" | "sales_point";
export type AccountKind = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface Organization {
  id: ID;
  displayName: string;
  legalForm: "ip" | "ooo" | "self_employed" | "other";
  inn?: string;
  timezone: string;
  taxMode: "usn_income" | "usn_income_expense" | "osn" | "patent" | "unknown";
  createdAt: string;
  updatedAt?: string;
}

export interface AccountingPolicy {
  id: ID;
  organizationId: ID;
  accountingStartDate: string;
  costMethod: "fifo";
  accountingCurrency: "RUB";
  allowOpenPeriodEdits?: boolean;
  comment?: string;
}

export interface AccountingPeriod {
  id: ID;
  organizationId: ID;
  label: string;
  startsOn: string;
  endsOn: string;
  status: "open";
}

export interface ChartAccount {
  id: ID;
  organizationId: ID;
  code: string;
  name: string;
  kind: AccountKind;
  normalSide: "debit" | "credit";
  isActive: boolean;
}

export interface JournalEntry {
  id: ID;
  organizationId: ID;
  documentId: ID;
  accountingDate: string;
  memo: string;
  reversalOfEntryId?: ID;
  createdAt: string;
}

export interface JournalLine {
  id: ID;
  journalEntryId: ID;
  accountCode: string;
  debit: number;
  credit: number;
  memo: string;
}

export interface Document {
  id: ID;
  organizationId: ID;
  documentType: string;
  number: string;
  status: DocumentStatus;
  accountingDate: string;
  source: "manual" | "system" | "plugin" | "backfill";
  amountRub: number;
  title: string;
  comment?: string;
  createdAt: string;
  postedAt?: string;
  cancelledAt?: string;
  correctedFromDocumentId?: ID;
}

export interface DocumentLine {
  id: ID;
  documentId: ID;
  lineNo: number;
  lineType: string;
  qty?: number;
  amountRub?: number;
  payload: Record<string, unknown>;
}

export interface DocumentTypeRegistry {
  code: string;
  moduleCode: string;
  displayName: string;
  isPosting: boolean;
  postingRuleCode?: string;
  allowsDraft: boolean;
  allowsReversal: boolean;
  allowsCorrection: boolean;
}

export interface DocumentVersion {
  id: ID;
  documentId: ID;
  versionNo: number;
  snapshot: unknown;
  reason: string;
  createdAt: string;
}

export interface DocumentLink {
  id: ID;
  organizationId: ID;
  fromDocumentId: ID;
  toDocumentId: ID;
  linkType: string;
}

export interface AuditEvent {
  id: ID;
  organizationId: ID;
  actorLabel: string;
  entityType: string;
  entityId: ID;
  eventType: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  createdAt: string;
}

export interface Counterparty {
  id: ID;
  organizationId: ID;
  name: string;
  counterpartyType: "supplier" | "logistics" | "marketplace" | "owner" | "other";
  inn?: string;
  country?: string;
  isActive: boolean;
}

export interface Product {
  id: ID;
  organizationId: ID;
  sku: string;
  name: string;
  unit: string;
  barcode?: string;
  category?: string;
  brand?: string;
  description?: string;
  weightGrams?: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  manufacturerArticle?: string;
  comment?: string;
  imageUrl?: string;
  status: "active" | "archived";
  createdAt: string;
}

export type ProductAssetRole = "source" | "generated" | "approved";
export type ProductAssetStatus = "pending" | "ready" | "archived";

/**
 * Медиа фотостудии товара (исходники и сгенерированные слайды).
 * Marketplace-agnostic: один набор фото на внутренний товар, переиспользуется каналами.
 * Байты лежат в S3; здесь — метаданные и публичный URL.
 */
export interface ProductAsset {
  id: ID;
  organizationId: ID;
  productId: ID;
  role: ProductAssetRole;
  slideType?: string;
  storageKey: string;
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  sortOrder: number;
  status: ProductAssetStatus;
  createdBy: "user" | "agent";
  createdAt: string;
  updatedAt?: string;
  meta?: Record<string, unknown>;
}

export interface Warehouse {
  id: ID;
  organizationId: ID;
  name: string;
  warehouseType: WarehouseType;
  channelId?: ID;
  isActive: boolean;
}

export interface StockState {
  productId: ID;
  warehouseId: ID;
  stateCode?: string;
  qty: number;
  costRub: number;
}

export interface InventoryLot {
  id: ID;
  organizationId: ID;
  productId: ID;
  warehouseId: ID;
  stockStateCode?: string;
  sourceDocumentId: ID;
  sourceLineId?: ID;
  receivedAt: string;
  qtyInitial: number;
  qtyRemaining: number;
  costInitialRub: number;
  costRemainingRub: number;
  unitCostRub: number;
  status: "open" | "depleted" | "reversed";
}

export interface StockMovement {
  id: ID;
  organizationId: ID;
  productId: ID;
  warehouseId: ID;
  stockStateCode?: string;
  documentId: ID;
  movementType: "opening" | "receipt" | "transfer_in" | "transfer_out" | "sale" | "return" | "adjustment" | "correction";
  qty: number;
  costRub: number;
  occurredAt: string;
  lotId?: ID;
}

export interface CostApplication {
  id: ID;
  organizationId: ID;
  sourceDocumentId: ID;
  outboundDocumentId: ID;
  targetLineId?: ID;
  targetLineType?: string;
  productId: ID;
  fromLotId: ID;
  qty: number;
  costRub: number;
  applicationType: "sale" | "transfer" | "writeoff" | "correction";
  createdAt: string;
}

export interface PurchaseOrder {
  id: ID;
  organizationId: ID;
  documentId: ID;
  supplierId: ID;
  destinationWarehouseId: ID;
  supplierCurrency: "RUB" | "CNY" | "USD";
  status: "draft" | "ordered" | "cancelled" | "closed";
  orderedAt: string;
  totalSupplierAmount: number;
  totalQty: number;
  expectedDispatchDate?: string;
  trackingRef?: string;
  expectedArrivalDate?: string;
  comment?: string;
}

export interface PurchaseOrderLine {
  id: ID;
  purchaseOrderId: ID;
  productId: ID;
  lineNo: number;
  qtyOrdered: number;
  supplierUnitPrice: number;
  supplierAmount: number;
  lineNote?: string;
}

export interface CashAccount {
  id: ID;
  organizationId: ID;
  name: string;
  accountCode: "50" | "51";
  balanceRub: number;
  isActive: boolean;
}

export interface Payment {
  id: ID;
  organizationId: ID;
  documentId: ID;
  cashAccountId: ID;
  paymentDirection: MoneyDirection;
  paymentType:
    | "owner_contribution"
    | "supplier_payment"
    | "procurement_cost_payment"
    | "channel_payout"
    | "operating_expense_payment"
    | "owner_withdrawal"
    | "other_incoming"
    | "other_outgoing";
  counterpartyId?: ID;
  paidAt: string;
  amountRub: number;
  comment?: string;
}

export interface PaymentAllocation {
  id: ID;
  paymentId: ID;
  allocationPurpose: "goods_purchase" | "procurement_cost" | "operating_expense" | "owner" | "channel_payout" | "other";
  purchaseOrderId?: ID;
  documentId?: ID;
  amountRub: number;
}

export interface SettlementEntry {
  id: ID;
  organizationId: ID;
  counterpartyId?: ID;
  channelId?: ID;
  documentId: ID;
  settlementType: "supplier_payable" | "supplier_advance" | "supplier_claim" | "channel_receivable" | "channel_fee" | "owner";
  debitRub: number;
  creditRub: number;
  createdAt: string;
}

export interface GoodsReceipt {
  id: ID;
  organizationId: ID;
  documentId: ID;
  purchaseOrderId: ID;
  warehouseId: ID;
  receiptDate: string;
  status: "draft" | "posted" | "cancelled";
  goodsCostRubTotal: number;
  goodsCostSource: "linked_supplier_payments" | "manual" | "mixed";
  suggestedGoodsCostRub: number;
  manualCostReason?: string;
}

export interface GoodsReceiptLine {
  id: ID;
  goodsReceiptId: ID;
  purchaseOrderLineId: ID;
  productId: ID;
  qtyReceived: number;
  supplierAmountBasis: number;
  allocatedGoodsCostRub: number;
  unitCostRub: number;
}

export interface ProcurementCost {
  id: ID;
  organizationId: ID;
  documentId: ID;
  purchaseOrderId?: ID;
  costType: "delivery" | "customs" | "packaging" | "certification" | "other";
  allocationBasis: "by_cost" | "by_weight" | "by_unit";
  status: "draft" | "posted" | "cancelled";
  costDate: string;
  amountRub: number;
  paidImmediately: boolean;
  comment?: string;
  /** Расход добавлен до приёмки — висит в 41.02 «Товары в пути», ещё не распределён на партии. Распределяется при проведении приёмки. */
  pendingAllocation?: boolean;
}

export interface ProcurementCostLine {
  id: ID;
  procurementCostId: ID;
  productId: ID;
  lotId?: ID;
  warehouseId?: ID;
  basisValue?: number;
  qtyInitial?: number;
  qtyRemaining?: number;
  qtySold?: number;
  allocatedAmountRub: number;
  remainingInventoryAmountRub: number;
  soldCostAmountRub: number;
}

export interface ShortageResolution {
  id: ID;
  organizationId: ID;
  documentId: ID;
  purchaseOrderId: ID;
  status: "draft" | "posted" | "cancelled";
  reason: string;
  resolvedAt: string;
}

export interface ShortageResolutionLine {
  id: ID;
  shortageResolutionId: ID;
  purchaseOrderLineId: ID;
  productId: ID;
  qtyShortage: number;
  paidShareRub: number;
  action: "wait_supplier" | "supplier_claim" | "loss" | "close_without_accounting";
}

export interface SupplierClaim {
  id: ID;
  organizationId: ID;
  shortageResolutionLineId: ID;
  supplierId: ID;
  amountRub: number;
  status: "open" | "settled" | "written_off";
}

export interface StockTransfer {
  id: ID;
  organizationId: ID;
  documentId: ID;
  fromWarehouseId: ID;
  toWarehouseId: ID;
  fromStockStateCode?: string;
  toStockStateCode?: string;
  transferType?: "internal" | "to_sales_point" | "from_transit_to_sales_point" | "state_change";
  channelId?: ID;
  sourceGoodsReceiptId?: ID;
  sourceDocumentId?: ID;
  providerMetadata?: Record<string, unknown>;
  status: "draft" | "posted" | "cancelled";
  transferDate: string;
  comment?: string;
}

export interface StockTransferLine {
  id: ID;
  stockTransferId: ID;
  productId: ID;
  qty: number;
  costRub: number;
  sourceGoodsReceiptLineId?: ID;
  sourcePurchaseOrderLineId?: ID;
  providerMetadata?: Record<string, unknown>;
}

export type PluginStateVisibility = "private" | "shared";
export type PluginStateScopeType =
  | "organization"
  | "channel"
  | "document"
  | "goods_receipt"
  | "stock_transfer"
  | "flow_session";

export interface PluginStateRecord {
  id: ID;
  organizationId: ID;
  pluginCode: string;
  namespace: string;
  visibility: PluginStateVisibility;
  scopeType: PluginStateScopeType;
  scopeId: ID;
  stateKey: string;
  revision: number;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationPlugin {
  id: ID;
  code: string;
  displayName: string;
  status: "available" | "installed" | "disabled";
}

export type ChannelStreamCode = "products" | "stocks" | "sales" | "returns" | "finance_events" | "payouts";

export interface SalesChannel {
  id: ID;
  organizationId: ID;
  name: string;
  channelType: "marketplace" | "manual" | "wholesale" | "other";
  pluginId?: ID;
  salesPointWarehouseId: ID;
  clearingAccountCode: "76.ТП";
  status: "active" | "disabled" | "needs_setup" | "error";
  enabledStreams?: ChannelStreamCode[];
  lastCheckedAt?: string;
  lastError?: string;
  lastSyncAt?: string;
}

export interface ExternalProduct {
  id: ID;
  organizationId: ID;
  channelId: ID;
  externalSku: string;
  externalName: string;
  imageUrl?: string;
  status: "active" | "ignored";
}

export interface ProductExternalLink {
  id: ID;
  organizationId: ID;
  productId: ID;
  externalProductId: ID;
  channelId: ID;
  status: "active" | "unlinked";
}

export interface SyncStreamRun {
  id: ID;
  syncRunId: ID;
  streamCode: ChannelStreamCode;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  processedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  startedAt?: string;
  finishedAt?: string;
  errors?: string[];
}

export interface SyncRun {
  id: ID;
  organizationId: ID;
  channelId: ID;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  stats: Record<string, number>;
  mode?: "incremental" | "full" | "backfill";
  streams?: ChannelStreamCode[];
  errors?: string[];
  since?: string;
  summary?: {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    durationMs: number;
  };
  streamRuns?: SyncStreamRun[];
  lastError?: string;
}

export interface ExternalEvent {
  id: ID;
  organizationId: ID;
  channelId: ID;
  syncRunId?: ID;
  eventType: "sale" | "sale_accrual" | "return" | "cancellation" | "fee" | "payout" | "stock" | "product";
  externalId: string;
  idempotencyKey: string;
  occurredAt: string;
  rawPayload: unknown;
  normalizedPayload: unknown;
  status: "new" | "ready_for_processing" | "awaiting_sale" | "processed" | "needs_mapping" | "needs_attention" | "ignored" | "failed";
  materializedDocumentId?: ID;
  externalProductId?: ID;
  productId?: ID;
  reason?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ObservedStock {
  id: ID;
  organizationId: ID;
  channelId: ID;
  externalProductId: ID;
  productId?: ID;
  warehouseId?: ID;
  observedAt: string;
  qtyObserved: number;
  locationStatus: "mapped" | "needs_location";
}

export interface Sale {
  id: ID;
  organizationId: ID;
  documentId: ID;
  financialDocumentId?: ID;
  channelId: ID;
  saleDate: string;
  externalEventId?: ID;
  warehouseId: ID;
  externalOrderId?: string;
  grossAmountRub: number;
  recognizedGrossAmountRub?: number;
  financialRecognitionDate?: string;
  costAmountRub: number;
  grossProfitRub: number;
  status: "draft" | "shipped" | "posted" | "reversed" | "needs_attention";
}

export interface SaleLine {
  id: ID;
  saleId: ID;
  productId: ID;
  externalProductId?: ID;
  qty: number;
  priceRub: number;
  revenueRub: number;
  costRub: number;
  grossProfitRub: number;
}

export interface SalesReturn {
  id: ID;
  organizationId: ID;
  documentId: ID;
  saleId: ID;
  channelId: ID;
  externalEventId?: ID;
  returnDate: string;
  warehouseId: ID;
  stockStateCode?: string;
  status: "draft" | "posted" | "reversed" | "needs_attention";
  refundRub: number;
  restoredCostRub: number;
  comment?: string;
}

export interface ChannelFinanceEvent {
  id: ID;
  organizationId: ID;
  channelId: ID;
  externalEventId?: ID;
  documentId: ID;
  payoutId?: ID;
  externalId?: string;
  eventKind: "commission" | "logistics" | "penalty" | "compensation";
  treatment?:
    | "sale_variable"
    | "return_variable"
    | "channel_operating"
    | "inventory_capitalizable"
    | "other_expense"
    | "other_income";
  category?:
    | "commission"
    | "acquiring"
    | "last_mile_logistics"
    | "return_logistics"
    | "ads"
    | "storage"
    | "cross_docking"
    | "inbound_handling"
    | "subscription"
    | "penalty"
    | "compensation"
    | "other";
  operationType?: string;
  operationTypeName?: string;
  linkedSaleId?: ID;
  saleAllocations?: Array<{ saleId: ID; amountRub: number }>;
  linkedReturnId?: ID;
  amountRub: number;
  occurredAt: string;
  status: "new" | "classified" | "posted" | "needs_attention" | "ignored" | "reversed";
  comment?: string;
}

export interface Payout {
  id: ID;
  organizationId: ID;
  channelId: ID;
  documentId: ID;
  compositionMode: "auto" | "manual";
  externalEventId?: ID;
  externalPayoutId?: string;
  paymentId?: ID;
  payoutDate: string;
  periodFrom?: string;
  periodTo?: string;
  expectedAmountRub: number;
  grossEventsRub: number;
  bankReceiptRub: number;
  differenceRub: number;
  cashAccountId?: ID;
  differenceReason?: string;
  differenceAccepted?: boolean;
  status: "draft" | "ready" | "posted" | "needs_reconciliation" | "reconciled" | "reversed";
}

export interface PayoutLine {
  id: ID;
  payoutId: ID;
  sourceType?: "sale" | "return" | "finance_event" | "manual_adjustment";
  sourceId?: ID;
  lineGroup?: "sales" | "returns" | "commissions" | "logistics" | "penalties" | "compensations" | "manual";
  channelFinanceEventId?: ID;
  saleId?: ID;
  amountRub: number;
}

export interface ExpenseCategory {
  id: ID;
  organizationId: ID;
  name: string;
  accountCode: "26" | "44" | "91.02";
}

export interface OperatingExpense {
  id: ID;
  organizationId: ID;
  documentId: ID;
  categoryId: ID;
  paymentId: ID;
  counterpartyId?: ID;
  expenseDate: string;
  amountRub: number;
  amountPaidRub: number;
  paymentMode: "paid_now" | "pay_later" | "without_payment";
  paymentStatus: "draft" | "paid" | "unpaid";
  cashAccountId?: ID;
  comment?: string;
}

export interface OwnerTransaction {
  id: ID;
  organizationId: ID;
  documentId: ID;
  paymentId: ID;
  transactionType: "contribution" | "withdrawal";
  amountRub: number;
}

export interface Stocktake {
  id: ID;
  organizationId: ID;
  warehouseId: ID;
  documentId: ID;
  stocktakeDate: string;
  status: "draft" | "posted" | "cancelled";
}

export interface StocktakeLine {
  id: ID;
  stocktakeId: ID;
  productId: ID;
  bookQty: number;
  observedQty: number;
  differenceQty: number;
  bookCostRub: number;
  adjustmentCostRub: number;
}

export interface CorrectionCase {
  id: ID;
  organizationId: ID;
  sourceDocumentId: ID;
  correctionType: "open_period_edit" | "reversal" | "current_period_adjustment" | "reprocess_external_event";
  reason: string;
  status: "draft" | "previewed" | "applied" | "cancelled" | "failed";
  impactSummary: Record<string, unknown>;
  createdAt: string;
  appliedAt?: string;
}

export interface RecalculationJob {
  id: ID;
  organizationId: ID;
  jobType: "inventory_cost" | "sales_profit" | "settlements" | "reports" | "external_event_reprocess";
  scope: Record<string, unknown>;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  createdAt: string;
  finishedAt?: string;
}

export interface ReportSnapshot {
  id: ID;
  organizationId: ID;
  periodId?: ID;
  reportType: "profit-and-loss" | "balance-sheet" | "cash-flow" | "inventory" | "unit-economics";
  payload: unknown;
  createdAt: string;
}

export interface BackfillProject {
  id: ID;
  organizationId: ID;
  name: string;
  status: "draft" | "importing" | "needs_review" | "ready" | "applied" | "cancelled" | "failed" | "imported" | "matched" | "reviewed" | "completed";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface BackfillItem {
  id: ID;
  backfillProjectId: ID;
  itemType: "product" | "stock" | "cash" | "receivable" | "payable";
  payload: Record<string, unknown>;
  status: "new" | "matched" | "ready" | "created" | "needs_mapping" | "needs_cost" | "applied";
}

export interface UserAccount {
  id: ID;
  organizationId: ID;
  email: string;
  name: string;
  roleCode: "owner" | "accountant" | "operator" | "viewer";
  status: "invited" | "active" | "disabled";
  invitedAt?: string;
  lastActiveAt?: string;
}

export interface Role {
  id: ID;
  organizationId: ID;
  code: "owner" | "accountant" | "operator" | "viewer";
  name: string;
}

export interface AgentToken {
  id: ID;
  organizationId: ID;
  name: string;
  mode: "read_only" | "read_write";
  status: "active" | "revoked";
  scopes: string[];
  maskedToken?: string;
  tokenHash?: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface ChannelAgentPermission {
  id: ID;
  agentTokenId: ID;
  channelId: ID;
  permissionCode: string;
}

export interface AccountingState {
  organization?: Organization;
  accountingPolicy?: AccountingPolicy;
  periods: AccountingPeriod[];
  chartAccounts: ChartAccount[];
  journalEntries: JournalEntry[];
  journalLines: JournalLine[];
  documentTypes: DocumentTypeRegistry[];
  documents: Document[];
  documentLines: DocumentLine[];
  documentVersions: DocumentVersion[];
  documentLinks: DocumentLink[];
  auditEvents: AuditEvent[];
  counterparties: Counterparty[];
  products: Product[];
  productAssets: ProductAsset[];
  warehouses: Warehouse[];
  stockStates: StockState[];
  inventoryLots: InventoryLot[];
  stockMovements: StockMovement[];
  costApplications: CostApplication[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderLines: PurchaseOrderLine[];
  cashAccounts: CashAccount[];
  payments: Payment[];
  paymentAllocations: PaymentAllocation[];
  settlementEntries: SettlementEntry[];
  goodsReceipts: GoodsReceipt[];
  goodsReceiptLines: GoodsReceiptLine[];
  procurementCosts: ProcurementCost[];
  procurementCostLines: ProcurementCostLine[];
  shortageResolutions: ShortageResolution[];
  shortageResolutionLines: ShortageResolutionLine[];
  supplierClaims: SupplierClaim[];
  stockTransfers: StockTransfer[];
  stockTransferLines: StockTransferLine[];
  integrationPlugins: IntegrationPlugin[];
  salesChannels: SalesChannel[];
  externalProducts: ExternalProduct[];
  productExternalLinks: ProductExternalLink[];
  syncRuns: SyncRun[];
  externalEvents: ExternalEvent[];
  observedStocks: ObservedStock[];
  sales: Sale[];
  saleLines: SaleLine[];
  salesReturns: SalesReturn[];
  channelFinanceEvents: ChannelFinanceEvent[];
  payouts: Payout[];
  payoutLines: PayoutLine[];
  expenseCategories: ExpenseCategory[];
  operatingExpenses: OperatingExpense[];
  ownerTransactions: OwnerTransaction[];
  stocktakes: Stocktake[];
  stocktakeLines: StocktakeLine[];
  correctionCases: CorrectionCase[];
  recalculationJobs: RecalculationJob[];
  reportSnapshots: ReportSnapshot[];
  backfillProjects: BackfillProject[];
  backfillItems: BackfillItem[];
  users: UserAccount[];
  roles: Role[];
  agentTokens: AgentToken[];
  channelAgentPermissions: ChannelAgentPermission[];
  pluginStateRecords: PluginStateRecord[];
}

export interface JournalLineInput {
  accountCode: string;
  debit?: number;
  credit?: number;
  memo?: string;
}
