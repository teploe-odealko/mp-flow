import type {
  AccountingPeriod,
  AccountingState,
  AgentToken,
  AuditEvent,
  CashAccount,
  ChannelFinanceEvent,
  ChartAccount,
  CostApplication,
  CorrectionCase,
  Counterparty,
  Document,
  DocumentLine,
  DocumentLink,
  DocumentTypeRegistry,
  ExternalEvent,
  ExternalProduct,
  GoodsReceipt,
  GoodsReceiptLine,
  ID,
  InventoryLot,
  JournalLineInput,
  OperatingExpense,
  Organization,
  Payment,
  PaymentAllocation,
  Payout,
  PayoutLine,
  PluginStateRecord,
  ProcurementCost,
  ProcurementCostLine,
  PluginStateScopeType,
  Product,
  ProductAsset,
  ProductAssetRole,
  ProductAssetStatus,
  ProductExternalLink,
  PurchaseOrder,
  PurchaseOrderLine,
  Role,
  Sale,
  SaleLine,
  SalesChannel,
  SalesReturn,
  SettlementEntry,
  ShortageResolution,
  ShortageResolutionLine,
  StockMovement,
  Stocktake,
  StockState,
  StockTransfer,
  UserAccount,
  Warehouse
} from "./models";
import { assertNonNegative, assertPositive, createEmptyState, DomainError, id, monthPeriods, nowIso, round2, round4, round6 } from "./utils";
import { InMemoryExternalEventStore, type ExternalEventStore } from "./external-event-store";

export interface BootstrapInput {
  displayName: string;
  accountingStartDate: string;
  legalForm?: Organization["legalForm"];
  taxMode?: Organization["taxMode"];
  timezone?: string;
  inn?: string;
  allowOpenPeriodEdits?: boolean;
  comment?: string;
  confirmHistoricalStart?: boolean;
}

export interface ReceiptPreviewLine {
  purchaseOrderLineId: ID;
  productId: ID;
  qtyReceived: number;
  supplierAmountBasis: number;
  allocatedGoodsCostRub: number;
  unitCostRub: number;
}

export interface ReceiptPreview {
  linkedGoodsPaymentRub: number;
  previousReceiptCostRub: number;
  suggestedGoodsCostRub: number;
  remainingAdvanceRub: number;
  lines: ReceiptPreviewLine[];
}

export interface ProcurementCostPreviewLine {
  lotId: ID;
  productId: ID;
  warehouseId: ID;
  qtyInitial: number;
  qtyRemaining: number;
  qtySold: number;
  basisValue: number;
  allocatedAmountRub: number;
  remainingInventoryAmountRub: number;
  soldCostAmountRub: number;
  unitCostDeltaRub: number;
}

export interface ProcurementCostPreview {
  purchaseOrderId?: ID;
  allocationBasis: ProcurementCost["allocationBasis"];
  amountRub: number;
  totalBasis: number;
  remainingInventoryAmountRub: number;
  soldCostAmountRub: number;
  lines: ProcurementCostPreviewLine[];
}

export interface DocumentDescendantSummary {
  documentId: ID;
  number: string;
  title: string;
  documentType: string;
  documentTypeName: string;
  status: Document["status"];
  accountingDate: string;
  linkType: string;
  parentDocumentId: ID;
  depth: number;
}

export interface RollbackRelatedDocumentSummary {
  documentId: ID;
  number: string;
  title: string;
  documentType: string;
  documentTypeName: string;
  status: Document["status"];
  accountingDate: string;
}

export interface EntityRollbackBlockerSummary {
  code: string;
  message: string;
  relatedDocuments?: RollbackRelatedDocumentSummary[];
}

export interface EntityRollbackEffectsSummary {
  documents: number;
  journalEntries: number;
  journalLines: number;
  settlementEntries: number;
  stockMovements: number;
  inventoryLots: number;
  costApplications: number;
  saleLines: number;
  financeEvents: number;
  stockTransfers: number;
  payments: number;
  paymentAllocations: number;
  externalEventsToReset: number;
}

export interface EntityRollbackPreview {
  entityType: "sale" | "stock_transfer" | "payment" | "goods_receipt" | "procurement_cost";
  entityId: ID;
  documentId: ID;
  documentNumber: string;
  title: string;
  status: string;
  accountingDate: string;
  canDelete: boolean;
  blockers: EntityRollbackBlockerSummary[];
  descendants: DocumentDescendantSummary[];
  effects: EntityRollbackEffectsSummary;
}

const MARKETPLACE_SHIPPED_ACCOUNT_CODE = "45.03";
const MARKETPLACE_SALE_RECOGNITION_DOCUMENT_TYPE = "sale_accrual";

export class AccountingApp {
  readonly state: AccountingState;
  private readonly channelCredentials = new Map<ID, Record<string, string | undefined>>();
  private readonly pluginSecrets = new Map<string, { revision: number; payload: Record<string, string | undefined> }>();
  private externalProductByChannelSku?: Map<string, ExternalProduct>;
  private activeLinkByExternalProductId?: Map<ID, ProductExternalLink>;
  /**
   * Поток событий маркетплейса. По умолчанию in-memory (обёртка над state.externalEvents);
   * в Postgres-рантайме сюда инжектится репозиторий, и события не живут в snapshot.
   */
  externalEvents: ExternalEventStore;
  private pendingExternalEventUpdates = new Map<ID, Partial<ExternalEvent>>();
  private saleLookup?: {
    exact: Map<string, Sale>;
    parent: Map<string, Sale | null>;
  };

  constructor(state: AccountingState = createEmptyState()) {
    this.state = state;
    this.externalEvents = new InMemoryExternalEventStore(this.state.externalEvents);
    this.ensureRequiredSystemMetadata();
  }

  private externalProductKey(channelId: ID, externalSku: string) {
    return `${channelId}::${externalSku.trim()}`;
  }

  private externalEventIdentityKey(channelId: ID, identity: string) {
    return `${channelId}::${identity.trim()}`;
  }

  private ensureExternalProductIndex() {
    if (this.externalProductByChannelSku) return this.externalProductByChannelSku;
    this.externalProductByChannelSku = new Map(
      this.state.externalProducts.map((product) => [
        this.externalProductKey(product.channelId, product.externalSku),
        product
      ])
    );
    return this.externalProductByChannelSku;
  }

  private ensureActiveLinkIndex() {
    if (this.activeLinkByExternalProductId) return this.activeLinkByExternalProductId;
    this.activeLinkByExternalProductId = new Map<ID, ProductExternalLink>();
    for (const link of this.state.productExternalLinks) {
      if (link.status === "active") {
        this.activeLinkByExternalProductId.set(link.externalProductId, link);
      }
    }
    return this.activeLinkByExternalProductId;
  }

  private invalidateSaleLookup() {
    this.saleLookup = undefined;
  }

  private async ensureSaleLookup() {
    if (this.saleLookup) return this.saleLookup;
    const exact = new Map<string, Sale>();
    const parent = new Map<string, Sale | null>();
    for (const sale of this.state.sales) {
      if (!sale.externalEventId) continue;
      const sourceEvent = await this.externalEvents.getById(sale.externalEventId);
      if (!sourceEvent) continue;
      const payload = sourceEvent.normalizedPayload as Record<string, unknown> | undefined;
      const postingNumber = String(payload?.postingNumber ?? "").trim();
      if (!postingNumber) continue;
      exact.set(this.externalEventIdentityKey(sourceEvent.channelId, postingNumber), sale);
      const normalizedParent = normalizeParentPostingNumber(postingNumber);
      const parentKey = this.externalEventIdentityKey(sourceEvent.channelId, normalizedParent);
      const existing = parent.get(parentKey);
      if (existing === undefined) parent.set(parentKey, sale);
      else if (existing !== sale) parent.set(parentKey, null);
    }
    this.saleLookup = { exact, parent };
    return this.saleLookup;
  }

  private findExternalProduct(channelId: ID, externalSku: string) {
    return this.ensureExternalProductIndex().get(this.externalProductKey(channelId, externalSku));
  }

  private findActiveLink(externalProductId: ID) {
    return this.ensureActiveLinkIndex().get(externalProductId);
  }

  findExternalEventById(eventId: ID) {
    return this.externalEvents.getById(eventId);
  }

  findExternalEventByIdentity(channelId: ID, externalId: string, idempotencyKey?: string) {
    return this.externalEvents.findByIdentity(channelId, externalId, idempotencyKey);
  }

  async findSaleByPostingNumber(channelId: ID, postingNumber: string) {
    const value = String(postingNumber ?? "").trim();
    if (!value) return undefined;
    const lookup = await this.ensureSaleLookup();
    const exact = lookup.exact.get(this.externalEventIdentityKey(channelId, value));
    if (exact) return exact;
    const normalizedParent = normalizeParentPostingNumber(value);
    if (!normalizedParent || normalizedParent !== value) return undefined;
    const parent = lookup.parent.get(this.externalEventIdentityKey(channelId, normalizedParent));
    return parent ?? undefined;
  }

  bootstrap(input: BootstrapInput) {
    if (this.state.organization) {
      return this.dashboard();
    }

    this.validateSetupInput(input, false);

    const organization: Organization = {
      id: id("org"),
      displayName: input.displayName,
      legalForm: input.legalForm ?? "ip",
      inn: input.inn,
      timezone: input.timezone ?? "Europe/Moscow",
      taxMode: input.taxMode ?? "usn_income_expense",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.state.organization = organization;
    this.state.accountingPolicy = {
      id: id("policy"),
      organizationId: organization.id,
      accountingStartDate: input.accountingStartDate,
      costMethod: "fifo",
      accountingCurrency: "RUB",
      allowOpenPeriodEdits: input.allowOpenPeriodEdits ?? true,
      comment: input.comment
    };
    this.state.periods.push(...monthPeriods(organization.id, input.accountingStartDate, 24));
    this.state.chartAccounts.push(...seedChartAccounts(organization.id));
    this.ensureRequiredSystemMetadata();

    this.state.cashAccounts.push({
      id: id("cash"),
      organizationId: organization.id,
      name: "Расчетный счет",
      accountCode: "51",
      balanceRub: 0,
      isActive: true
    });

    this.state.counterparties.push({
      id: id("cp"),
      organizationId: organization.id,
      name: "Владелец",
      counterpartyType: "owner",
      country: "RU",
      isActive: true
    });

    this.state.warehouses.push(
      {
        id: id("wh"),
        organizationId: organization.id,
        name: "Мой склад",
        warehouseType: "own",
        isActive: true
      },
      {
        id: id("wh"),
        organizationId: organization.id,
        name: "В пути",
        warehouseType: "transit",
        isActive: true
      },
      {
        id: id("wh"),
        organizationId: organization.id,
        name: "Точка продаж",
        warehouseType: "sales_point",
        isActive: true
      }
    );

    this.state.integrationPlugins.push(
      { id: id("plugin"), code: "ozon", displayName: "Ozon", status: "available" },
      { id: id("plugin"), code: "wildberries", displayName: "Wildberries", status: "available" },
      { id: id("plugin"), code: "manual", displayName: "Ручной канал", status: "installed" }
    );

    this.state.expenseCategories.push(
      { id: id("expense_cat"), organizationId: organization.id, name: "Зарплата и подрядчики", accountCode: "26" },
      { id: id("expense_cat"), organizationId: organization.id, name: "Реклама", accountCode: "44" },
      { id: id("expense_cat"), organizationId: organization.id, name: "Прочие расходы", accountCode: "91.02" }
    );

    this.state.users.push({
      id: id("user"),
      organizationId: organization.id,
      email: "owner@mpflow.local",
      name: "Владелец",
      roleCode: "owner",
      status: "active",
      invitedAt: nowIso(),
      lastActiveAt: nowIso()
    });
    this.state.roles.push(
      { id: id("role"), organizationId: organization.id, code: "owner", name: "Владелец" },
      { id: id("role"), organizationId: organization.id, code: "accountant", name: "Бухгалтер" },
      { id: id("role"), organizationId: organization.id, code: "operator", name: "Оператор" },
      { id: id("role"), organizationId: organization.id, code: "viewer", name: "Наблюдатель" }
    );

    this.audit("organization", organization.id, "bootstrap", undefined, organization, "Первичная настройка");
    return this.dashboard();
  }

  ensureBootstrapped() {
    if (!this.state.organization || !this.state.accountingPolicy) {
      throw new DomainError("not_configured", "Сначала настройте организацию");
    }
    return { organization: this.state.organization, policy: this.state.accountingPolicy };
  }

  currentOrgId(): ID {
    return this.ensureBootstrapped().organization.id;
  }

  private ensureRequiredSystemMetadata() {
    const organizationId = this.state.organization?.id;
    if (!organizationId) return;
    const accountsByCode = new Map(this.state.chartAccounts.map((account) => [account.code, account]));
    for (const seed of seedChartAccounts(organizationId)) {
      const account = accountsByCode.get(seed.code);
      if (account) {
        account.name = seed.name;
        account.kind = seed.kind;
        account.normalSide = seed.normalSide;
        account.isActive = seed.isActive;
      } else {
        this.state.chartAccounts.push(seed);
      }
    }
    const documentTypesByCode = new Map(this.state.documentTypes.map((documentType) => [documentType.code, documentType]));
    for (const seed of seedDocumentTypes()) {
      const documentType = documentTypesByCode.get(seed.code);
      if (documentType) {
        documentType.moduleCode = seed.moduleCode;
        documentType.displayName = seed.displayName;
        documentType.isPosting = seed.isPosting;
        documentType.postingRuleCode = seed.postingRuleCode;
        documentType.allowsDraft = seed.allowsDraft;
        documentType.allowsReversal = seed.allowsReversal;
        documentType.allowsCorrection = seed.allowsCorrection;
      } else {
        this.state.documentTypes.push(seed);
      }
    }
  }

  private invalidateExternalEventLookups() {
    this.invalidateSaleLookup();
  }

  dashboard() {
    const org = this.state.organization;
    return {
      organization: org,
      configured: Boolean(org),
      policy: this.state.accountingPolicy,
      currentPeriod: this.state.periods.find((period) => period.status === "open"),
      counters: {
        products: this.state.products.length,
        documents: this.state.documents.length,
        postedDocuments: this.state.documents.filter((document) => document.status === "posted").length,
        inventoryLots: this.state.inventoryLots.filter((lot) => lot.qtyRemaining > 0).length,
        openCorrections: this.state.correctionCases.filter((correction) => correction.status !== "applied").length
      },
      balances: this.ledgerBalances()
    };
  }

  setupDemo() {
    this.bootstrap({
      displayName: "ИП Иванов",
      accountingStartDate: "2026-06-01"
    });

    if (this.state.products.length > 0) {
      return this.dashboard();
    }

    const productA = this.createProduct({
      sku: "CASE-001",
      name: "Чехол MagSafe прозрачный",
      barcode: "4600000000011",
      category: "Аксессуары",
      unit: "шт",
      weightGrams: 50,
      lengthMm: 160,
      widthMm: 80,
      heightMm: 20,
      imageUrl: "https://images.unsplash.com/photo-1603313011101-320f26a4f6f6?auto=format&fit=crop&w=160&q=80"
    });
    const productB = this.createProduct({
      sku: "CABLE-USB-C",
      name: "Кабель USB-C 1м",
      barcode: "4600000000028",
      category: "Кабели",
      unit: "шт",
      weightGrams: 30,
      lengthMm: 100,
      widthMm: 50,
      heightMm: 20,
      imageUrl: "https://images.unsplash.com/photo-1612815154858-60aa4c59eaa6?auto=format&fit=crop&w=160&q=80"
    });
    const supplier = this.createCounterparty({ name: "Shenzhen Good Supply", counterpartyType: "supplier", country: "CN" });
    this.recordOwnerContribution({ amountRub: 500_000, paidAt: "2026-06-01", comment: "Стартовый капитал" });
    const po = this.createPurchaseOrder({
      supplierId: supplier.id,
      destinationWarehouseId: this.ownWarehouse().id,
      supplierCurrency: "CNY",
      orderedAt: "2026-06-02",
      lines: [
        { productId: productA.id, qty: 1000, supplierUnitPrice: 10 },
        { productId: productB.id, qty: 500, supplierUnitPrice: 8 }
      ],
      post: true
    });
    this.recordSupplierPayment({
      purchaseOrderId: po.id,
      amountRub: 130_000,
      paidAt: "2026-06-03",
      comment: "Оплата товара поставщику"
    });
    this.receiveGoods({
      purchaseOrderId: po.id,
      warehouseId: this.ownWarehouse().id,
      receiptDate: "2026-06-12",
      lines: [
        { purchaseOrderLineId: this.state.purchaseOrderLines.find((line) => line.purchaseOrderId === po.id && line.productId === productA.id)!.id, qtyReceived: 990 },
        { purchaseOrderLineId: this.state.purchaseOrderLines.find((line) => line.purchaseOrderId === po.id && line.productId === productB.id)!.id, qtyReceived: 500 }
      ]
    });
    this.addProcurementCost({
      purchaseOrderId: po.id,
      costType: "delivery",
      costDate: "2026-06-14",
      amountRub: 25_000,
      paidImmediately: true,
      comment: "Доставка до Москвы"
    });
    const channel = this.createSalesChannel({ name: "Ozon FBO", channelType: "marketplace", pluginCode: "ozon", enabledStreams: ["products", "stocks", "sales", "returns", "finance_events", "payouts"] });
    channel.status = "active";
    this.transferStock({
      fromWarehouseId: this.ownWarehouse().id,
      toWarehouseId: channel.salesPointWarehouseId,
      transferDate: "2026-06-15",
      lines: [
        { productId: productA.id, qty: 200 },
        { productId: productB.id, qty: 100 }
      ]
    });
    this.recordSale({
      channelId: channel.id,
      saleDate: "2026-06-18",
      lines: [
        { productId: productA.id, qty: 5, priceRub: 950 },
        { productId: productB.id, qty: 3, priceRub: 490 }
      ]
    });
    this.recordChannelFee({
      channelId: channel.id,
      eventKind: "commission",
      occurredAt: "2026-06-18",
      amountRub: 720,
      comment: "Комиссия канала"
    });
    this.recordChannelPayout({
      channelId: channel.id,
      payoutDate: "2026-06-22",
      bankReceiptRub: 5_520
    });

    return this.dashboard();
  }

  createCounterparty(input: {
    name: string;
    counterpartyType: Counterparty["counterpartyType"];
    country?: string;
    inn?: string;
  }): Counterparty {
    const organizationId = this.currentOrgId();
    const counterparty: Counterparty = {
      id: id("cp"),
      organizationId,
      name: input.name,
      counterpartyType: input.counterpartyType,
      country: input.country,
      inn: input.inn,
      isActive: true
    };
    this.state.counterparties.push(counterparty);
    this.audit("counterparty", counterparty.id, "create", undefined, counterparty);
    return counterparty;
  }

  createProduct(input: {
    sku: string;
    name: string;
    unit?: string;
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
  }): Product {
    const organizationId = this.currentOrgId();
    if (this.state.products.some((product) => product.organizationId === organizationId && product.sku === input.sku)) {
      throw new DomainError("duplicate_sku", "Товар с таким SKU уже есть");
    }
    const product: Product = {
      id: id("prod"),
      organizationId,
      sku: input.sku,
      name: input.name,
      unit: input.unit || "шт",
      barcode: input.barcode,
      category: input.category,
      brand: input.brand,
      description: input.description,
      weightGrams: input.weightGrams,
      lengthMm: input.lengthMm,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      manufacturerArticle: input.manufacturerArticle,
      comment: input.comment,
      imageUrl: input.imageUrl,
      status: "active",
      createdAt: nowIso()
    };
    this.state.products.push(product);
    this.audit("product", product.id, "create", undefined, product);
    return product;
  }

  updateProduct(productId: ID, input: Partial<{
    sku: string;
    name: string;
    unit?: string;
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
  }>): Product {
    const organizationId = this.currentOrgId();
    const product = this.mustFind(this.state.products, productId, "product_not_found");
    const before = { ...product };
    if (input.sku && input.sku !== product.sku) {
      if (this.state.products.some((candidate) => candidate.organizationId === organizationId && candidate.id !== product.id && candidate.sku === input.sku)) {
        throw new DomainError("duplicate_sku", "Товар с таким SKU уже есть");
      }
      product.sku = input.sku;
    }
    if (input.name !== undefined) product.name = input.name;
    if (input.unit !== undefined) product.unit = input.unit || "шт";
    if (input.barcode !== undefined) product.barcode = input.barcode || undefined;
    if (input.category !== undefined) product.category = input.category || undefined;
    if (input.brand !== undefined) product.brand = input.brand || undefined;
    if (input.description !== undefined) product.description = input.description || undefined;
    if (input.weightGrams !== undefined) product.weightGrams = input.weightGrams;
    if (input.lengthMm !== undefined) product.lengthMm = input.lengthMm;
    if (input.widthMm !== undefined) product.widthMm = input.widthMm;
    if (input.heightMm !== undefined) product.heightMm = input.heightMm;
    if (input.manufacturerArticle !== undefined) product.manufacturerArticle = input.manufacturerArticle || undefined;
    if (input.comment !== undefined) product.comment = input.comment || undefined;
    if (input.imageUrl !== undefined) product.imageUrl = input.imageUrl || undefined;
    this.audit("product", product.id, "update", before, product);
    return product;
  }

  archiveProduct(productId: ID): Product {
    const product = this.mustFind(this.state.products, productId, "product_not_found");
    const before = { ...product };
    product.status = "archived";
    this.audit("product", product.id, "archive", before, product);
    return product;
  }

  restoreProduct(productId: ID): Product {
    const product = this.mustFind(this.state.products, productId, "product_not_found");
    const before = { ...product };
    product.status = "active";
    this.audit("product", product.id, "restore", before, product);
    return product;
  }

  createWarehouse(input: { name: string; warehouseType: Warehouse["warehouseType"]; channelId?: ID }): Warehouse {
    const organizationId = this.currentOrgId();
    const warehouse: Warehouse = {
      id: id("wh"),
      organizationId,
      name: input.name,
      warehouseType: input.warehouseType,
      channelId: input.channelId,
      isActive: true
    };
    this.state.warehouses.push(warehouse);
    this.audit("warehouse", warehouse.id, "create", undefined, warehouse);
    return warehouse;
  }

  createOpeningBalance(input: {
    warehouseId: ID;
    date: string;
    comment?: string;
    post?: boolean;
    lines: Array<{ productId: ID; qty: number; costRub?: number; unitCostRub?: number; stateCode?: string }>;
  }) {
    const { policy } = this.ensureBootstrapped();
    if (input.date !== policy.accountingStartDate) {
      throw new DomainError("opening_balance_date_must_match_start", "Дата стартового остатка должна совпадать с датой начала учета");
    }
    this.assertAccountingDateAllowed(input.date);
    const warehouse = this.mustFind(this.state.warehouses, input.warehouseId, "warehouse_not_found");
    if (!warehouse.isActive) {
      throw new DomainError("warehouse_inactive", "Склад недоступен для стартового остатка");
    }
    const seen = new Set<string>();
    const normalizedLines = input.lines.map((line) => {
      const product = this.mustFind(this.state.products, line.productId, "product_not_found");
      if (product.status !== "active") {
        throw new DomainError("product_archived", `Архивный товар нельзя использовать: ${product.sku}`);
      }
      assertPositive(line.qty, "Количество стартового остатка должно быть положительным");
      const stateCode = line.stateCode ?? "sellable";
      if (!OPENING_STOCK_STATE_CODES.has(stateCode)) {
        throw new DomainError("stock_state_not_found", "Выберите корректное состояние товара");
      }
      const lineCostRub = line.costRub ?? (line.unitCostRub !== undefined ? round2(line.unitCostRub * line.qty) : undefined);
      if (lineCostRub === undefined) {
        throw new DomainError("opening_balance_cost_required", "Укажите себестоимость строки");
      }
      assertNonNegative(lineCostRub, "Стоимость стартового остатка не может быть отрицательной");
      const duplicateKey = `${line.productId}:${stateCode}`;
      if (seen.has(duplicateKey)) {
        throw new DomainError("opening_balance_duplicate_line", "Повтор товара и состояния в стартовом остатке. Объедините строки.");
      }
      seen.add(duplicateKey);
      return { ...line, stateCode, costRub: round2(lineCostRub) };
    });
    const amountRub = round2(normalizedLines.reduce((sum, line) => sum + line.costRub, 0));
    const document = this.createDocument({
      documentType: "opening_balance",
      accountingDate: input.date,
      title: "Стартовый остаток товаров",
      amountRub,
      comment: input.comment
    });

    normalizedLines.forEach((line, index) => {
      this.state.documentLines.push({
        id: id("doc_line"),
        documentId: document.id,
        lineNo: index + 1,
        lineType: "opening_balance",
        qty: line.qty,
        amountRub: line.costRub,
        payload: {
          productId: line.productId,
          warehouseId: input.warehouseId,
          stateCode: line.stateCode,
          unitCostRub: line.qty > 0 ? round6(line.costRub / line.qty) : 0
        }
      });
    });

    if (input.post ?? true) {
      return this.postOpeningBalance(document.id);
    }
    return document;
  }

  postOpeningBalance(documentId: ID) {
    const document = this.mustFind(this.state.documents, documentId, "document_not_found");
    if (document.documentType !== "opening_balance") {
      throw new DomainError("invalid_document_type", "Документ не является стартовым остатком");
    }
    if (document.status === "posted") return document;

    const documentLines = this.state.documentLines
      .filter((line) => line.documentId === document.id)
      .sort((a, b) => a.lineNo - b.lineNo);
    if (documentLines.length === 0) {
      throw new DomainError("opening_balance_empty", "Добавьте хотя бы одну строку стартового остатка");
    }

    const warehouseId = String(documentLines[0].payload.warehouseId ?? "");
    const warehouse = this.mustFind(this.state.warehouses, warehouseId, "warehouse_not_found");
    const amountRub = round2(documentLines.reduce((sum, line) => sum + Number(line.amountRub ?? 0), 0));

    documentLines.forEach((line) => {
      const payload = line.payload as Record<string, unknown>;
      const existingLot = this.state.inventoryLots.find((lot) => lot.sourceLineId === line.id);
      if (existingLot) return;
      this.createLot({
        productId: String(payload.productId),
        warehouseId,
        stateCode: typeof payload.stateCode === "string" ? payload.stateCode : "sellable",
        documentId: document.id,
        sourceLineId: line.id,
        qty: Number(line.qty ?? 0),
        costRub: Number(line.amountRub ?? 0),
        date: document.accountingDate,
        movementType: "opening"
      });
    });

    const entry = this.postDocument(document.id, [
      { accountCode: accountForWarehouse(warehouse), debit: amountRub, memo: "Стартовый остаток товаров" },
      { accountCode: "80.01", credit: amountRub, memo: "Ввод начального капитала товарами" }
    ]);
    this.audit("inventory", document.id, "post_opening_balance", undefined, { documentId: document.id, entryId: entry?.id });
    return document;
  }

  createPurchaseOrder(input: {
    supplierId: ID;
    destinationWarehouseId: ID;
    supplierCurrency: PurchaseOrder["supplierCurrency"];
    orderedAt: string;
    lines: Array<{ productId: ID; qty: number; supplierUnitPrice: number; lineNote?: string }>;
    comment?: string;
    post?: boolean;
  }): PurchaseOrder {
    const organizationId = this.currentOrgId();
    if (input.lines.length === 0) {
      throw new DomainError("empty_order", "В заказе должна быть хотя бы одна строка");
    }
    const totalSupplierAmount = round2(input.lines.reduce((sum, line) => sum + line.qty * line.supplierUnitPrice, 0));
    const totalQty = round4(input.lines.reduce((sum, line) => sum + line.qty, 0));
    const document = this.createDocument({
      documentType: "purchase_order",
      accountingDate: input.orderedAt,
      title: "Заказ поставщику",
      amountRub: 0,
      comment: input.comment
    });
    const purchaseOrder: PurchaseOrder = {
      id: id("po"),
      organizationId,
      documentId: document.id,
      supplierId: input.supplierId,
      destinationWarehouseId: input.destinationWarehouseId,
      supplierCurrency: input.supplierCurrency,
      status: input.post ? "ordered" : "draft",
      orderedAt: input.orderedAt,
      totalSupplierAmount,
      totalQty,
      comment: input.comment
    };
    this.state.purchaseOrders.push(purchaseOrder);
    input.lines.forEach((line, index) => {
      assertPositive(line.qty, "Количество в заказе должно быть положительным");
      assertNonNegative(line.supplierUnitPrice, "Цена поставщика не может быть отрицательной");
      this.state.purchaseOrderLines.push({
        id: id("po_line"),
        purchaseOrderId: purchaseOrder.id,
        productId: line.productId,
        lineNo: index + 1,
        qtyOrdered: round4(line.qty),
        supplierUnitPrice: round6(line.supplierUnitPrice),
        supplierAmount: round2(line.qty * line.supplierUnitPrice),
        lineNote: line.lineNote
      });
    });
    this.state.documentLines.push(
      ...this.state.purchaseOrderLines
        .filter((line) => line.purchaseOrderId === purchaseOrder.id)
        .map((line) => ({
          id: id("doc_line"),
          documentId: document.id,
          lineNo: line.lineNo,
          lineType: "purchase_order_line",
          qty: line.qtyOrdered,
          payload: { purchaseOrderLineId: line.id, productId: line.productId, supplierAmount: line.supplierAmount }
        }))
    );
    if (input.post) {
      document.status = "posted";
      document.postedAt = nowIso();
      this.audit("document", document.id, "post", undefined, document, "Заказ не создает проводок");
    }
    return purchaseOrder;
  }

  recordOwnerContribution(input: { amountRub: number; paidAt: string; comment?: string; post?: boolean }) {
    assertPositive(input.amountRub, "Сумма пополнения должна быть положительной");
    const owner = this.state.counterparties.find((counterparty) => counterparty.counterpartyType === "owner");
    const payment = this.createPayment({
      paymentDirection: "incoming",
      paymentType: "owner_contribution",
      amountRub: input.amountRub,
      paidAt: input.paidAt,
      counterpartyId: owner?.id,
      comment: input.comment,
      title: "Пополнение счета личными средствами"
    });
    this.state.ownerTransactions.push({
      id: id("owner_tx"),
      organizationId: this.currentOrgId(),
      documentId: payment.documentId,
      paymentId: payment.id,
      transactionType: "contribution",
      amountRub: payment.amountRub
    });
    if (input.post !== false) {
      this.postOwnerContribution(payment.id);
    }
    return payment;
  }

  recordSupplierPayment(input: { purchaseOrderId: ID; amountRub: number; paidAt: string; comment?: string; post?: boolean }): Payment {
    assertPositive(input.amountRub, "Сумма оплаты поставщику должна быть положительной");
    const order = this.mustFind(this.state.purchaseOrders, input.purchaseOrderId, "purchase_order_not_found");
    const payment = this.createPayment({
      paymentDirection: "outgoing",
      paymentType: "supplier_payment",
      amountRub: input.amountRub,
      paidAt: input.paidAt,
      counterpartyId: order.supplierId,
      comment: input.comment,
      title: "Оплата поставщику"
    });
    const allocation: PaymentAllocation = {
      id: id("payment_alloc"),
      paymentId: payment.id,
      allocationPurpose: "goods_purchase",
      purchaseOrderId: order.id,
      documentId: order.documentId,
      amountRub: input.amountRub
    };
    this.state.paymentAllocations.push(allocation);
    this.ensureDocumentLink(payment.documentId, order.documentId, "payment");
    if (input.post !== false) {
      this.postSupplierPayment(payment.id);
    }
    return payment;
  }

  previewGoodsReceipt(input: {
    purchaseOrderId: ID;
    lines: Array<{ purchaseOrderLineId: ID; qtyReceived: number }>;
  }): ReceiptPreview {
    const order = this.mustFind(this.state.purchaseOrders, input.purchaseOrderId, "purchase_order_not_found");
    const orderLines = this.state.purchaseOrderLines.filter((line) => line.purchaseOrderId === order.id);
    const totalOrderBasis = round2(orderLines.reduce((sum, line) => sum + line.supplierAmount, 0));
    const linkedGoodsPaymentRub = round2(
      this.state.paymentAllocations
        .filter((allocation) =>
          allocation.purchaseOrderId === order.id &&
          allocation.allocationPurpose === "goods_purchase" &&
          this.isPaymentAllocationPosted(allocation)
        )
        .reduce((sum, allocation) => sum + allocation.amountRub, 0)
    );
    const previousReceiptCostRub = round2(
      this.state.goodsReceipts
        .filter((receipt) => receipt.purchaseOrderId === order.id && receipt.status === "posted" && this.isDocumentPosted(receipt.documentId))
        .reduce((sum, receipt) => sum + receipt.goodsCostRubTotal, 0)
    );
    const currentReceiptSupplierBasis = round2(
      input.lines.reduce((sum, receiptLine) => {
        const orderLine = this.mustFind(orderLines, receiptLine.purchaseOrderLineId, "purchase_order_line_not_found");
        return sum + receiptLine.qtyReceived * orderLine.supplierUnitPrice;
      }, 0)
    );
    const suggestedGoodsCostRub =
      totalOrderBasis > 0
        ? round2((linkedGoodsPaymentRub * currentReceiptSupplierBasis) / totalOrderBasis)
        : round2(linkedGoodsPaymentRub - previousReceiptCostRub);
    const boundedSuggestion = Math.max(0, round2(Math.min(suggestedGoodsCostRub, linkedGoodsPaymentRub - previousReceiptCostRub)));
    const lines = allocateReceiptLines(input.lines, orderLines, boundedSuggestion);
    return {
      linkedGoodsPaymentRub,
      previousReceiptCostRub,
      suggestedGoodsCostRub: boundedSuggestion,
      remainingAdvanceRub: round2(linkedGoodsPaymentRub - previousReceiptCostRub - boundedSuggestion),
      lines
    };
  }

  receiveGoods(input: {
    purchaseOrderId: ID;
    warehouseId: ID;
    receiptDate: string;
    lines: Array<{ purchaseOrderLineId: ID; qtyReceived: number }>;
    goodsCostRubTotal?: number;
    source?: GoodsReceipt["goodsCostSource"];
    manualCostReason?: string;
    post?: boolean;
  }): GoodsReceipt {
    const order = this.mustFind(this.state.purchaseOrders, input.purchaseOrderId, "purchase_order_not_found");
    input.lines.forEach((line) => {
      assertPositive(line.qtyReceived, "Принимаемое количество должно быть положительным");
      const ordered = this.mustFind(this.state.purchaseOrderLines, line.purchaseOrderLineId, "purchase_order_line_not_found");
      const alreadyReceived = this.receivedQtyForLine(line.purchaseOrderLineId);
      if (line.qtyReceived > ordered.qtyOrdered - alreadyReceived + 0.0001) {
        throw new DomainError("receipt_qty_exceeds_order", "Нельзя принять больше, чем осталось по заказу");
      }
    });
    const preview = this.previewGoodsReceipt({ purchaseOrderId: order.id, lines: input.lines });
    const source = input.source ?? "linked_supplier_payments";
    const goodsCostRubTotal = round2(input.goodsCostRubTotal ?? preview.suggestedGoodsCostRub);
    if (source !== "linked_supplier_payments" && !input.manualCostReason) {
      throw new DomainError("manual_cost_reason_required", "Укажите причину ручного изменения стоимости");
    }
    const allocationLines =
      goodsCostRubTotal === preview.suggestedGoodsCostRub
        ? preview.lines
        : allocateReceiptLines(input.lines, this.state.purchaseOrderLines.filter((line) => line.purchaseOrderId === order.id), goodsCostRubTotal);

    const document = this.createDocument({
      documentType: "goods_receipt",
      accountingDate: input.receiptDate,
      title: "Приемка товара",
      amountRub: goodsCostRubTotal,
      comment: input.manualCostReason
    });
    const receipt: GoodsReceipt = {
      id: id("receipt"),
      organizationId: this.currentOrgId(),
      documentId: document.id,
      purchaseOrderId: order.id,
      warehouseId: input.warehouseId,
      receiptDate: input.receiptDate,
      status: "draft",
      goodsCostRubTotal,
      goodsCostSource: source,
      suggestedGoodsCostRub: preview.suggestedGoodsCostRub,
      manualCostReason: input.manualCostReason
    };
    this.state.goodsReceipts.push(receipt);
    allocationLines.forEach((line, index) => {
      const receiptLine: GoodsReceiptLine = {
        id: id("receipt_line"),
        goodsReceiptId: receipt.id,
        purchaseOrderLineId: line.purchaseOrderLineId,
        productId: line.productId,
        qtyReceived: line.qtyReceived,
        supplierAmountBasis: line.supplierAmountBasis,
        allocatedGoodsCostRub: line.allocatedGoodsCostRub,
        unitCostRub: line.unitCostRub
      };
      this.state.goodsReceiptLines.push(receiptLine);
      this.state.documentLines.push({
        id: id("doc_line"),
        documentId: document.id,
        lineNo: index + 1,
        lineType: "goods_receipt_line",
        qty: receiptLine.qtyReceived,
        amountRub: receiptLine.allocatedGoodsCostRub,
        payload: { receiptLineId: receiptLine.id, productId: receiptLine.productId }
      });
    });
    if (input.post !== false) {
      this.postGoodsReceipt(receipt.id);
    }
    return receipt;
  }

  addProcurementCost(input: {
    purchaseOrderId?: ID;
    costType: ProcurementCost["costType"];
    allocationBasis?: ProcurementCost["allocationBasis"];
    costDate: string;
    amountRub: number;
    paidImmediately: boolean;
    comment?: string;
    post?: boolean;
  }): ProcurementCost {
    assertPositive(input.amountRub, "Сумма расхода должна быть положительной");
    const allocationBasis = input.allocationBasis ?? "by_cost";
    // До приёмки партий ещё нет — расход висит «в пути» (41.02) и распределяется при приёмке.
    const hasLots = this.procurementCostTargets(input.purchaseOrderId, allocationBasis).length > 0;
    const organizationId = this.currentOrgId();
    const document = this.createDocument({
      documentType: "procurement_cost",
      accountingDate: input.costDate,
      title: "Дополнительный расход закупки",
      amountRub: input.amountRub,
      comment: input.comment
    });
    const cost: ProcurementCost = {
      id: id("proc_cost"),
      organizationId,
      documentId: document.id,
      purchaseOrderId: input.purchaseOrderId,
      costType: input.costType,
      allocationBasis,
      status: "draft",
      costDate: input.costDate,
      amountRub: input.amountRub,
      paidImmediately: input.paidImmediately,
      comment: input.comment,
      pendingAllocation: hasLots ? undefined : true
    };
    this.state.procurementCosts.push(cost);

    if (hasLots) {
      this.buildProcurementCostLines(cost, document, this.previewProcurementCost({
        purchaseOrderId: input.purchaseOrderId,
        allocationBasis,
        amountRub: input.amountRub
      }));
    }
    if (input.post !== false) {
      this.postProcurementCost(cost.id);
    }
    return cost;
  }

  private buildProcurementCostLines(cost: ProcurementCost, document: Document, preview: ProcurementCostPreview) {
    preview.lines.forEach((line) => {
      this.state.procurementCostLines.push({
        id: id("proc_cost_line"),
        procurementCostId: cost.id,
        productId: line.productId,
        lotId: line.lotId,
        warehouseId: line.warehouseId,
        basisValue: line.basisValue,
        qtyInitial: line.qtyInitial,
        qtyRemaining: line.qtyRemaining,
        qtySold: line.qtySold,
        allocatedAmountRub: line.allocatedAmountRub,
        remainingInventoryAmountRub: line.remainingInventoryAmountRub,
        soldCostAmountRub: line.soldCostAmountRub
      });
      this.state.documentLines.push({
        id: id("doc_line"),
        documentId: document.id,
        lineNo: this.state.documentLines.filter((candidate) => candidate.documentId === document.id).length + 1,
        lineType: "procurement_cost_line",
        amountRub: line.allocatedAmountRub,
        payload: {
          lotId: line.lotId,
          productId: line.productId,
          warehouseId: line.warehouseId,
          remainingInventoryAmountRub: line.remainingInventoryAmountRub,
          soldCostAmountRub: line.soldCostAmountRub
        }
      });
    });
  }

  previewProcurementCost(input: {
    purchaseOrderId?: ID;
    allocationBasis?: ProcurementCost["allocationBasis"];
    amountRub: number;
  }): ProcurementCostPreview {
    const amountRub = round2(input.amountRub);
    assertNonNegative(amountRub, "Сумма расхода не может быть отрицательной");
    const allocationBasis = input.allocationBasis ?? "by_cost";
    const targets = this.procurementCostTargets(input.purchaseOrderId, allocationBasis);
    if (targets.length === 0) {
      throw new DomainError("procurement_cost_no_lots", "Нет партий для распределения расхода");
    }
    const totalBasis = round6(targets.reduce((sum, target) => sum + target.basisValue, 0));
    if (totalBasis <= 0 && amountRub > 0) {
      throw new DomainError("procurement_cost_no_basis", "Нет базы для распределения расхода");
    }

    let allocated = 0;
    let remainingInventoryAmountRub = 0;
    let soldCostAmountRub = 0;
    const lines = targets.map((target, index): ProcurementCostPreviewLine => {
      const isLast = index === targets.length - 1;
      const allocatedAmountRub = isLast ? round2(amountRub - allocated) : round2((amountRub * target.basisValue) / totalBasis);
      allocated = round2(allocated + allocatedAmountRub);
      const soldRatio = target.qtyInitial > 0 ? Math.max(0, Math.min(1, target.qtySold / target.qtyInitial)) : 0;
      const soldAmount = round2(allocatedAmountRub * soldRatio);
      const remainingAmount = round2(allocatedAmountRub - soldAmount);
      remainingInventoryAmountRub = round2(remainingInventoryAmountRub + remainingAmount);
      soldCostAmountRub = round2(soldCostAmountRub + soldAmount);
      return {
        lotId: target.lot.id,
        productId: target.lot.productId,
        warehouseId: target.lot.warehouseId,
        qtyInitial: target.qtyInitial,
        qtyRemaining: target.qtyRemaining,
        qtySold: target.qtySold,
        basisValue: target.basisValue,
        allocatedAmountRub,
        remainingInventoryAmountRub: remainingAmount,
        soldCostAmountRub: soldAmount,
        unitCostDeltaRub: target.qtyRemaining > 0 ? round6(remainingAmount / target.qtyRemaining) : 0
      };
    });

    const correction = round2(amountRub - remainingInventoryAmountRub - soldCostAmountRub);
    if (correction !== 0 && lines.length > 0) {
      const last = lines[lines.length - 1];
      if (last.qtyRemaining > 0) {
        last.remainingInventoryAmountRub = round2(last.remainingInventoryAmountRub + correction);
        last.unitCostDeltaRub = round6(last.remainingInventoryAmountRub / last.qtyRemaining);
        remainingInventoryAmountRub = round2(remainingInventoryAmountRub + correction);
      } else {
        last.soldCostAmountRub = round2(last.soldCostAmountRub + correction);
        soldCostAmountRub = round2(soldCostAmountRub + correction);
      }
    }

    return {
      purchaseOrderId: input.purchaseOrderId,
      allocationBasis,
      amountRub,
      totalBasis,
      remainingInventoryAmountRub,
      soldCostAmountRub,
      lines
    };
  }

  resolveShortage(input: {
    purchaseOrderId: ID;
    resolvedAt: string;
    reason: string;
    lines: Array<{ purchaseOrderLineId: ID; action: ShortageResolutionLine["action"]; qtyShortage?: number }>;
    post?: boolean;
  }): ShortageResolution {
    const order = this.mustFind(this.state.purchaseOrders, input.purchaseOrderId, "purchase_order_not_found");
    const document = this.createDocument({
      documentType: "shortage_resolution",
      accountingDate: input.resolvedAt,
      title: "Решение по недопоставке",
      amountRub: 0,
      comment: input.reason
    });
    const resolution: ShortageResolution = {
      id: id("shortage"),
      organizationId: this.currentOrgId(),
      documentId: document.id,
      purchaseOrderId: order.id,
      status: "draft",
      reason: input.reason,
      resolvedAt: input.resolvedAt
    };
    this.state.shortageResolutions.push(resolution);
    input.lines.forEach((line, index) => {
      const orderLine = this.mustFind(this.state.purchaseOrderLines, line.purchaseOrderLineId, "purchase_order_line_not_found");
      const openQty = this.openShortageQtyForLine(order.id, orderLine.id);
      const qtyShortage = round4(line.qtyShortage ?? openQty);
      const paidShareRub = this.paidShareForOrderLine(order.id, orderLine, qtyShortage);
      const resolutionLine: ShortageResolutionLine = {
        id: id("shortage_line"),
        shortageResolutionId: resolution.id,
        purchaseOrderLineId: orderLine.id,
        productId: orderLine.productId,
        qtyShortage,
        paidShareRub,
        action: line.action
      };
      this.state.shortageResolutionLines.push(resolutionLine);
      this.state.documentLines.push({
        id: id("doc_line"),
        documentId: document.id,
        lineNo: index + 1,
        lineType: "shortage_resolution_line",
        qty: qtyShortage,
        amountRub: paidShareRub,
        payload: { ...resolutionLine }
      });
    });
    if (input.post !== false) {
      this.postShortage(resolution.id);
    }
    return resolution;
  }

  transferStock(input: {
    fromWarehouseId: ID;
    toWarehouseId: ID;
    fromStockStateCode?: string;
    toStockStateCode?: string;
    transferType?: StockTransfer["transferType"];
    channelId?: ID;
    sourceGoodsReceiptId?: ID;
    sourceDocumentId?: ID;
    providerMetadata?: Record<string, unknown>;
    transferDate: string;
    lines: Array<{
      productId: ID;
      qty: number;
      sourceGoodsReceiptLineId?: ID;
      sourcePurchaseOrderLineId?: ID;
      providerMetadata?: Record<string, unknown>;
    }>;
    comment?: string;
    post?: boolean;
  }): StockTransfer {
    if (input.fromWarehouseId === input.toWarehouseId && (input.fromStockStateCode ?? "sellable") === (input.toStockStateCode ?? "sellable")) {
      throw new DomainError("transfer_same_source_target", "Нечего перемещать: место и состояние совпадают");
    }
    const organizationId = this.currentOrgId();
    const document = this.createDocument({
      documentType: "stock_transfer",
      accountingDate: input.transferDate,
      title: "Перемещение товара",
      amountRub: 0,
      comment: input.comment
    });
    const fromWarehouse = this.mustFind(this.state.warehouses, input.fromWarehouseId, "warehouse_not_found");
    const toWarehouse = this.mustFind(this.state.warehouses, input.toWarehouseId, "warehouse_not_found");
    const transferType = input.transferType
      ?? (toWarehouse.warehouseType === "sales_point"
        ? fromWarehouse.warehouseType === "transit"
          ? "from_transit_to_sales_point"
          : "to_sales_point"
        : input.fromWarehouseId === input.toWarehouseId
          ? "state_change"
          : "internal");
    const transfer: StockTransfer = {
      id: id("transfer"),
      organizationId,
      documentId: document.id,
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      fromStockStateCode: input.fromStockStateCode ?? "sellable",
      toStockStateCode: input.toStockStateCode ?? "sellable",
      transferType,
      channelId: input.channelId,
      sourceGoodsReceiptId: input.sourceGoodsReceiptId,
      sourceDocumentId: input.sourceDocumentId,
      providerMetadata: input.providerMetadata,
      status: "draft",
      transferDate: input.transferDate,
      comment: input.comment
    };
    this.state.stockTransfers.push(transfer);
    input.lines.forEach((line, index) => {
      assertPositive(line.qty, "Количество перемещения должно быть положительным");
      this.state.stockTransferLines.push({
        id: id("transfer_line"),
        stockTransferId: transfer.id,
        productId: line.productId,
        qty: line.qty,
        costRub: 0,
        sourceGoodsReceiptLineId: line.sourceGoodsReceiptLineId,
        sourcePurchaseOrderLineId: line.sourcePurchaseOrderLineId,
        providerMetadata: line.providerMetadata
      });
      this.state.documentLines.push({
        id: id("doc_line"),
        documentId: document.id,
        lineNo: index + 1,
        lineType: "stock_transfer_line",
        qty: line.qty,
        amountRub: 0,
        payload: {
          productId: line.productId,
          fromWarehouseId: input.fromWarehouseId,
          toWarehouseId: input.toWarehouseId,
          fromStockStateCode: transfer.fromStockStateCode,
          toStockStateCode: transfer.toStockStateCode,
          sourceGoodsReceiptLineId: line.sourceGoodsReceiptLineId,
          sourcePurchaseOrderLineId: line.sourcePurchaseOrderLineId,
          channelId: input.channelId,
          providerMetadata: line.providerMetadata ?? input.providerMetadata
        }
      });
    });
    if (input.post !== false) {
      this.postStockTransfer(transfer.id);
    }
    return transfer;
  }

  createSalesChannel(input: {
    name: string;
    channelType: SalesChannel["channelType"];
    pluginCode?: string;
    salesPointWarehouseId?: ID;
    enabledStreams?: SalesChannel["enabledStreams"];
  }): SalesChannel {
    const organizationId = this.currentOrgId();
    let warehouseId = input.salesPointWarehouseId;
    if (warehouseId) {
      const found = this.state.warehouses.find((w) => w.id === warehouseId && w.warehouseType === "sales_point");
      if (!found) throw new DomainError("warehouse_not_found", "Точка продаж не найдена или не является точкой продаж");
    } else {
      const warehouse = this.createWarehouse({ name: `${input.name} - точка продаж`, warehouseType: "sales_point" });
      warehouseId = warehouse.id;
    }
    const plugin = input.pluginCode ? this.state.integrationPlugins.find((candidate) => candidate.code === input.pluginCode) : undefined;
    const channel: SalesChannel = {
      id: id("channel"),
      organizationId,
      name: input.name,
      channelType: input.channelType,
      pluginId: plugin?.id,
      salesPointWarehouseId: warehouseId,
      clearingAccountCode: "76.ТП",
      status: input.pluginCode ? "needs_setup" : "active",
      enabledStreams: input.enabledStreams
    };
    const linkedWarehouse = this.state.warehouses.find((w) => w.id === warehouseId);
    if (linkedWarehouse && !linkedWarehouse.channelId) linkedWarehouse.channelId = channel.id;
    this.state.salesChannels.push(channel);
    this.audit("sales_channel", channel.id, "create", undefined, channel);
    return channel;
  }

  updateSalesChannel(channelId: ID, patch: Partial<Pick<SalesChannel, "name" | "channelType" | "salesPointWarehouseId" | "enabledStreams" | "status">> & { pluginCode?: string }) {
    const channel = this.mustFind(this.state.salesChannels, channelId, "channel_not_found");
    if (patch.name !== undefined) channel.name = patch.name;
    if (patch.channelType !== undefined) channel.channelType = patch.channelType;
    if (patch.enabledStreams !== undefined) channel.enabledStreams = patch.enabledStreams;
    if (patch.status !== undefined) channel.status = patch.status;
    if (patch.salesPointWarehouseId !== undefined) {
      const warehouse = this.state.warehouses.find((w) => w.id === patch.salesPointWarehouseId && w.warehouseType === "sales_point");
      if (!warehouse) throw new DomainError("warehouse_not_found", "Точка продаж не найдена");
      channel.salesPointWarehouseId = patch.salesPointWarehouseId;
      if (!warehouse.channelId) warehouse.channelId = channel.id;
      this.state.observedStocks
        .filter((candidate) => candidate.channelId === channel.id)
        .forEach((candidate) => {
          candidate.warehouseId = patch.salesPointWarehouseId;
          candidate.locationStatus = "mapped";
        });
    }
    if (patch.pluginCode !== undefined) {
      const plugin = this.state.integrationPlugins.find((candidate) => candidate.code === patch.pluginCode);
      channel.pluginId = plugin?.id;
    }
    this.audit("sales_channel", channel.id, "update", undefined, channel);
    return channel;
  }

  createExternalProduct(input: {
    channelId: ID;
    externalSku: string;
    externalName: string;
    imageUrl?: string;
  }): ExternalProduct {
    const existing = this.findExternalProduct(input.channelId, input.externalSku);
    if (existing) {
      existing.externalName = input.externalName;
      if (input.imageUrl) existing.imageUrl = input.imageUrl;
      return existing;
    }
    const externalProduct: ExternalProduct = {
      id: id("external_product"),
      organizationId: this.currentOrgId(),
      channelId: input.channelId,
      externalSku: input.externalSku,
      externalName: input.externalName,
      imageUrl: input.imageUrl,
      status: "active"
    };
    this.state.externalProducts.push(externalProduct);
    this.ensureExternalProductIndex().set(this.externalProductKey(externalProduct.channelId, externalProduct.externalSku), externalProduct);
    return externalProduct;
  }

  linkExternalProduct(input: { productId: ID; externalProductId: ID }): ProductExternalLink {
    const externalProduct = this.mustFind(this.state.externalProducts, input.externalProductId, "external_product_not_found");
    this.mustFind(this.state.products, input.productId, "product_not_found");
    const linkedElsewhere = this.state.productExternalLinks.find((link) =>
      link.externalProductId === input.externalProductId &&
      link.status === "active" &&
      link.productId !== input.productId
    );
    if (linkedElsewhere) {
      throw new DomainError("external_product_already_linked", "Внешняя карточка уже связана с другим товаром");
    }
    const existing = this.state.productExternalLinks.find((link) =>
      link.productId === input.productId &&
      link.externalProductId === input.externalProductId &&
      link.status === "active"
    );
    if (existing) return existing;
    const link: ProductExternalLink = {
      id: id("external_link"),
      organizationId: this.currentOrgId(),
      productId: input.productId,
      externalProductId: input.externalProductId,
      channelId: externalProduct.channelId,
      status: "active"
    };
    this.state.productExternalLinks.push(link);
    this.ensureActiveLinkIndex().set(link.externalProductId, link);
    if (externalProduct.status === "ignored") externalProduct.status = "active";
    this.refreshExternalReferencesForProduct(externalProduct.id);
    return link;
  }

  saveChannelCredentials(channelId: ID, credentials: Record<string, string | undefined>) {
    this.mustFind(this.state.salesChannels, channelId, "channel_not_found");
    const cleaned = Object.fromEntries(
      Object.entries(credentials).filter(([, value]) => typeof value === "string" && value.length > 0)
    ) as Record<string, string>;
    this.channelCredentials.set(channelId, cleaned);
    return {
      channelId,
      saved: Object.keys(cleaned).length > 0,
      fields: Object.keys(cleaned)
    };
  }

  clearCredentialsForChannel(channelId: ID) {
    this.channelCredentials.delete(channelId);
    return { channelId, saved: false, fields: [] as string[] };
  }

  credentialsForChannel(channelId: ID) {
    return this.channelCredentials.get(channelId);
  }

  exportChannelCredentials() {
    return Object.fromEntries(
      Array.from(this.channelCredentials.entries()).map(([channelId, credentials]) => [
        channelId,
        { ...credentials }
      ])
    ) as Record<ID, Record<string, string | undefined>>;
  }

  importChannelCredentials(credentialsByChannel: Record<ID, Record<string, string | undefined>>) {
    this.channelCredentials.clear();
    for (const [channelId, credentials] of Object.entries(credentialsByChannel)) {
      const cleaned = Object.fromEntries(
        Object.entries(credentials).filter(([, value]) => typeof value === "string" && value.length > 0)
      ) as Record<string, string>;
      if (Object.keys(cleaned).length > 0) {
        this.channelCredentials.set(channelId, cleaned);
      }
    }
  }

  channelCredentialStatus(channelId: ID) {
    const credentials = this.channelCredentials.get(channelId);
    return {
      channelId,
      saved: Boolean(credentials && Object.keys(credentials).length > 0),
      fields: Object.keys(credentials ?? {})
    };
  }

  listPluginStateRecords(filter: {
    pluginCode?: string;
    namespace?: string;
    scopeType?: PluginStateScopeType;
    scopeId?: ID;
    stateKey?: string;
  } = {}) {
    return this.state.pluginStateRecords.filter((record) =>
      (!filter.pluginCode || record.pluginCode === filter.pluginCode) &&
      (!filter.namespace || record.namespace === filter.namespace) &&
      (!filter.scopeType || record.scopeType === filter.scopeType) &&
      (!filter.scopeId || record.scopeId === filter.scopeId) &&
      (!filter.stateKey || record.stateKey === filter.stateKey)
    );
  }

  getPluginStateRecord(filter: {
    pluginCode: string;
    namespace: string;
    scopeType: PluginStateScopeType;
    scopeId: ID;
    stateKey: string;
  }) {
    return this.state.pluginStateRecords.find((record) =>
      record.pluginCode === filter.pluginCode &&
      record.namespace === filter.namespace &&
      record.scopeType === filter.scopeType &&
      record.scopeId === filter.scopeId &&
      record.stateKey === filter.stateKey
    );
  }

  upsertPluginStateRecord(input: {
    pluginCode: string;
    namespace: string;
    visibility?: PluginStateRecord["visibility"];
    scopeType: PluginStateScopeType;
    scopeId: ID;
    stateKey: string;
    payload: Record<string, unknown>;
    expectedRevision?: number;
  }): PluginStateRecord {
    const visibility = input.visibility ?? "private";
    const now = nowIso();
    const existing = this.getPluginStateRecord({
      pluginCode: input.pluginCode,
      namespace: input.namespace,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      stateKey: input.stateKey
    });
    if (existing) {
      if (input.expectedRevision !== undefined && existing.revision !== input.expectedRevision) {
        throw new DomainError("plugin_state_revision_conflict", "Состояние плагина было изменено другим действием");
      }
      existing.payload = input.payload;
      existing.visibility = visibility;
      existing.revision += 1;
      existing.updatedAt = now;
      return existing;
    }
    if (input.expectedRevision !== undefined && input.expectedRevision !== 0) {
      throw new DomainError("plugin_state_revision_conflict", "Состояние плагина еще не существует");
    }
    const record: PluginStateRecord = {
      id: id("plugin_state"),
      organizationId: this.currentOrgId(),
      pluginCode: input.pluginCode,
      namespace: input.namespace,
      visibility,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      stateKey: input.stateKey,
      revision: 1,
      payload: input.payload,
      createdAt: now,
      updatedAt: now
    };
    this.state.pluginStateRecords.push(record);
    return record;
  }

  deletePluginStateRecord(filter: {
    pluginCode: string;
    namespace: string;
    scopeType: PluginStateScopeType;
    scopeId: ID;
    stateKey: string;
    expectedRevision?: number;
  }) {
    const existing = this.getPluginStateRecord(filter);
    if (!existing) return false;
    if (filter.expectedRevision !== undefined && existing.revision !== filter.expectedRevision) {
      throw new DomainError("plugin_state_revision_conflict", "Состояние плагина было изменено другим действием");
    }
    this.state.pluginStateRecords = this.state.pluginStateRecords.filter((record) => record.id !== existing.id);
    return true;
  }

  private pluginSecretMapKey(pluginCode: string, namespace: string, scopeType: PluginStateScopeType, scopeId: ID, secretKey: string) {
    return [pluginCode, namespace, scopeType, scopeId, secretKey].join("::");
  }

  getPluginSecret(input: {
    pluginCode: string;
    namespace: string;
    scopeType: PluginStateScopeType;
    scopeId: ID;
    secretKey: string;
  }) {
    const stored = this.pluginSecrets.get(this.pluginSecretMapKey(input.pluginCode, input.namespace, input.scopeType, input.scopeId, input.secretKey));
    return stored ? { revision: stored.revision, payload: { ...stored.payload } } : undefined;
  }

  upsertPluginSecret(input: {
    pluginCode: string;
    namespace: string;
    scopeType: PluginStateScopeType;
    scopeId: ID;
    secretKey: string;
    payload: Record<string, string | undefined>;
    expectedRevision?: number;
  }) {
    const mapKey = this.pluginSecretMapKey(input.pluginCode, input.namespace, input.scopeType, input.scopeId, input.secretKey);
    const current = this.pluginSecrets.get(mapKey);
    if (current) {
      if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) {
        throw new DomainError("plugin_secret_revision_conflict", "Секрет плагина был изменен другим действием");
      }
      current.revision += 1;
      current.payload = { ...input.payload };
      return { revision: current.revision, payload: { ...current.payload } };
    }
    if (input.expectedRevision !== undefined && input.expectedRevision !== 0) {
      throw new DomainError("plugin_secret_revision_conflict", "Секрет плагина еще не существует");
    }
    this.pluginSecrets.set(mapKey, { revision: 1, payload: { ...input.payload } });
    return { revision: 1, payload: { ...input.payload } };
  }

  deletePluginSecret(input: {
    pluginCode: string;
    namespace: string;
    scopeType: PluginStateScopeType;
    scopeId: ID;
    secretKey: string;
    expectedRevision?: number;
  }) {
    const mapKey = this.pluginSecretMapKey(input.pluginCode, input.namespace, input.scopeType, input.scopeId, input.secretKey);
    const current = this.pluginSecrets.get(mapKey);
    if (!current) return false;
    if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) {
      throw new DomainError("plugin_secret_revision_conflict", "Секрет плагина был изменен другим действием");
    }
    this.pluginSecrets.delete(mapKey);
    return true;
  }

  exportPluginSecrets() {
    return Object.fromEntries(
      Array.from(this.pluginSecrets.entries()).map(([key, value]) => [key, { revision: value.revision, payload: { ...value.payload } }])
    );
  }

  importPluginSecrets(records: Record<string, { revision: number; payload: Record<string, string | undefined> }>) {
    this.pluginSecrets.clear();
    Object.entries(records).forEach(([key, value]) => {
      this.pluginSecrets.set(key, { revision: value.revision, payload: { ...value.payload } });
    });
  }

  clearPluginSecrets() {
    this.pluginSecrets.clear();
  }

  clearChannelCredentials() {
    this.channelCredentials.clear();
  }

  /**
   * Invalidate every lazily-built lookup cache. Required whenever `state` is
   * mutated wholesale (e.g. the dev/reset endpoint does
   * `Object.assign(app.state, createEmptyState())`), since the caches index the
   * OLD arrays by reference and would otherwise resurrect phantom records
   * (a reset external-product cache returns a pre-reset card, so
   * `createExternalProduct` short-circuits without pushing to the new empty
   * array, leaving orphaned observed-stock rows).
   */
  resetLookupCaches() {
    this.externalProductByChannelSku = undefined;
    this.activeLinkByExternalProductId = undefined;
    this.saleLookup = undefined;
  }

  async ingestExternalEvent(input: {
    channelId: ID;
    eventType: ExternalEvent["eventType"];
    externalId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
    syncRunId?: ID;
    idempotencyKey?: string;
  }): Promise<ExternalEvent> {
    const idempotencyKey = input.idempotencyKey ?? input.externalId;
    const existing = await this.findExternalEventByIdentity(input.channelId, input.externalId, idempotencyKey);
    if (existing) {
      existing.syncRunId = input.syncRunId ?? existing.syncRunId;
      existing.occurredAt = input.occurredAt;
      existing.rawPayload = input.payload;
      existing.normalizedPayload = input.payload;
      if (!existing.materializedDocumentId && existing.status !== "processed" && existing.status !== "ignored") {
        existing.eventType = input.eventType;
        existing.status = "new";
        this.applyExternalEventState(existing);
      }
      existing.updatedAt = nowIso();
      await this.externalEvents.upsert(existing);
      return existing;
    }
    const createdAt = nowIso();
    const event: ExternalEvent = {
      id: id("external_event"),
      organizationId: this.currentOrgId(),
      channelId: input.channelId,
      syncRunId: input.syncRunId,
      eventType: input.eventType,
      externalId: input.externalId,
      idempotencyKey,
      occurredAt: input.occurredAt,
      rawPayload: input.payload,
      normalizedPayload: input.payload,
      status: "new",
      createdAt,
      updatedAt: createdAt
    };
    this.applyExternalEventState(event);
    await this.externalEvents.upsert(event);
    return event;
  }

  async reprocessExternalEvent(eventId: ID) {
    const event = await this.externalEvents.getById(eventId);
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    event.materializedDocumentId = undefined;
    event.lastError = undefined;
    event.reason = undefined;
    event.status = "new";
    this.applyExternalEventState(event);
    event.updatedAt = nowIso();
    await this.externalEvents.upsert(event);
    return event;
  }

  async ignoreExternalEvent(eventId: ID, reason: string) {
    const event = await this.externalEvents.getById(eventId);
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    event.status = "ignored";
    event.reason = reason;
    event.updatedAt = nowIso();
    await this.externalEvents.upsert(event);
    return event;
  }

  recordObservedStock(input: {
    channelId: ID;
    externalProductId: ID;
    observedAt: string;
    qtyObserved: number;
  }) {
    const link = this.findActiveLink(input.externalProductId);
    const channel = this.mustFind(this.state.salesChannels, input.channelId, "channel_not_found");
    const warehouseId = channel.salesPointWarehouseId;
    const existing = this.state.observedStocks.find((candidate) =>
      candidate.channelId === input.channelId &&
      candidate.externalProductId === input.externalProductId &&
      candidate.warehouseId === warehouseId &&
      candidate.observedAt === input.observedAt
    );
    if (existing) {
      existing.productId = link?.productId;
      existing.qtyObserved = input.qtyObserved;
      existing.locationStatus = warehouseId ? "mapped" : "needs_location";
      return existing;
    }
    const observed = {
      id: id("observed_stock"),
      organizationId: this.currentOrgId(),
      channelId: input.channelId,
      externalProductId: input.externalProductId,
      productId: link?.productId,
      warehouseId,
      observedAt: input.observedAt,
      qtyObserved: input.qtyObserved,
      locationStatus: warehouseId ? "mapped" as const : "needs_location" as const
    };
    this.state.observedStocks.push(observed);
    return observed;
  }

  private refreshExternalReferencesForProduct(externalProductId: ID) {
    const link = this.findActiveLink(externalProductId);
    const externalProduct = this.state.externalProducts.find((candidate) => candidate.id === externalProductId);
    if (!externalProduct) return;
    const channel = this.state.salesChannels.find((candidate) => candidate.id === externalProduct.channelId);
    for (const observed of this.state.observedStocks.filter((candidate) => candidate.externalProductId === externalProductId)) {
      observed.productId = link?.productId;
      observed.warehouseId = channel?.salesPointWarehouseId;
      observed.locationStatus = channel?.salesPointWarehouseId ? "mapped" : "needs_location";
    }
    for (const event of this.state.externalEvents.filter((candidate) => candidate.channelId === externalProduct.channelId)) {
      this.applyExternalEventState(event);
    }
  }

  private applyExternalEventState(event: ExternalEvent) {
    const payload = event.normalizedPayload as Record<string, unknown>;
    const now = nowIso();
    event.updatedAt = now;
    if (event.status === "processed" || event.status === "ignored") return event;

    event.lastError = undefined;
    event.reason = undefined;
    event.externalProductId = undefined;
    event.productId = undefined;

    if (event.eventType === "fee" || event.eventType === "sale_accrual" || event.eventType === "payout") {
      event.status = "ready_for_processing";
      return event;
    }

    const skuList = Array.isArray(payload.lines)
      ? payload.lines
          .map((line) => String((line as Record<string, unknown>).sku ?? "").trim())
          .filter(Boolean)
      : [String(payload.sku ?? "").trim()].filter(Boolean);

    if (skuList.length === 0) {
      event.status = "needs_attention";
      event.reason = "Во внешнем событии нет SKU для сопоставления";
      return event;
    }

    const missing: string[] = [];
    const linkedProductIds = new Set<ID>();

    for (const sku of skuList) {
      const externalProduct = this.findExternalProduct(event.channelId, sku);
      if (!externalProduct) {
        missing.push(sku);
        continue;
      }
      if (!event.externalProductId) event.externalProductId = externalProduct.id;
      const link = this.findActiveLink(externalProduct.id);
      if (!link) {
        missing.push(sku);
        continue;
      }
      linkedProductIds.add(link.productId);
      if (!event.productId) event.productId = link.productId;
    }

    if (missing.length > 0) {
      event.status = "needs_mapping";
      event.reason = `Нет сопоставления товара для SKU: ${missing.join(", ")}`;
      return event;
    }

    if (event.eventType === "stock" || event.eventType === "product") {
      event.status = "processed";
      return event;
    }

    event.status = "ready_for_processing";
    if (linkedProductIds.size > 1) {
      event.reason = "Событие содержит несколько товаров и готово к пакетной обработке";
    }
    return event;
  }

  recordSale(input: {
    channelId: ID;
    saleDate: string;
    externalEventId?: ID;
    externalOrderId?: string;
    warehouseId?: ID;
    post?: boolean;
    lines: Array<{ productId: ID; qty: number; priceRub: number; externalProductId?: ID }>;
  }): Sale {
    const channel = this.mustFind(this.state.salesChannels, input.channelId, "channel_not_found");
    const warehouseId = input.warehouseId ?? channel.salesPointWarehouseId;
    const revenueRub = round2(input.lines.reduce((sum, line) => sum + line.qty * line.priceRub, 0));
    const document = this.createDocument({
      documentType: "sale",
      accountingDate: input.saleDate,
      title: "Продажа",
      amountRub: revenueRub,
      source: input.externalEventId ? "plugin" : "manual"
    });
    const sale: Sale = {
      id: id("sale"),
      organizationId: this.currentOrgId(),
      documentId: document.id,
      financialDocumentId: undefined,
      channelId: channel.id,
      saleDate: input.saleDate,
      externalEventId: input.externalEventId,
      warehouseId,
      externalOrderId: input.externalOrderId,
      grossAmountRub: revenueRub,
      recognizedGrossAmountRub: undefined,
      financialRecognitionDate: undefined,
      costAmountRub: 0,
      grossProfitRub: revenueRub,
      status: "draft"
    };
    this.state.sales.push(sale);
    this.invalidateSaleLookup();
    input.lines.forEach((line, index) => {
      const saleLine: SaleLine = {
        id: id("sale_line"),
        saleId: sale.id,
        productId: line.productId,
        externalProductId: line.externalProductId,
        qty: line.qty,
        priceRub: line.priceRub,
        revenueRub: round2(line.qty * line.priceRub),
        costRub: 0,
        grossProfitRub: round2(line.qty * line.priceRub)
      };
      this.state.saleLines.push(saleLine);
      this.state.documentLines.push({
        id: id("doc_line"),
        documentId: document.id,
        lineNo: index + 1,
        lineType: "sale_line",
        qty: line.qty,
        amountRub: saleLine.revenueRub,
        payload: {
          saleLineId: saleLine.id,
          productId: line.productId,
          externalProductId: line.externalProductId,
          warehouseId,
          priceRub: line.priceRub,
          revenueRub: saleLine.revenueRub,
          costRub: 0,
          grossProfitRub: saleLine.grossProfitRub
        }
      });
    });
    if (input.post === false) return sale;
    return this.postSale(sale.id);
  }

  recordReturn(input: {
    saleId: ID;
    returnDate: string;
    warehouseId?: ID;
    stockStateCode?: string;
    comment?: string;
    refundRub?: number;
    post?: boolean;
    lines?: Array<{ saleLineId: ID; qty: number }>;
    externalEventId?: ID;
  }): SalesReturn {
    const sale = this.mustFind(this.state.sales, input.saleId, "sale_not_found");
    const saleLines = this.state.saleLines.filter((line) => line.saleId === sale.id);
    const returnLines = input.lines ?? saleLines.map((line) => ({ saleLineId: line.id, qty: line.qty }));
    const warehouseId = input.warehouseId ?? sale.warehouseId;
    const stockStateCode = input.stockStateCode ?? "sellable";
    const document = this.createDocument({
      documentType: "sales_return",
      accountingDate: input.returnDate,
      title: "Возврат от покупателя",
      amountRub: 0,
      comment: input.comment,
      source: input.externalEventId ? "plugin" : "manual"
    });
    const prepared = returnLines.map((line) => {
      const saleLine = this.mustFind(saleLines, line.saleLineId, "sale_line_not_found");
      const alreadyReturnedQty = this.returnedQtyForSaleLine(line.saleLineId);
      const maxQty = round4(Math.max(0, saleLine.qty - alreadyReturnedQty));
      if (line.qty > maxQty + 0.0001) {
        throw new DomainError("return_qty_exceeds_sale", "Нельзя вернуть больше, чем осталось к возврату", { saleLineId: line.saleLineId, maxQty });
      }
      const revenuePart = round2((saleLine.revenueRub * line.qty) / saleLine.qty);
      return { saleLine, qty: round4(line.qty), revenuePart, alreadyReturnedQty };
    });
    const proportionalRefundRub = round2(prepared.reduce((sum, line) => sum + line.revenuePart, 0));
    const totalQty = round4(prepared.reduce((sum, line) => sum + line.qty, 0));
    const refundRub = round2(input.refundRub ?? proportionalRefundRub);
    let refundAllocated = 0;
    prepared.forEach((line, index) => {
      const lineRefundRub = index === prepared.length - 1
        ? round2(refundRub - refundAllocated)
        : round2(refundRub * (proportionalRefundRub > 0 ? line.revenuePart / proportionalRefundRub : line.qty / Math.max(totalQty, 1)));
      refundAllocated = round2(refundAllocated + lineRefundRub);
      this.state.documentLines.push({
        id: id("doc_line"),
        documentId: document.id,
        lineNo: index + 1,
        lineType: "sales_return_line",
        qty: line.qty,
        amountRub: lineRefundRub,
        payload: {
          saleLineId: line.saleLine.id,
          productId: line.saleLine.productId,
          warehouseId,
          stockStateCode,
          soldQty: line.saleLine.qty,
          alreadyReturnedQty: line.alreadyReturnedQty,
          refundRub: lineRefundRub,
          restoredCostRub: 0
        }
      });
    });
    document.amountRub = refundRub;
    const salesReturn: SalesReturn = {
      id: id("return"),
      organizationId: this.currentOrgId(),
      documentId: document.id,
      saleId: sale.id,
      channelId: sale.channelId,
      externalEventId: input.externalEventId,
      returnDate: input.returnDate,
      warehouseId,
      stockStateCode,
      status: "draft",
      refundRub,
      restoredCostRub: 0,
      comment: input.comment
    };
    this.state.salesReturns.push(salesReturn);
    if (input.post === false) return salesReturn;
    return this.postReturn(salesReturn.id);
  }

  recordChannelFee(input: {
    channelId: ID;
    eventKind: ChannelFinanceEvent["eventKind"];
    treatment?: ChannelFinanceEvent["treatment"];
    category?: ChannelFinanceEvent["category"];
    occurredAt: string;
    amountRub: number;
    externalEventId?: ID;
    linkedSaleId?: ID;
    saleAllocations?: Array<{ saleId: ID; amountRub: number }>;
    linkedReturnId?: ID;
    comment?: string;
    operationType?: string;
    operationTypeName?: string;
    post?: boolean;
  }): ChannelFinanceEvent {
    assertNonNegative(input.amountRub, "Сумма события канала не может быть отрицательной");
    const document = this.createDocument({
      documentType: "channel_finance_event",
      accountingDate: input.occurredAt,
      title: channelFinanceDocumentTitle(input.eventKind, input.category),
      amountRub: input.amountRub,
      source: input.externalEventId ? "plugin" : "manual",
      comment: input.comment
    });
    const event: ChannelFinanceEvent = {
      id: id("channel_fin"),
      organizationId: this.currentOrgId(),
      channelId: input.channelId,
      externalEventId: input.externalEventId,
      documentId: document.id,
      externalId: input.externalEventId
        ? this.state.externalEvents.find((candidate) => candidate.id === input.externalEventId)?.externalId
        : undefined,
      payoutId: undefined,
      eventKind: input.eventKind,
      treatment: input.treatment ?? (input.linkedReturnId ? "return_variable" : input.linkedSaleId ? "sale_variable" : defaultFinanceTreatment(input.eventKind)),
      category: input.category ?? defaultFinanceCategory(input.eventKind),
      operationType: input.operationType,
      operationTypeName: input.operationTypeName,
      linkedSaleId: input.linkedSaleId,
      saleAllocations: input.saleAllocations?.map((allocation) => ({ saleId: allocation.saleId, amountRub: round2(allocation.amountRub) })),
      linkedReturnId: input.linkedReturnId,
      amountRub: input.amountRub,
      occurredAt: input.occurredAt,
      status: input.eventKind ? "classified" : "new",
      comment: input.comment
    };
    this.state.channelFinanceEvents.push(event);
    if (input.post === false) return event;
    return this.postChannelFinanceEvent(event.id);
  }

  recordChannelPayout(input: {
    channelId: ID;
    payoutDate: string;
    bankReceiptRub?: number;
    expectedAmountRub?: number;
    compositionMode?: "auto" | "manual";
    externalEventId?: ID;
    externalPayoutId?: string;
    periodFrom?: string;
    periodTo?: string;
    post?: boolean;
  }): Payout {
    const channel = this.mustFind(this.state.salesChannels, input.channelId, "channel_not_found");
    const compositionMode = input.compositionMode ?? "auto";
    const expectedAmountRub = round2(input.expectedAmountRub ?? 0);
    const bankReceiptRub = round2(input.bankReceiptRub ?? input.expectedAmountRub ?? 0);
    const document = this.createDocument({
      documentType: "payout",
      accountingDate: input.payoutDate,
      title: "Выплата и сверка точки продаж",
      amountRub: bankReceiptRub,
      source: input.externalEventId ? "plugin" : "manual"
    });
    const payout: Payout = {
      id: id("payout"),
      organizationId: this.currentOrgId(),
      channelId: channel.id,
      documentId: document.id,
      compositionMode,
      externalEventId: input.externalEventId,
      externalPayoutId: input.externalPayoutId,
      paymentId: undefined,
      payoutDate: input.payoutDate,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      expectedAmountRub,
      grossEventsRub: expectedAmountRub,
      bankReceiptRub,
      differenceRub: 0,
      cashAccountId: undefined,
      differenceReason: undefined,
      differenceAccepted: false,
      status: "draft"
    };
    this.state.payouts.push(payout);
    if (compositionMode === "manual" && expectedAmountRub !== 0) {
      this.state.payoutLines.push({
        id: id("payout_line"),
        payoutId: payout.id,
        sourceType: "manual_adjustment",
        lineGroup: "manual",
        amountRub: expectedAmountRub
      });
    }
    if (bankReceiptRub > 0) {
      this.linkBankPaymentToPayout({ payoutId: payout.id, bankReceiptRub });
    }
    this.rebuildPayout(payout.id);
    this.markExternalEventProcessed(input.externalEventId, document.id);
    if (input.post) return this.postChannelPayout(payout.id);
    return payout;
  }

  postSale(saleId: ID): Sale {
    const sale = this.mustFind(this.state.sales, saleId, "sale_not_found");
    const document = this.mustFind(this.state.documents, sale.documentId, "document_not_found");
    const channel = this.mustFind(this.state.salesChannels, sale.channelId, "channel_not_found");
    const deferredRecognition = saleRequiresDeferredMarketplaceRecognition(sale, channel);
    if ((sale.status === "shipped" || sale.status === "posted") && document.status === "posted") return sale;
    if (sale.status === "reversed" || document.status === "cancelled") {
      throw new DomainError("sale_not_postable", "Сторнированную или отмененную продажу нельзя провести повторно");
    }
    this.assertAccountingDateAllowed(sale.saleDate);
    const warehouse = this.mustFind(this.state.warehouses, sale.warehouseId, "warehouse_not_found");
    const saleLines = this.state.saleLines.filter((line) => line.saleId === sale.id);
    const plannedQty = new Map<ID, number>();
    saleLines.forEach((line) => {
      plannedQty.set(line.productId, round4((plannedQty.get(line.productId) ?? 0) + line.qty));
    });
    for (const [productId, qtyRequired] of plannedQty.entries()) {
      const availableQty = this.stockState(productId, sale.warehouseId).qty;
      if (availableQty + 0.0001 < qtyRequired) {
        const reason = "Недостаточно книжного остатка. Создайте перемещение, приемку или корректировку";
        sale.status = "needs_attention";
        this.markExternalEventNeedsAttention(sale.externalEventId, sale.documentId, reason);
        if (sale.externalEventId) return sale;
        throw new DomainError("insufficient_stock", reason, { productId, warehouseId: sale.warehouseId, qtyRequired, availableQty });
      }
    }

    let costRubTotal = 0;
    saleLines.forEach((line) => {
      const applications = this.consumeFifo({
        productId: line.productId,
        warehouseId: sale.warehouseId,
        qty: line.qty,
        documentId: document.id,
        occurredAt: sale.saleDate,
        applicationType: "sale",
        movementType: "sale"
      });
      applications.forEach((application) => {
        application.targetLineId = line.id;
        application.targetLineType = "sale_line";
      });
      const costRub = round2(applications.reduce((sum, application) => sum + application.costRub, 0));
      line.costRub = costRub;
      line.grossProfitRub = round2(line.revenueRub - costRub);
      costRubTotal = round2(costRubTotal + costRub);

      const documentLine = this.state.documentLines.find((candidate) =>
        candidate.documentId === document.id &&
        (candidate.payload as Record<string, unknown>)?.saleLineId === line.id
      );
      if (documentLine) {
        documentLine.amountRub = line.revenueRub;
        documentLine.qty = line.qty;
        documentLine.payload = {
          ...(documentLine.payload as Record<string, unknown>),
          costRub: line.costRub,
          grossProfitRub: line.grossProfitRub
        };
      }
    });

    sale.costAmountRub = round2(costRubTotal);
    sale.grossProfitRub = round2(sale.grossAmountRub - costRubTotal);
    sale.status = deferredRecognition ? "shipped" : "posted";
    this.postDocument(document.id, deferredRecognition
      ? [
          { accountCode: MARKETPLACE_SHIPPED_ACCOUNT_CODE, debit: costRubTotal, memo: "Продажа ждёт начисления маркетплейса" },
          { accountCode: accountForWarehouse(warehouse), credit: costRubTotal, memo: "Списание товара с точки продаж" }
        ]
      : [
          { accountCode: "76.ТП", debit: sale.grossAmountRub, memo: "Дебиторка точки продаж" },
          { accountCode: "90.01", credit: sale.grossAmountRub, memo: "Выручка от продаж" },
          { accountCode: "90.02", debit: costRubTotal, memo: "Себестоимость продаж" },
          { accountCode: accountForWarehouse(warehouse), credit: costRubTotal, memo: "Списание товара с точки продаж" }
        ]);
    if (!deferredRecognition && !this.state.settlementEntries.some((entry) => entry.documentId === document.id && entry.settlementType === "channel_receivable")) {
      this.state.settlementEntries.push({
        id: id("settlement"),
        organizationId: this.currentOrgId(),
        channelId: sale.channelId,
        documentId: document.id,
        settlementType: "channel_receivable",
        debitRub: sale.grossAmountRub,
        creditRub: 0,
        createdAt: nowIso()
      });
    }
    this.markExternalEventProcessed(sale.externalEventId, sale.documentId);
    return sale;
  }

  recognizeSaleFromFinance(input: {
    saleId: ID;
    recognitionDate: string;
    externalEventId?: ID;
    recognizedGrossAmountRub?: number;
  }): Sale {
    const sale = this.mustFind(this.state.sales, input.saleId, "sale_not_found");
    const shipmentDocument = this.mustFind(this.state.documents, sale.documentId, "document_not_found");
    const channel = this.mustFind(this.state.salesChannels, sale.channelId, "channel_not_found");
    if (!saleRequiresDeferredMarketplaceRecognition(sale, channel)) {
      if (input.externalEventId) this.markExternalEventProcessed(input.externalEventId, sale.documentId);
      return sale.status === "draft" ? this.postSale(sale.id) : sale;
    }
    if (shipmentDocument.status !== "posted" || sale.status === "draft") {
      this.postSale(sale.id);
    }
    if (sale.status !== "shipped" && sale.status !== "posted") {
      throw new DomainError("sale_not_shipped", "Сначала нужно провести операционную отгрузку продажи");
    }
    if (sale.financialDocumentId) {
      const existingFinancialDocument = this.mustFind(this.state.documents, sale.financialDocumentId, "document_not_found");
      if (existingFinancialDocument.status === "posted") {
        if (input.externalEventId) this.markExternalEventProcessed(input.externalEventId, existingFinancialDocument.id);
        sale.status = "posted";
        return sale;
      }
    }
    this.assertAccountingDateAllowed(input.recognitionDate);
    const recognizedGrossAmountRub = round2(
      input.recognizedGrossAmountRub && input.recognizedGrossAmountRub > 0
        ? input.recognizedGrossAmountRub
        : sale.grossAmountRub
    );
    const financialDocument = this.createDocument({
      documentType: MARKETPLACE_SALE_RECOGNITION_DOCUMENT_TYPE,
      accountingDate: input.recognitionDate,
      title: "Начисление продажи маркетплейса",
      amountRub: recognizedGrossAmountRub,
      source: input.externalEventId ? "plugin" : "manual"
    });
    sale.financialDocumentId = financialDocument.id;
    sale.financialRecognitionDate = input.recognitionDate;
    sale.recognizedGrossAmountRub = recognizedGrossAmountRub;
    sale.grossProfitRub = round2(recognizedGrossAmountRub - sale.costAmountRub);
    sale.status = "posted";
    this.postDocument(financialDocument.id, [
      { accountCode: "76.ТП", debit: recognizedGrossAmountRub, memo: "Начисление продажи к получению от маркетплейса" },
      { accountCode: "90.01", credit: recognizedGrossAmountRub, memo: "Выручка по продаже маркетплейса" },
      { accountCode: "90.02", debit: sale.costAmountRub, memo: "Себестоимость признанной продажи" },
      { accountCode: MARKETPLACE_SHIPPED_ACCOUNT_CODE, credit: sale.costAmountRub, memo: "Списание отгруженного товара в себестоимость" }
    ]);
    if (!this.state.settlementEntries.some((entry) => entry.documentId === financialDocument.id && entry.settlementType === "channel_receivable")) {
      this.state.settlementEntries.push({
        id: id("settlement"),
        organizationId: this.currentOrgId(),
        channelId: sale.channelId,
        documentId: financialDocument.id,
        settlementType: "channel_receivable",
        debitRub: recognizedGrossAmountRub,
        creditRub: 0,
        createdAt: nowIso()
      });
    }
    this.ensureDocumentLink(sale.documentId, financialDocument.id, "sale_finance");
    if (input.externalEventId) {
      this.markExternalEventProcessed(input.externalEventId, financialDocument.id);
    }
    return sale;
  }

  deleteSaleForResync(saleId: ID) {
    const sale = this.mustFind(this.state.sales, saleId, "sale_not_found");
    const linkedReturns = this.state.salesReturns.filter((candidate) => candidate.saleId === sale.id);
    if (linkedReturns.length > 0) {
      throw new DomainError("sale_has_returns", "Сначала удалите возвраты по этой продаже");
    }

    const linkedFinanceEvents = this.state.channelFinanceEvents.filter((event) =>
      event.linkedSaleId === sale.id || Boolean(event.saleAllocations?.some((allocation) => allocation.saleId === sale.id))
    );
    const sharedFinanceEvents = linkedFinanceEvents.filter((event) =>
      Boolean(event.saleAllocations?.some((allocation) => allocation.saleId !== sale.id))
    );
    if (sharedFinanceEvents.length > 0) {
      throw new DomainError(
        "sale_has_shared_finance_events",
        "Сначала удалите распределенные финансовые операции, которые относятся сразу к нескольким продажам"
      );
    }

    const blockedByPayout = this.state.payoutLines.some((line) =>
      (line.sourceType === "sale" && line.sourceId === sale.id) ||
      (line.sourceType === "finance_event" && linkedFinanceEvents.some((event) => event.id === line.sourceId))
    );
    if (blockedByPayout) {
      throw new DomainError("sale_has_payouts", "Нельзя удалить продажу, которая уже вошла в выплату маркетплейса");
    }

    const resetExternalEventIds = this.saleResetExternalEventIds(sale, linkedFinanceEvents);

    const deletion = this.deleteChannelFacts({
      sales: [sale],
      financeEvents: linkedFinanceEvents,
      resetExternalEventIds
    });
    return { saleId: sale.id, ...deletion };
  }

  saleRollbackPreview(saleId: ID): EntityRollbackPreview {
    const sale = this.mustFind(this.state.sales, saleId, "sale_not_found");
    const document = this.mustFind(this.state.documents, sale.documentId, "document_not_found");
    const linkedReturns = this.state.salesReturns.filter((candidate) => candidate.saleId === sale.id);
    const linkedFinanceEvents = this.state.channelFinanceEvents.filter((event) =>
      event.linkedSaleId === sale.id || Boolean(event.saleAllocations?.some((allocation) => allocation.saleId === sale.id))
    );
    const sharedFinanceEvents = linkedFinanceEvents.filter((event) =>
      Boolean(event.saleAllocations?.some((allocation) => allocation.saleId !== sale.id))
    );
    const blockedByPayout = this.state.payoutLines.some((line) =>
      (line.sourceType === "sale" && line.sourceId === sale.id) ||
      (line.sourceType === "finance_event" && linkedFinanceEvents.some((event) => event.id === line.sourceId))
    );
    const blockers: EntityRollbackBlockerSummary[] = [];
    if (linkedReturns.length > 0) {
      blockers.push({
        code: "sale_has_returns",
        message: "Сначала удалите возвраты по этой продаже",
        relatedDocuments: linkedReturns
          .map((salesReturn) => this.findRollbackDocumentSummary(salesReturn.documentId))
          .filter((item): item is RollbackRelatedDocumentSummary => Boolean(item))
      });
    }
    if (sharedFinanceEvents.length > 0) {
      blockers.push({
        code: "sale_has_shared_finance_events",
        message: "Сначала удалите распределенные финансовые операции, которые относятся сразу к нескольким продажам",
        relatedDocuments: sharedFinanceEvents
          .map((event) => this.findRollbackDocumentSummary(event.documentId))
          .filter((item): item is RollbackRelatedDocumentSummary => Boolean(item))
      });
    }
    if (blockedByPayout) {
      blockers.push({
        code: "sale_has_payouts",
        message: "Нельзя удалить продажу, которая уже вошла в выплату маркетплейса"
      });
    }

    const resetExternalEventIds = this.saleResetExternalEventIds(sale, linkedFinanceEvents);
    const removableDocumentIds = new Set<ID>([
      sale.documentId,
      ...linkedFinanceEvents.map((event) => event.documentId),
      ...[sale.financialDocumentId].filter(Boolean) as ID[]
    ]);
    const journalEntryIds = new Set(
      this.state.journalEntries
        .filter((entry) => removableDocumentIds.has(entry.documentId))
        .map((entry) => entry.id)
    );
    const saleCostApplications = this.state.costApplications.filter((application) =>
      application.outboundDocumentId === sale.documentId && application.applicationType === "sale"
    );

    return {
      entityType: "sale",
      entityId: sale.id,
      documentId: document.id,
      documentNumber: document.number,
      title: document.title,
      status: sale.status,
      accountingDate: document.accountingDate,
      canDelete: blockers.length === 0,
      blockers,
      descendants: this.documentDescendants(document.id),
      effects: {
        documents: removableDocumentIds.size,
        journalEntries: journalEntryIds.size,
        journalLines: this.state.journalLines.filter((line) => journalEntryIds.has(line.journalEntryId)).length,
        settlementEntries: this.state.settlementEntries.filter((entry) => removableDocumentIds.has(entry.documentId)).length,
        stockMovements: this.state.stockMovements.filter((movement) => movement.documentId === sale.documentId).length,
        inventoryLots: 0,
        costApplications: saleCostApplications.length,
        saleLines: this.state.saleLines.filter((line) => line.saleId === sale.id).length,
        financeEvents: linkedFinanceEvents.length,
        stockTransfers: 0,
        payments: 0,
        paymentAllocations: 0,
        externalEventsToReset: resetExternalEventIds.size
      }
    };
  }

  deleteReturnForResync(returnId: ID) {
    const salesReturn = this.mustFind(this.state.salesReturns, returnId, "return_not_found");
    const linkedFinanceEvents = this.state.channelFinanceEvents.filter((event) => event.linkedReturnId === salesReturn.id);
    const blockedByPayout = this.state.payoutLines.some((line) =>
      (line.sourceType === "return" && line.sourceId === salesReturn.id) ||
      (line.sourceType === "finance_event" && linkedFinanceEvents.some((event) => event.id === line.sourceId))
    );
    if (blockedByPayout) {
      throw new DomainError("return_has_payouts", "Нельзя удалить возврат, который уже вошел в выплату маркетплейса");
    }

    const resetExternalEventIds = new Set<ID>();
    if (salesReturn.externalEventId) resetExternalEventIds.add(salesReturn.externalEventId);
    linkedFinanceEvents.forEach((event) => {
      if (event.externalEventId) resetExternalEventIds.add(event.externalEventId);
    });

    const deletion = this.deleteChannelFacts({
      returns: [salesReturn],
      financeEvents: linkedFinanceEvents,
      resetExternalEventIds
    });
    return { returnId: salesReturn.id, ...deletion };
  }

  stockTransferRollbackPreview(transferId: ID): EntityRollbackPreview {
    const transfer = this.mustFind(this.state.stockTransfers, transferId, "transfer_not_found");
    const document = this.mustFind(this.state.documents, transfer.documentId, "document_not_found");
    const descendants = this.documentDescendants(document.id);
    const downstreamDocuments = this.inventoryUsageDocuments(document.id);
    const blockers: EntityRollbackBlockerSummary[] = [];
    if (descendants.length > 0) {
      blockers.push({
        code: "document_has_descendants",
        message: "Сначала удалите зависимые документы этого перемещения",
        relatedDocuments: descendants.map((descendant) => ({
          documentId: descendant.documentId,
          number: descendant.number,
          title: descendant.title,
          documentType: descendant.documentType,
          documentTypeName: descendant.documentTypeName,
          status: descendant.status,
          accountingDate: descendant.accountingDate
        }))
      });
    }
    if (downstreamDocuments.length > 0) {
      blockers.push({
        code: "stock_transfer_has_downstream_usage",
        message: "Нельзя удалить перемещение: товар из него уже использован в других операциях",
        relatedDocuments: downstreamDocuments
      });
    }

    const removableDocumentIds = new Set<ID>([document.id]);
    const journalEntryIds = new Set(
      this.state.journalEntries
        .filter((entry) => removableDocumentIds.has(entry.documentId))
        .map((entry) => entry.id)
    );

    return {
      entityType: "stock_transfer",
      entityId: transfer.id,
      documentId: document.id,
      documentNumber: document.number,
      title: document.title,
      status: transfer.status,
      accountingDate: document.accountingDate,
      canDelete: blockers.length === 0,
      blockers,
      descendants,
      effects: {
        documents: removableDocumentIds.size,
        journalEntries: journalEntryIds.size,
        journalLines: this.state.journalLines.filter((line) => journalEntryIds.has(line.journalEntryId)).length,
        settlementEntries: this.state.settlementEntries.filter((entry) => removableDocumentIds.has(entry.documentId)).length,
        stockMovements: this.state.stockMovements.filter((movement) => movement.documentId === document.id).length,
        inventoryLots: this.state.inventoryLots.filter((lot) => lot.sourceDocumentId === document.id).length,
        costApplications: this.state.costApplications.filter((application) => application.outboundDocumentId === document.id).length,
        saleLines: 0,
        financeEvents: 0,
        stockTransfers: 1,
        payments: 0,
        paymentAllocations: 0,
        externalEventsToReset: 0
      }
    };
  }

  deleteStockTransfer(transferId: ID) {
    const transfer = this.mustFind(this.state.stockTransfers, transferId, "transfer_not_found");
    const document = this.mustFind(this.state.documents, transfer.documentId, "document_not_found");
    this.assertDocumentHasNoDescendants(document.id, "Нельзя удалить перемещение, пока от него зависят другие документы");
    const downstreamDocuments = this.inventoryUsageDocuments(document.id);
    if (downstreamDocuments.length > 0) {
      throw new DomainError(
        "stock_transfer_has_downstream_usage",
        "Нельзя удалить перемещение: товар из него уже использован в других операциях",
        { downstreamDocuments }
      );
    }

    const outboundApplications = this.state.costApplications.filter((application) =>
      application.outboundDocumentId === document.id && application.applicationType === "transfer"
    );
    const inboundLots = this.state.inventoryLots.filter((lot) => lot.sourceDocumentId === document.id);

    this.restoreCostApplicationsToLots(outboundApplications);
    this.removeLotsFromStockStates(inboundLots);

    this.state.costApplications = this.state.costApplications.filter((application) => application.outboundDocumentId !== document.id);
    this.state.inventoryLots = this.state.inventoryLots.filter((lot) => lot.sourceDocumentId !== document.id);
    this.state.stockMovements = this.state.stockMovements.filter((movement) => movement.documentId !== document.id);
    this.state.settlementEntries = this.state.settlementEntries.filter((entry) => entry.documentId !== document.id);
    this.state.journalEntries = this.state.journalEntries.filter((entry) => entry.documentId !== document.id);
    const remainingJournalEntryIds = new Set(this.state.journalEntries.map((entry) => entry.id));
    this.state.journalLines = this.state.journalLines.filter((line) => remainingJournalEntryIds.has(line.journalEntryId));
    this.state.stockTransferLines = this.state.stockTransferLines.filter((line) => line.stockTransferId !== transfer.id);
    this.state.stockTransfers = this.state.stockTransfers.filter((candidate) => candidate.id !== transfer.id);
    this.state.documentLines = this.state.documentLines.filter((line) => line.documentId !== document.id);
    this.state.documentVersions = this.state.documentVersions.filter((version) => version.documentId !== document.id);
    this.state.documentLinks = this.state.documentLinks.filter((link) => link.fromDocumentId !== document.id && link.toDocumentId !== document.id);
    this.state.documents = this.state.documents.filter((candidate) => candidate.id !== document.id);
    this.compactZeroStockStates();
    this.audit("stock_transfer", transfer.id, "delete", transfer, undefined, "Удаление перемещения");
    return {
      transferId: transfer.id,
      deleted: {
        stockTransfers: 1,
        documents: 1,
        costApplications: outboundApplications.length,
        inventoryLots: inboundLots.length
      }
    };
  }

  // --- Безопасное удаление сущностей (оплаты, приёмки, расходы закупки) ---
  // Удаляем физически, но только если от сущности ничего не зависит дальше.

  private emptyRollbackEffects(): EntityRollbackEffectsSummary {
    return {
      documents: 0, journalEntries: 0, journalLines: 0, settlementEntries: 0,
      stockMovements: 0, inventoryLots: 0, costApplications: 0, saleLines: 0,
      financeEvents: 0, stockTransfers: 0, payments: 0, paymentAllocations: 0,
      externalEventsToReset: 0
    };
  }

  private rollbackRelatedFromDescendants(descendants: DocumentDescendantSummary[]): RollbackRelatedDocumentSummary[] {
    return descendants.map((descendant) => ({
      documentId: descendant.documentId,
      number: descendant.number,
      title: descendant.title,
      documentType: descendant.documentType,
      documentTypeName: descendant.documentTypeName,
      status: descendant.status,
      accountingDate: descendant.accountingDate
    }));
  }

  // Снимает проводки, settlements, links, строки и сам документ.
  private removeDocumentGraph(documentId: ID) {
    const journalEntryIds = new Set(
      this.state.journalEntries.filter((entry) => entry.documentId === documentId).map((entry) => entry.id)
    );
    this.state.journalEntries = this.state.journalEntries.filter((entry) => entry.documentId !== documentId);
    this.state.journalLines = this.state.journalLines.filter((line) => !journalEntryIds.has(line.journalEntryId));
    this.state.settlementEntries = this.state.settlementEntries.filter((entry) => entry.documentId !== documentId);
    this.state.documentLines = this.state.documentLines.filter((line) => line.documentId !== documentId);
    this.state.documentVersions = this.state.documentVersions.filter((version) => version.documentId !== documentId);
    this.state.documentLinks = this.state.documentLinks.filter((link) => link.fromDocumentId !== documentId && link.toDocumentId !== documentId);
    this.state.documents = this.state.documents.filter((document) => document.id !== documentId);
  }

  paymentRollbackPreview(paymentId: ID): EntityRollbackPreview {
    const payment = this.mustFind(this.state.payments, paymentId, "payment_not_found");
    const document = this.mustFind(this.state.documents, payment.documentId, "document_not_found");
    const blockers: EntityRollbackBlockerSummary[] = [];
    const descendants = this.documentDescendants(document.id);
    if (descendants.length > 0) {
      blockers.push({
        code: "document_has_descendants",
        message: "Сначала удалите зависимые документы этой оплаты",
        relatedDocuments: this.rollbackRelatedFromDescendants(descendants)
      });
    }
    const allocation = this.state.paymentAllocations.find((candidate) => candidate.paymentId === payment.id && candidate.allocationPurpose === "goods_purchase");
    if (allocation?.purchaseOrderId) {
      const postedReceipts = this.state.goodsReceipts.filter((receipt) =>
        receipt.purchaseOrderId === allocation.purchaseOrderId && receipt.status === "posted" && this.isDocumentPosted(receipt.documentId)
      );
      if (postedReceipts.length > 0) {
        blockers.push({
          code: "payment_consumed_by_receipt",
          message: "Нельзя удалить оплату: по заказу уже проведена приёмка, которая зачла этот аванс. Сначала удалите приёмку.",
          relatedDocuments: postedReceipts.map((receipt) => this.findRollbackDocumentSummary(receipt.documentId)).filter((item): item is RollbackRelatedDocumentSummary => Boolean(item))
        });
      }
    }
    if (payment.paymentType === "channel_payout" && this.state.payouts.some((payout) => payout.paymentId === payment.id)) {
      blockers.push({
        code: "payment_belongs_to_payout",
        message: "Оплата относится к выплате маркетплейса — управляйте ею в разделе «Выплаты»."
      });
    }
    const journalEntryIds = new Set(this.state.journalEntries.filter((entry) => entry.documentId === document.id).map((entry) => entry.id));
    return {
      entityType: "payment",
      entityId: payment.id,
      documentId: document.id,
      documentNumber: document.number,
      title: document.title,
      status: this.isDocumentPosted(document.id) ? "posted" : document.status,
      accountingDate: document.accountingDate,
      canDelete: blockers.length === 0,
      blockers,
      descendants,
      effects: {
        ...this.emptyRollbackEffects(),
        documents: 1,
        payments: 1,
        journalEntries: journalEntryIds.size,
        journalLines: this.state.journalLines.filter((line) => journalEntryIds.has(line.journalEntryId)).length,
        settlementEntries: this.state.settlementEntries.filter((entry) => entry.documentId === document.id).length,
        paymentAllocations: this.state.paymentAllocations.filter((candidate) => candidate.paymentId === payment.id).length
      }
    };
  }

  deletePayment(paymentId: ID) {
    const preview = this.paymentRollbackPreview(paymentId);
    if (!preview.canDelete) {
      const blocker = preview.blockers[0];
      throw new DomainError(blocker.code, blocker.message, { blockers: preview.blockers });
    }
    const payment = this.mustFind(this.state.payments, paymentId, "payment_not_found");
    const before = { ...payment };
    const documentId = payment.documentId;
    this.state.ownerTransactions = this.state.ownerTransactions.filter((transaction) => transaction.paymentId !== payment.id);
    this.rollbackPaymentsForDocument(documentId); // касса + аллокации + сам платёж
    this.removeDocumentGraph(documentId);
    this.audit("payment", payment.id, "delete", before, undefined, "Удаление оплаты");
    return { paymentId: payment.id, deleted: { payments: 1, documents: 1 } };
  }

  goodsReceiptRollbackPreview(receiptId: ID): EntityRollbackPreview {
    const receipt = this.mustFind(this.state.goodsReceipts, receiptId, "receipt_not_found");
    const document = this.mustFind(this.state.documents, receipt.documentId, "document_not_found");
    const lots = this.state.inventoryLots.filter((lot) => lot.sourceDocumentId === document.id);
    const lotIds = new Set(lots.map((lot) => lot.id));
    const blockers: EntityRollbackBlockerSummary[] = [];
    const descendants = this.documentDescendants(document.id);
    const downstream = this.inventoryUsageDocuments(document.id);
    if (downstream.length > 0) {
      blockers.push({
        code: "goods_receipt_has_downstream_usage",
        message: "Нельзя удалить приёмку: товар из неё уже перемещён, продан или списан",
        relatedDocuments: downstream
      });
    }
    const costDocuments = Array.from(new Set(
      this.state.procurementCostLines
        .filter((line) => line.lotId && lotIds.has(line.lotId))
        .map((line) => this.state.procurementCosts.find((cost) => cost.id === line.procurementCostId))
        .filter((cost): cost is ProcurementCost => Boolean(cost && cost.status !== "cancelled"))
        .map((cost) => cost.documentId)
    ));
    if (costDocuments.length > 0) {
      blockers.push({
        code: "goods_receipt_has_procurement_costs",
        message: "Сначала удалите расходы закупки, отнесённые на партии этой приёмки",
        relatedDocuments: costDocuments.map((documentId) => this.findRollbackDocumentSummary(documentId)).filter((item): item is RollbackRelatedDocumentSummary => Boolean(item))
      });
    }
    if (descendants.length > 0) {
      blockers.push({
        code: "document_has_descendants",
        message: "Сначала удалите зависимые документы этой приёмки",
        relatedDocuments: this.rollbackRelatedFromDescendants(descendants)
      });
    }
    const journalEntryIds = new Set(this.state.journalEntries.filter((entry) => entry.documentId === document.id).map((entry) => entry.id));
    return {
      entityType: "goods_receipt",
      entityId: receipt.id,
      documentId: document.id,
      documentNumber: document.number,
      title: document.title,
      status: receipt.status,
      accountingDate: document.accountingDate,
      canDelete: blockers.length === 0,
      blockers,
      descendants,
      effects: {
        ...this.emptyRollbackEffects(),
        documents: 1,
        inventoryLots: lots.length,
        stockMovements: this.state.stockMovements.filter((movement) => movement.documentId === document.id).length,
        journalEntries: journalEntryIds.size,
        journalLines: this.state.journalLines.filter((line) => journalEntryIds.has(line.journalEntryId)).length,
        settlementEntries: this.state.settlementEntries.filter((entry) => entry.documentId === document.id).length
      }
    };
  }

  deleteGoodsReceipt(receiptId: ID) {
    const preview = this.goodsReceiptRollbackPreview(receiptId);
    if (!preview.canDelete) {
      const blocker = preview.blockers[0];
      throw new DomainError(blocker.code, blocker.message, { blockers: preview.blockers });
    }
    const receipt = this.mustFind(this.state.goodsReceipts, receiptId, "receipt_not_found");
    const document = this.mustFind(this.state.documents, receipt.documentId, "document_not_found");
    const before = { ...receipt };
    const lots = this.state.inventoryLots.filter((lot) => lot.sourceDocumentId === document.id);
    this.removeLotsFromStockStates(lots);
    this.state.inventoryLots = this.state.inventoryLots.filter((lot) => lot.sourceDocumentId !== document.id);
    this.state.stockMovements = this.state.stockMovements.filter((movement) => movement.documentId !== document.id);
    this.state.goodsReceiptLines = this.state.goodsReceiptLines.filter((line) => line.goodsReceiptId !== receipt.id);
    this.state.goodsReceipts = this.state.goodsReceipts.filter((candidate) => candidate.id !== receipt.id);
    this.removeDocumentGraph(document.id);
    this.compactZeroStockStates();
    this.audit("goods_receipt", receipt.id, "delete", before, undefined, "Удаление приёмки");
    return { receiptId: receipt.id, deleted: { goodsReceipts: 1, documents: 1, inventoryLots: lots.length } };
  }

  procurementCostRollbackPreview(costId: ID): EntityRollbackPreview {
    const cost = this.mustFind(this.state.procurementCosts, costId, "procurement_cost_not_found");
    const document = this.mustFind(this.state.documents, cost.documentId, "document_not_found");
    const lines = this.state.procurementCostLines.filter((line) => line.procurementCostId === cost.id);
    const blockers: EntityRollbackBlockerSummary[] = [];
    if (lines.some((line) => (line.soldCostAmountRub ?? 0) > 0 || (line.qtySold ?? 0) > 0)) {
      blockers.push({
        code: "procurement_cost_has_downstream_usage",
        message: "Нельзя удалить расход закупки: часть суммы уже отнесена на проданные товары"
      });
    }
    const descendants = this.documentDescendants(document.id);
    if (descendants.length > 0) {
      blockers.push({
        code: "document_has_descendants",
        message: "Сначала удалите зависимые документы этого расхода",
        relatedDocuments: this.rollbackRelatedFromDescendants(descendants)
      });
    }
    const journalEntryIds = new Set(this.state.journalEntries.filter((entry) => entry.documentId === document.id).map((entry) => entry.id));
    return {
      entityType: "procurement_cost",
      entityId: cost.id,
      documentId: document.id,
      documentNumber: document.number,
      title: document.title,
      status: cost.status,
      accountingDate: document.accountingDate,
      canDelete: blockers.length === 0,
      blockers,
      descendants,
      effects: {
        ...this.emptyRollbackEffects(),
        documents: 1,
        journalEntries: journalEntryIds.size,
        journalLines: this.state.journalLines.filter((line) => journalEntryIds.has(line.journalEntryId)).length,
        payments: this.state.payments.filter((payment) => payment.documentId === document.id).length
      }
    };
  }

  deleteProcurementCost(costId: ID) {
    const preview = this.procurementCostRollbackPreview(costId);
    if (!preview.canDelete) {
      const blocker = preview.blockers[0];
      throw new DomainError(blocker.code, blocker.message, { blockers: preview.blockers });
    }
    const cost = this.mustFind(this.state.procurementCosts, costId, "procurement_cost_not_found");
    const document = this.mustFind(this.state.documents, cost.documentId, "document_not_found");
    const before = { ...cost };
    const lines = this.state.procurementCostLines.filter((line) => line.procurementCostId === cost.id);
    for (const line of lines) {
      const lot = line.lotId ? this.state.inventoryLots.find((candidate) => candidate.id === line.lotId) : undefined;
      if (!lot || line.remainingInventoryAmountRub <= 0) continue;
      lot.costInitialRub = round2(Math.max(0, lot.costInitialRub - line.allocatedAmountRub));
      lot.costRemainingRub = round2(Math.max(0, lot.costRemainingRub - line.remainingInventoryAmountRub));
      lot.unitCostRub = lot.qtyRemaining > 0 ? round6(lot.costRemainingRub / lot.qtyRemaining) : 0;
      this.addStockState(lot.productId, lot.warehouseId, 0, -line.remainingInventoryAmountRub, lot.stockStateCode);
    }
    this.rollbackPaymentsForDocument(document.id);
    this.state.procurementCostLines = this.state.procurementCostLines.filter((line) => line.procurementCostId !== cost.id);
    this.state.procurementCosts = this.state.procurementCosts.filter((candidate) => candidate.id !== cost.id);
    this.removeDocumentGraph(document.id);
    this.compactZeroStockStates();
    this.audit("procurement_cost", cost.id, "delete", before, undefined, "Удаление расхода закупки");
    return { costId: cost.id, deleted: { procurementCosts: 1, documents: 1 } };
  }

  deleteChannelFinanceEventForResync(financeEventId: ID) {
    const event = this.mustFind(this.state.channelFinanceEvents, financeEventId, "finance_event_not_found");
    const blockedByPayout = this.state.payoutLines.some((line) => line.sourceType === "finance_event" && line.sourceId === event.id);
    if (blockedByPayout || event.payoutId) {
      throw new DomainError("finance_event_in_payout", "Нельзя удалить финансовую операцию, которая уже вошла в выплату маркетплейса");
    }

    const resetExternalEventIds = new Set<ID>();
    if (event.externalEventId) resetExternalEventIds.add(event.externalEventId);

    const deletion = this.deleteChannelFacts({
      financeEvents: [event],
      resetExternalEventIds
    });
    return { financeEventId: event.id, ...deletion };
  }

  async resetChannelSalesData(channelId: ID, options?: { includePayouts?: boolean }) {
    const includePayouts = options?.includePayouts ?? false;
    const sales = this.state.sales.filter((sale) => sale.channelId === channelId);
    const saleIds = new Set(sales.map((sale) => sale.id));
    const saleDocumentIds = new Set(sales.map((sale) => sale.documentId));
    const saleFinancialDocumentIds = new Set(sales.map((sale) => sale.financialDocumentId).filter(Boolean) as ID[]);
    const salesReturns = this.state.salesReturns.filter((salesReturn) => salesReturn.channelId === channelId);
    const salesReturnIds = new Set(salesReturns.map((salesReturn) => salesReturn.id));
    const salesReturnDocumentIds = new Set(salesReturns.map((salesReturn) => salesReturn.documentId));
    const channelFinanceEvents = this.state.channelFinanceEvents.filter((event) => event.channelId === channelId);
    const channelFinanceEventDocumentIds = new Set(channelFinanceEvents.map((event) => event.documentId));
    const payouts = includePayouts ? this.state.payouts.filter((payout) => payout.channelId === channelId) : [];
    const payoutIds = new Set(payouts.map((payout) => payout.id));
    const payoutDocumentIds = new Set(payouts.map((payout) => payout.documentId));
    const payoutPaymentIds = new Set(payouts.map((payout) => payout.paymentId).filter(Boolean) as ID[]);
    const payoutPaymentDocumentIds = new Set(
      this.state.payments
        .filter((payment) => payoutPaymentIds.has(payment.id))
        .map((payment) => payment.documentId)
    );
    const removableEventTypes = new Set<ExternalEvent["eventType"]>(["sale", "sale_accrual", "return", "fee"]);
    if (includePayouts) removableEventTypes.add("payout");
    const externalEvents = this.state.externalEvents.filter((event) => event.channelId === channelId && removableEventTypes.has(event.eventType));
    const externalEventIds = new Set(externalEvents.map((event) => event.id));
    const removableDocumentIds = new Set<ID>([
      ...saleDocumentIds,
      ...saleFinancialDocumentIds,
      ...salesReturnDocumentIds,
      ...channelFinanceEventDocumentIds,
      ...payoutDocumentIds,
      ...payoutPaymentDocumentIds
    ]);

    const saleCostApplications = this.state.costApplications.filter((application) =>
      saleDocumentIds.has(application.outboundDocumentId) && application.applicationType === "sale"
    );
    this.restoreCostApplicationsToLots(saleCostApplications);

    const returnLots = this.state.inventoryLots.filter((lot) => salesReturnDocumentIds.has(lot.sourceDocumentId));
    this.removeLotsFromStockStates(returnLots);

    for (const paymentDocumentId of payoutPaymentDocumentIds) {
      this.rollbackPaymentsForDocument(paymentDocumentId);
    }

    this.state.costApplications = this.state.costApplications.filter((application) => !saleDocumentIds.has(application.outboundDocumentId));
    this.state.inventoryLots = this.state.inventoryLots.filter((lot) => !salesReturnDocumentIds.has(lot.sourceDocumentId));
    this.state.stockMovements = this.state.stockMovements.filter((movement) => !saleDocumentIds.has(movement.documentId) && !salesReturnDocumentIds.has(movement.documentId));
    this.state.settlementEntries = this.state.settlementEntries.filter((entry) => !removableDocumentIds.has(entry.documentId));
    this.state.journalEntries = this.state.journalEntries.filter((entry) => !removableDocumentIds.has(entry.documentId));
    const remainingJournalEntryIds = new Set(this.state.journalEntries.map((entry) => entry.id));
    this.state.journalLines = this.state.journalLines.filter((line) => remainingJournalEntryIds.has(line.journalEntryId));
    this.state.documentLines = this.state.documentLines.filter((line) => !removableDocumentIds.has(line.documentId));
    this.state.documentVersions = this.state.documentVersions.filter((version) => !removableDocumentIds.has(version.documentId));
    this.state.documentLinks = this.state.documentLinks.filter((link) => !removableDocumentIds.has(link.fromDocumentId) && !removableDocumentIds.has(link.toDocumentId));
    this.state.documents = this.state.documents.filter((document) => !removableDocumentIds.has(document.id));
    this.state.payoutLines = this.state.payoutLines.filter((line) => !payoutIds.has(line.payoutId) && (!line.saleId || !saleIds.has(line.saleId)));
    this.state.payouts = this.state.payouts.filter((payout) => !payoutIds.has(payout.id));
    this.state.channelFinanceEvents = this.state.channelFinanceEvents.filter((event) => event.channelId !== channelId);
    this.state.salesReturns = this.state.salesReturns.filter((salesReturn) => !salesReturnIds.has(salesReturn.id));
    this.state.saleLines = this.state.saleLines.filter((line) => !saleIds.has(line.saleId));
    this.state.sales = this.state.sales.filter((sale) => !saleIds.has(sale.id));
    await this.externalEvents.deleteByIds(Array.from(externalEventIds));
    this.compactZeroStockStates();

    this.invalidateExternalEventLookups();
    this.invalidateSaleLookup();

    return {
      channelId,
      deleted: {
        sales: saleIds.size,
        returns: salesReturnIds.size,
        financeEvents: channelFinanceEvents.length,
        payouts: payoutIds.size,
        externalEvents: externalEventIds.size,
        documents: removableDocumentIds.size
      }
    };
  }

  private deleteChannelFacts(input: {
    sales?: Sale[];
    returns?: SalesReturn[];
    financeEvents?: ChannelFinanceEvent[];
    resetExternalEventIds?: Iterable<ID>;
  }) {
    const sales = input.sales ?? [];
    const salesReturns = input.returns ?? [];
    const financeEvents = input.financeEvents ?? [];

    const saleIds = new Set(sales.map((sale) => sale.id));
    const saleDocumentIds = new Set(sales.map((sale) => sale.documentId));
    const saleFinancialDocumentIds = new Set(sales.map((sale) => sale.financialDocumentId).filter(Boolean) as ID[]);
    const salesReturnIds = new Set(salesReturns.map((salesReturn) => salesReturn.id));
    const salesReturnDocumentIds = new Set(salesReturns.map((salesReturn) => salesReturn.documentId));
    const financeEventIds = new Set(financeEvents.map((event) => event.id));
    const financeEventDocumentIds = new Set(financeEvents.map((event) => event.documentId));
    const removableDocumentIds = new Set<ID>([
      ...saleDocumentIds,
      ...saleFinancialDocumentIds,
      ...salesReturnDocumentIds,
      ...financeEventDocumentIds
    ]);

    const saleCostApplications = this.state.costApplications.filter((application) =>
      saleDocumentIds.has(application.outboundDocumentId) && application.applicationType === "sale"
    );
    this.restoreCostApplicationsToLots(saleCostApplications);

    const returnLots = this.state.inventoryLots.filter((lot) => salesReturnDocumentIds.has(lot.sourceDocumentId));
    this.removeLotsFromStockStates(returnLots);

    this.state.costApplications = this.state.costApplications.filter((application) => !saleDocumentIds.has(application.outboundDocumentId));
    this.state.inventoryLots = this.state.inventoryLots.filter((lot) => !salesReturnDocumentIds.has(lot.sourceDocumentId));
    this.state.stockMovements = this.state.stockMovements.filter((movement) => !saleDocumentIds.has(movement.documentId) && !salesReturnDocumentIds.has(movement.documentId));
    this.state.settlementEntries = this.state.settlementEntries.filter((entry) => !removableDocumentIds.has(entry.documentId));
    this.state.journalEntries = this.state.journalEntries.filter((entry) => !removableDocumentIds.has(entry.documentId));
    const remainingJournalEntryIds = new Set(this.state.journalEntries.map((entry) => entry.id));
    this.state.journalLines = this.state.journalLines.filter((line) => remainingJournalEntryIds.has(line.journalEntryId));
    this.state.documentLines = this.state.documentLines.filter((line) => !removableDocumentIds.has(line.documentId));
    this.state.documentVersions = this.state.documentVersions.filter((version) => !removableDocumentIds.has(version.documentId));
    this.state.documentLinks = this.state.documentLinks.filter((link) => !removableDocumentIds.has(link.fromDocumentId) && !removableDocumentIds.has(link.toDocumentId));
    this.state.documents = this.state.documents.filter((document) => !removableDocumentIds.has(document.id));
    this.state.channelFinanceEvents = this.state.channelFinanceEvents.filter((event) => !financeEventIds.has(event.id));
    this.state.salesReturns = this.state.salesReturns.filter((salesReturn) => !salesReturnIds.has(salesReturn.id));
    this.state.saleLines = this.state.saleLines.filter((line) => !saleIds.has(line.saleId));
    this.state.sales = this.state.sales.filter((sale) => !saleIds.has(sale.id));
    this.compactZeroStockStates();

    const resetExternalEvents = Array.from(new Set(Array.from(input.resetExternalEventIds ?? []).filter(Boolean)));
    resetExternalEvents.forEach((eventId) => this.reprocessExternalEvent(eventId));

    this.invalidateSaleLookup();

    return {
      deleted: {
        sales: saleIds.size,
        returns: salesReturnIds.size,
        financeEvents: financeEventIds.size,
        documents: removableDocumentIds.size
      },
      resetExternalEvents
    };
  }

  postReturn(returnId: ID): SalesReturn {
    const salesReturn = this.mustFind(this.state.salesReturns, returnId, "return_not_found");
    const document = this.mustFind(this.state.documents, salesReturn.documentId, "document_not_found");
    if (salesReturn.status === "posted" && document.status === "posted") return salesReturn;
    if (salesReturn.status === "reversed" || document.status === "cancelled") {
      throw new DomainError("return_not_postable", "Сторнированный или отмененный возврат нельзя провести повторно");
    }
    const sale = this.mustFind(this.state.sales, salesReturn.saleId, "sale_not_found");
    if (sale.status !== "posted") {
      throw new DomainError("sale_not_posted", "Возврат можно оформить только по проведенной продаже");
    }
    this.assertAccountingDateAllowed(salesReturn.returnDate);
    if (salesReturn.returnDate < sale.saleDate) {
      throw new DomainError("return_before_sale", "Дата возврата не может быть раньше даты продажи");
    }
    const warehouse = this.mustFind(this.state.warehouses, salesReturn.warehouseId, "warehouse_not_found");
    const saleLines = this.state.saleLines.filter((line) => line.saleId === sale.id);
    const returnDocumentLines = this.returnDocumentLines(salesReturn.id);
    if (returnDocumentLines.length === 0) {
      throw new DomainError("return_lines_not_found", "Для возврата не найдены строки");
    }

    let refundRub = 0;
    let restoredCostRub = 0;
    returnDocumentLines.forEach((documentLine) => {
      const payload = (documentLine.payload ?? {}) as Record<string, unknown>;
      const saleLineId = String(payload.saleLineId ?? "");
      const saleLine = this.mustFind(saleLines, saleLineId, "sale_line_not_found");
      const qtyToReturn = round4(Number(documentLine.qty ?? 0));
      const alreadyReturnedQty = this.returnedQtyForSaleLine(saleLine.id, salesReturn.id);
      const returnableQty = round4(Math.max(0, saleLine.qty - alreadyReturnedQty));
      if (qtyToReturn > returnableQty + 0.0001) {
        const reason = `Превышен доступный возврат по товару ${saleLine.productId}`;
        salesReturn.status = "needs_attention";
        this.markExternalEventNeedsAttention(salesReturn.externalEventId, salesReturn.documentId, reason);
        if (!salesReturn.externalEventId) {
          throw new DomainError("return_qty_exceeds_sale", reason, { saleLineId: saleLine.id, returnableQty, qtyToReturn });
        }
        return;
      }

      const saleApplications = this.state.costApplications
        .filter((application) =>
          application.outboundDocumentId === sale.documentId &&
          application.applicationType === "sale" &&
          application.productId === saleLine.productId &&
          (!application.targetLineId || application.targetLineId === saleLine.id)
        );
      if (saleApplications.length === 0) {
        const reason = "По исходной продаже нет зафиксированной себестоимости";
        salesReturn.status = "needs_attention";
        this.markExternalEventNeedsAttention(salesReturn.externalEventId, salesReturn.documentId, reason);
        if (!salesReturn.externalEventId) {
          throw new DomainError("sale_cost_not_found", reason, { saleLineId: saleLine.id });
        }
        return;
      }

      const targetStateCode = String(payload.stockStateCode ?? salesReturn.stockStateCode ?? "sellable");
      const lineRefundRub = round2(Number(payload.refundRub ?? documentLine.amountRub ?? 0));
      refundRub = round2(refundRub + lineRefundRub);

      let qtyRemaining = qtyToReturn;
      let lineRestoredCostRub = 0;
      saleApplications.forEach((application, index) => {
        if (qtyRemaining <= 0) return;
        const rawQty = index === saleApplications.length - 1
          ? qtyRemaining
          : round4(qtyToReturn * (application.qty / saleLine.qty));
        const restoreQty = round4(Math.min(qtyRemaining, rawQty));
        if (restoreQty <= 0) return;
        const restoreCostRub = index === saleApplications.length - 1
          ? round2((saleLine.costRub * qtyToReturn) / saleLine.qty - lineRestoredCostRub)
          : round2(application.costRub * (restoreQty / application.qty));
        this.createLot({
          productId: saleLine.productId,
          warehouseId: salesReturn.warehouseId,
          stateCode: targetStateCode,
          documentId: document.id,
          sourceLineId: saleLine.id,
          qty: restoreQty,
          costRub: restoreCostRub,
          date: salesReturn.returnDate,
          movementType: "return"
        });
        qtyRemaining = round4(qtyRemaining - restoreQty);
        lineRestoredCostRub = round2(lineRestoredCostRub + restoreCostRub);
      });

      const expectedRestoredCostRub = round2((saleLine.costRub * qtyToReturn) / saleLine.qty);
      const normalizedRestoredCostRub = round2(expectedRestoredCostRub);
      restoredCostRub = round2(restoredCostRub + normalizedRestoredCostRub);
      documentLine.payload = {
        ...payload,
        stockStateCode: targetStateCode,
        refundRub: lineRefundRub,
        restoredCostRub: normalizedRestoredCostRub
      };
    });

    salesReturn.refundRub = round2(refundRub);
    salesReturn.restoredCostRub = round2(restoredCostRub);
    salesReturn.status = salesReturn.status === "needs_attention" ? "needs_attention" : "posted";
    document.amountRub = salesReturn.refundRub;
    if (salesReturn.status !== "needs_attention") {
      this.postDocument(document.id, [
        { accountCode: "90.01", debit: salesReturn.refundRub, memo: "Сторно выручки по возврату" },
        { accountCode: "76.ТП", credit: salesReturn.refundRub, memo: "Уменьшение задолженности точки продаж" },
        { accountCode: accountForWarehouse(warehouse), debit: salesReturn.restoredCostRub, memo: "Возврат товара в остаток" },
        { accountCode: "90.02", credit: salesReturn.restoredCostRub, memo: "Сторно себестоимости продаж" }
      ]);
    }
    this.ensureDocumentLink(sale.documentId, salesReturn.documentId, "return");
    this.markExternalEventProcessed(salesReturn.externalEventId, salesReturn.documentId);
    return salesReturn;
  }

  classifyChannelFinanceEvent(input: {
    financeEventId: ID;
    eventKind?: ChannelFinanceEvent["eventKind"];
    treatment?: ChannelFinanceEvent["treatment"];
    category?: ChannelFinanceEvent["category"];
    amountRub?: number;
    comment?: string;
    operationType?: string;
    operationTypeName?: string;
  }): ChannelFinanceEvent {
    const event = this.mustFind(this.state.channelFinanceEvents, input.financeEventId, "finance_event_not_found");
    const document = this.mustFind(this.state.documents, event.documentId, "document_not_found");
    if (input.eventKind) event.eventKind = input.eventKind;
    if (input.treatment !== undefined) event.treatment = input.treatment;
    if (input.category !== undefined) event.category = input.category;
    if (input.amountRub !== undefined) {
      assertNonNegative(input.amountRub, "Сумма события канала не может быть отрицательной");
      event.amountRub = round2(input.amountRub);
      document.amountRub = event.amountRub;
    }
    if (input.comment !== undefined) {
      event.comment = input.comment;
      document.comment = input.comment;
    }
    if (input.operationType !== undefined) event.operationType = input.operationType;
    if (input.operationTypeName !== undefined) event.operationTypeName = input.operationTypeName;
    if (!event.treatment) event.treatment = event.linkedReturnId ? "return_variable" : event.linkedSaleId ? "sale_variable" : defaultFinanceTreatment(event.eventKind);
    if (!event.category) event.category = defaultFinanceCategory(event.eventKind);
    document.title = channelFinanceDocumentTitle(event.eventKind, event.category);
    event.status = event.eventKind ? "classified" : "needs_attention";
    return event;
  }

  linkChannelFinanceEventToSale(financeEventId: ID, saleId: ID): ChannelFinanceEvent {
    const event = this.mustFind(this.state.channelFinanceEvents, financeEventId, "finance_event_not_found");
    const sale = this.mustFind(this.state.sales, saleId, "sale_not_found");
    if (sale.channelId !== event.channelId) {
      throw new DomainError("finance_event_channel_mismatch", "Связать можно только с продажей того же канала");
    }
    event.linkedSaleId = sale.id;
    event.saleAllocations = undefined;
    if (!event.treatment) event.treatment = "sale_variable";
    event.status = event.eventKind ? "classified" : event.status;
    this.ensureDocumentLink(event.documentId, sale.documentId, "channel_fee");
    return event;
  }

  linkChannelFinanceEventToReturn(financeEventId: ID, returnId: ID): ChannelFinanceEvent {
    const event = this.mustFind(this.state.channelFinanceEvents, financeEventId, "finance_event_not_found");
    const salesReturn = this.mustFind(this.state.salesReturns, returnId, "return_not_found");
    if (salesReturn.channelId !== event.channelId) {
      throw new DomainError("finance_event_channel_mismatch", "Связать можно только с возвратом того же канала");
    }
    event.linkedReturnId = salesReturn.id;
    if (!event.treatment) event.treatment = "return_variable";
    if (!["posted", "reversed", "ignored"].includes(event.status)) {
      event.status = event.eventKind ? "classified" : event.status;
    }
    this.ensureDocumentLink(event.documentId, salesReturn.documentId, "channel_fee");
    return event;
  }

  allocateChannelFinanceEventToSales(financeEventId: ID, allocations: Array<{ saleId: ID; amountRub: number }>): ChannelFinanceEvent {
    const event = this.mustFind(this.state.channelFinanceEvents, financeEventId, "finance_event_not_found");
    if (!allocations.length) {
      throw new DomainError("finance_event_allocations_empty", "Нужна хотя бы одна продажа для распределения");
    }
    const normalized = allocations.map((allocation) => {
      const sale = this.mustFind(this.state.sales, allocation.saleId, "sale_not_found");
      if (sale.channelId !== event.channelId) {
        throw new DomainError("finance_event_channel_mismatch", "Связать можно только с продажами того же канала");
      }
      return { saleId: sale.id, amountRub: round2(allocation.amountRub) };
    });
    const totalAllocated = round2(normalized.reduce((sum, allocation) => sum + allocation.amountRub, 0));
    if (Math.abs(totalAllocated - event.amountRub) > 0.01) {
      throw new DomainError("finance_event_allocation_unbalanced", "Сумма распределения должна совпадать с суммой события", {
        eventAmountRub: event.amountRub,
        allocatedRub: totalAllocated
      });
    }
    event.linkedSaleId = normalized.length === 1 ? normalized[0].saleId : undefined;
    event.saleAllocations = normalized.length > 1 ? normalized : undefined;
    if (!event.treatment) event.treatment = "sale_variable";
    event.status = event.eventKind ? "classified" : event.status;
    normalized.forEach((allocation) => {
      const sale = this.mustFind(this.state.sales, allocation.saleId, "sale_not_found");
      this.ensureDocumentLink(event.documentId, sale.documentId, "channel_fee");
    });
    return event;
  }

  postChannelFinanceEvent(financeEventId: ID): ChannelFinanceEvent {
    const event = this.mustFind(this.state.channelFinanceEvents, financeEventId, "finance_event_not_found");
    const document = this.mustFind(this.state.documents, event.documentId, "document_not_found");
    if (event.status === "posted" && document.status === "posted") return event;
    if (document.status === "cancelled") {
      throw new DomainError("document_cancelled", "Отмененную финансовую операцию нельзя провести повторно");
    }
    if (!event.eventKind) {
      throw new DomainError("finance_event_not_classified", "Выберите статью операции");
    }
    const treatment = event.treatment ?? defaultFinanceTreatment(event.eventKind);
    const journalLines = treatment === "other_income"
      ? [
          { accountCode: "76.ТП", debit: event.amountRub, memo: "Компенсация к получению" },
          { accountCode: "91.01", credit: event.amountRub, memo: "Прочий доход от канала" }
        ]
      : [
          { accountCode: treatment === "other_expense" ? "91.02" : "44", debit: event.amountRub, memo: "Удержание канала" },
          { accountCode: "76.ТП", credit: event.amountRub, memo: "Уменьшение задолженности канала" }
        ];
    this.postDocument(document.id, journalLines);
    event.status = "posted";
    if (event.linkedSaleId) {
      const sale = this.mustFind(this.state.sales, event.linkedSaleId, "sale_not_found");
      this.ensureDocumentLink(event.documentId, sale.documentId, "channel_fee");
    }
    if (event.saleAllocations?.length) {
      event.saleAllocations.forEach((allocation) => {
        const sale = this.mustFind(this.state.sales, allocation.saleId, "sale_not_found");
        this.ensureDocumentLink(event.documentId, sale.documentId, "channel_fee");
      });
    }
    if (event.linkedReturnId) {
      const salesReturn = this.mustFind(this.state.salesReturns, event.linkedReturnId, "return_not_found");
      this.ensureDocumentLink(event.documentId, salesReturn.documentId, "channel_fee");
    }
    this.markExternalEventProcessed(event.externalEventId, event.documentId);
    return event;
  }

  linkBankPaymentToPayout(input: { payoutId: ID; paymentId?: ID; bankReceiptRub?: number }): Payout {
    const payout = this.mustFind(this.state.payouts, input.payoutId, "payout_not_found");
    if (input.paymentId) {
      const payment = this.mustFind(this.state.payments, input.paymentId, "payment_not_found");
      if (this.state.payouts.some((candidate) => candidate.id !== payout.id && candidate.paymentId === payment.id)) {
        throw new DomainError("payment_already_linked", "Это банковское поступление уже связано с другой выплатой");
      }
      payout.paymentId = payment.id;
      payout.cashAccountId = payment.cashAccountId;
      payout.bankReceiptRub = round2(input.bankReceiptRub ?? payment.amountRub);
    } else if (input.bankReceiptRub !== undefined) {
      const amountRub = round2(input.bankReceiptRub);
      if (amountRub < 0) throw new DomainError("payout_bank_amount_invalid", "Сумма банковского поступления не может быть отрицательной");
      let payment = payout.paymentId ? this.mustFind(this.state.payments, payout.paymentId, "payment_not_found") : undefined;
      if (!payment && amountRub > 0) {
        payment = this.createPayment({
          paymentDirection: "incoming",
          paymentType: "channel_payout",
          amountRub,
          paidAt: payout.payoutDate,
          title: "Выплата точки продаж"
        });
        payout.paymentId = payment.id;
        payout.cashAccountId = payment.cashAccountId;
      }
      if (payment) {
        payment.amountRub = amountRub;
        payment.paidAt = payout.payoutDate;
        const paymentDocument = this.mustFind(this.state.documents, payment.documentId, "document_not_found");
        paymentDocument.amountRub = amountRub;
        paymentDocument.accountingDate = payout.payoutDate;
      }
      payout.bankReceiptRub = amountRub;
    }
    this.rebuildPayout(payout.id);
    return payout;
  }

  postChannelPayout(payoutId: ID): Payout {
    const payout = this.mustFind(this.state.payouts, payoutId, "payout_not_found");
    const document = this.mustFind(this.state.documents, payout.documentId, "document_not_found");
    if (document.status === "posted" && (payout.status === "posted" || payout.status === "needs_reconciliation")) return payout;
    if (payout.differenceRub !== 0 && !payout.differenceAccepted) {
      throw new DomainError("payout_difference_unresolved", "Сначала укажите причину расхождения или добейтесь нулевой разницы");
    }
    if (payout.paymentId) {
      const payment = this.mustFind(this.state.payments, payout.paymentId, "payment_not_found");
      const paymentDocument = this.mustFind(this.state.documents, payment.documentId, "document_not_found");
      if (paymentDocument.status !== "posted") {
        paymentDocument.status = "posted";
        paymentDocument.postedAt = nowIso();
        this.applyPaymentToCashAccount(payment);
      }
    } else if (payout.bankReceiptRub > 0) {
      this.linkBankPaymentToPayout({ payoutId: payout.id, bankReceiptRub: payout.bankReceiptRub });
      if (payout.paymentId) return this.postChannelPayout(payout.id);
    }

    if (payout.bankReceiptRub > 0) {
      this.postDocument(document.id, [
        { accountCode: "51", debit: payout.bankReceiptRub, memo: "Поступление выплаты на расчетный счет" },
        { accountCode: "76.ТП", credit: payout.bankReceiptRub, memo: "Закрытие задолженности точки продаж" }
      ]);
    } else {
      document.status = "posted";
      document.postedAt = nowIso();
    }

    this.state.payoutLines
      .filter((line) => line.payoutId === payout.id && line.sourceType === "finance_event" && line.sourceId)
      .forEach((line) => {
        const financeEvent = this.state.channelFinanceEvents.find((candidate) => candidate.id === line.sourceId);
        if (financeEvent) financeEvent.payoutId = payout.id;
      });
    payout.status = payout.differenceRub === 0 ? "posted" : "needs_reconciliation";
    return payout;
  }

  leavePayoutDifference(payoutId: ID, reason: string): Payout {
    const payout = this.mustFind(this.state.payouts, payoutId, "payout_not_found");
    payout.differenceReason = reason;
    payout.differenceAccepted = true;
    payout.status = payout.differenceRub === 0 ? "ready" : "needs_reconciliation";
    return payout;
  }

  rebuildPayout(payoutId: ID): Payout {
    const payout = this.mustFind(this.state.payouts, payoutId, "payout_not_found");
    const cutoff = payout.periodTo ?? payout.payoutDate;
    const manualLines = this.state.payoutLines
      .filter((line) => line.payoutId === payout.id && line.sourceType === "manual_adjustment")
      .map((line) => ({ ...line }));
    const usedSaleIds = new Set(
      this.state.payoutLines
        .filter((line) => line.payoutId !== payout.id && line.sourceType === "sale" && line.sourceId)
        .map((line) => String(line.sourceId))
    );
    const usedReturnIds = new Set(
      this.state.payoutLines
        .filter((line) => line.payoutId !== payout.id && line.sourceType === "return" && line.sourceId)
        .map((line) => String(line.sourceId))
    );
    const usedFinanceIds = new Set(
      this.state.payoutLines
        .filter((line) => line.payoutId !== payout.id && line.sourceType === "finance_event" && line.sourceId)
        .map((line) => String(line.sourceId))
    );

    const lines: PayoutLine[] = [];
    if (payout.compositionMode !== "manual") {
      this.state.sales
        .filter((sale) => sale.channelId === payout.channelId && sale.status === "posted" && sale.saleDate <= cutoff && !usedSaleIds.has(sale.id))
        .forEach((sale) => {
          lines.push({
            id: id("payout_line"),
            payoutId: payout.id,
            sourceType: "sale",
            sourceId: sale.id,
            saleId: sale.id,
            lineGroup: "sales",
            amountRub: saleFinancialAmountRub(sale)
          });
        });
      this.state.salesReturns
        .filter((salesReturn) => salesReturn.channelId === payout.channelId && salesReturn.status === "posted" && salesReturn.returnDate <= cutoff && !usedReturnIds.has(salesReturn.id))
        .forEach((salesReturn) => {
          lines.push({ id: id("payout_line"), payoutId: payout.id, sourceType: "return", sourceId: salesReturn.id, lineGroup: "returns", amountRub: -salesReturn.refundRub });
        });
      this.state.channelFinanceEvents
        .filter((event) =>
          event.channelId === payout.channelId &&
          event.status !== "ignored" &&
          event.status !== "reversed" &&
          event.occurredAt <= cutoff &&
          !usedFinanceIds.has(event.id)
        )
        .forEach((event) => {
          const amountRub = event.eventKind === "compensation" ? event.amountRub : -event.amountRub;
          const lineGroup = event.eventKind === "commission"
            ? "commissions"
            : event.eventKind === "logistics"
              ? "logistics"
              : event.eventKind === "penalty"
                ? "penalties"
                : "compensations";
          lines.push({
            id: id("payout_line"),
            payoutId: payout.id,
            sourceType: "finance_event",
            sourceId: event.id,
            channelFinanceEventId: event.id,
            lineGroup,
            amountRub
          });
        });
    }

    lines.push(...manualLines);

    this.state.payoutLines = this.state.payoutLines.filter((line) => line.payoutId !== payout.id).concat(lines);
    const expectedAmountRub = round2(lines.reduce((sum, line) => sum + line.amountRub, 0));
    payout.expectedAmountRub = expectedAmountRub;
    payout.grossEventsRub = expectedAmountRub;
    payout.differenceRub = round2(expectedAmountRub - payout.bankReceiptRub);
    if (payout.status !== "posted" && payout.status !== "reconciled") {
      payout.status = payout.differenceRub === 0 ? "ready" : "needs_reconciliation";
    }
    return payout;
  }

  recordOperatingExpense(input: {
    categoryId: ID;
    expenseDate: string;
    amountRub: number;
    counterpartyId?: ID;
    cashAccountId?: ID;
    comment?: string;
    post?: boolean;
  }): OperatingExpense {
    assertPositive(input.amountRub, "Сумма расхода должна быть положительной");
    const category = this.mustFind(this.state.expenseCategories, input.categoryId, "expense_category_not_found");
    const payment = this.createPayment({
      paymentDirection: "outgoing",
      paymentType: "operating_expense_payment",
      amountRub: input.amountRub,
      paidAt: input.expenseDate,
      title: "Операционный расход",
      counterpartyId: input.counterpartyId,
      cashAccountId: input.cashAccountId,
      comment: input.comment
    });
    const expense: OperatingExpense = {
      id: id("op_expense"),
      organizationId: this.currentOrgId(),
      documentId: payment.documentId,
      categoryId: category.id,
      paymentId: payment.id,
      counterpartyId: input.counterpartyId,
      expenseDate: input.expenseDate,
      amountRub: input.amountRub,
      amountPaidRub: input.amountRub,
      paymentMode: "paid_now",
      paymentStatus: "paid",
      cashAccountId: payment.cashAccountId,
      comment: input.comment
    };
    this.state.operatingExpenses.push(expense);
    if (input.post !== false) {
      this.postOperatingExpense(expense.id);
    }
    return expense;
  }

  // Расход всегда оплачивается сразу: Дт категории / Кт 51.
  postOperatingExpense(expenseId: ID): OperatingExpense {
    const expense = this.mustFind(this.state.operatingExpenses, expenseId, "expense_not_found");
    const category = this.mustFind(this.state.expenseCategories, expense.categoryId, "expense_category_not_found");
    const payment = this.mustFind(this.state.payments, expense.paymentId, "payment_not_found");
    const document = this.mustFind(this.state.documents, expense.documentId, "document_not_found");

    if (document.status === "posted") {
      expense.paymentStatus = "paid";
      expense.amountPaidRub = expense.amountRub;
      return expense;
    }

    this.postDocument(document.id, [
      { accountCode: category.accountCode, debit: expense.amountRub, memo: category.name },
      { accountCode: "51", credit: expense.amountRub, memo: "Оплата операционного расхода" }
    ]);
    this.applyPaymentToCashAccount(payment);
    expense.amountPaidRub = expense.amountRub;
    expense.paymentStatus = "paid";

    return expense;
  }

  recordOwnerWithdrawal(input: { amountRub: number; paidAt: string; comment?: string }) {
    const payment = this.createPayment({
      paymentDirection: "outgoing",
      paymentType: "owner_withdrawal",
      amountRub: input.amountRub,
      paidAt: input.paidAt,
      title: "Изъятие средств владельцем",
      comment: input.comment
    });
    this.state.ownerTransactions.push({
      id: id("owner_tx"),
      organizationId: this.currentOrgId(),
      documentId: payment.documentId,
      paymentId: payment.id,
      transactionType: "withdrawal",
      amountRub: input.amountRub
    });
    this.postDocument(payment.documentId, [
      { accountCode: "80.02", debit: input.amountRub, memo: "Изъятие владельца" },
      { accountCode: "51", credit: input.amountRub, memo: "Выплата владельцу" }
    ]);
    this.applyPaymentToCashAccount(payment);
    return payment;
  }

  runStocktake(input: {
    warehouseId: ID;
    stocktakeDate: string;
    comment?: string;
    post?: boolean;
    lines: Array<{ productId: ID; observedQty: number; unitCostRub?: number }>;
  }) {
    const document = this.createDocument({
      documentType: "stocktake",
      accountingDate: input.stocktakeDate,
      title: "Инвентаризация",
      amountRub: 0,
      comment: input.comment
    });
    const stocktake: Stocktake = {
      id: id("stocktake"),
      organizationId: this.currentOrgId(),
      warehouseId: input.warehouseId,
      documentId: document.id,
      stocktakeDate: input.stocktakeDate,
      status: input.post === false ? "draft" : "posted"
    };
    this.state.stocktakes.push(stocktake);
    input.lines.forEach((line) => {
      const book = this.stockState(line.productId, input.warehouseId);
      const diffQty = round4(line.observedQty - book.qty);
      const avgCost = book.qty > 0 ? book.costRub / book.qty : 0;
      const unitCostRub = diffQty > 0 ? (line.unitCostRub ?? avgCost) : avgCost;
      const adjustmentCostRub = round2(Math.abs(diffQty) * unitCostRub);
      this.state.stocktakeLines.push({
        id: id("stocktake_line"),
        stocktakeId: stocktake.id,
        productId: line.productId,
        bookQty: book.qty,
        observedQty: line.observedQty,
        differenceQty: diffQty,
        bookCostRub: book.costRub,
        adjustmentCostRub
      });
    });

    if (input.post !== false) {
      this.postStocktake(stocktake.id);
    } else {
      document.status = "draft";
      document.postedAt = undefined;
    }
    return stocktake;
  }

  postStocktake(stocktakeId: ID) {
    const stocktake = this.mustFind(this.state.stocktakes, stocktakeId, "stocktake_not_found");
    const document = this.mustFind(this.state.documents, stocktake.documentId, "document_not_found");
    if (stocktake.status === "posted") return stocktake;

    const journalLines: JournalLineInput[] = [];
    const lines = this.state.stocktakeLines.filter((line) => line.stocktakeId === stocktake.id);
    const inventoryAccount = accountForWarehouse(this.mustFind(this.state.warehouses, stocktake.warehouseId, "warehouse_not_found"));

    lines.forEach((line) => {
      if (line.differenceQty < 0) {
        this.consumeFifo({
          productId: line.productId,
          warehouseId: stocktake.warehouseId,
          qty: Math.abs(line.differenceQty),
          documentId: document.id,
          occurredAt: stocktake.stocktakeDate,
          applicationType: "writeoff",
          movementType: "adjustment"
        });
        if (line.adjustmentCostRub > 0) {
          journalLines.push(
            { accountCode: "94", debit: line.adjustmentCostRub, memo: "Недостача при инвентаризации" },
            { accountCode: inventoryAccount, credit: line.adjustmentCostRub, memo: "Списание товарного остатка" }
          );
        }
      }
      if (line.differenceQty > 0) {
        this.createLot({
          productId: line.productId,
          warehouseId: stocktake.warehouseId,
          documentId: document.id,
          qty: line.differenceQty,
          costRub: line.adjustmentCostRub,
          date: stocktake.stocktakeDate,
          movementType: "adjustment"
        });
        if (line.adjustmentCostRub > 0) {
          journalLines.push(
            { accountCode: inventoryAccount, debit: line.adjustmentCostRub, memo: "Оприходование излишка" },
            { accountCode: "91.01", credit: line.adjustmentCostRub, memo: "Прочий доход от излишка" }
          );
        }
      }
    });

    if (journalLines.length > 0) {
      this.postDocument(document.id, journalLines);
    } else {
      document.status = "posted";
      document.postedAt = nowIso();
    }
    stocktake.status = "posted";
    return stocktake;
  }

  previewCorrection(documentId: ID, patch: Record<string, unknown>, reason = "Предпросмотр") {
    const document = this.mustFind(this.state.documents, documentId, "document_not_found");
    this.assertDocumentHasNoDescendants(document.id, "Нельзя изменить документ, пока от него зависят другие документы");
    return {
      document,
      reason,
      periodStatus: this.periodForDate(document.accountingDate)?.status ?? "unknown",
      patch,
      impact: {
        journalEntries: this.state.journalEntries.filter((entry) => entry.documentId === documentId).length,
        stockMovements: this.state.stockMovements.filter((movement) => movement.documentId === documentId).length,
        dependentSales: this.state.sales.filter((sale) => sale.documentId !== documentId).length,
        reports: ["Прибыль и убытки", "Баланс", "Остатки и партии"]
      }
    };
  }

  documentDescendants(documentId: ID): DocumentDescendantSummary[] {
    this.mustFind(this.state.documents, documentId, "document_not_found");
    const documentTypesByCode = new Map(this.state.documentTypes.map((documentType) => [documentType.code, documentType.displayName]));
    const queue: Array<{ documentId: ID; depth: number }> = [{ documentId, depth: 0 }];
    const visited = new Set<ID>([documentId]);
    const descendants: DocumentDescendantSummary[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const link of this.state.documentLinks) {
        const descendantId = this.documentDescendantIdForLink(link, current.documentId);
        if (!descendantId || visited.has(descendantId)) continue;
        const descendant = this.state.documents.find((candidate) => candidate.id === descendantId);
        if (!descendant) continue;
        visited.add(descendantId);
        descendants.push({
          documentId: descendant.id,
          number: descendant.number,
          title: descendant.title,
          documentType: descendant.documentType,
          documentTypeName: documentTypesByCode.get(descendant.documentType) ?? descendant.documentType,
          status: descendant.status,
          accountingDate: descendant.accountingDate,
          linkType: link.linkType,
          parentDocumentId: current.documentId,
          depth: current.depth + 1
        });
        queue.push({ documentId: descendant.id, depth: current.depth + 1 });
      }
    }

    return descendants.sort((left, right) =>
      left.depth - right.depth ||
      left.accountingDate.localeCompare(right.accountingDate) ||
      left.number.localeCompare(right.number)
    );
  }

  private documentTypeDisplayName(documentType: string) {
    return this.state.documentTypes.find((candidate) => candidate.code === documentType)?.displayName ?? documentType;
  }

  private findRollbackDocumentSummary(documentId: ID): RollbackRelatedDocumentSummary | undefined {
    const document = this.state.documents.find((candidate) => candidate.id === documentId);
    if (!document) return undefined;
    return {
      documentId: document.id,
      number: document.number,
      title: document.title,
      documentType: document.documentType,
      documentTypeName: this.documentTypeDisplayName(document.documentType),
      status: document.status,
      accountingDate: document.accountingDate
    };
  }

  private saleResetExternalEventIds(sale: Sale, linkedFinanceEvents: ChannelFinanceEvent[]): Set<ID> {
    const resetExternalEventIds = new Set<ID>();
    if (sale.externalEventId) resetExternalEventIds.add(sale.externalEventId);
    linkedFinanceEvents.forEach((event) => {
      if (event.externalEventId) resetExternalEventIds.add(event.externalEventId);
    });
    if (sale.financialDocumentId) {
      this.state.externalEvents
        .filter((event) => event.materializedDocumentId === sale.financialDocumentId)
        .forEach((event) => resetExternalEventIds.add(event.id));
    }
    return resetExternalEventIds;
  }

  private inventoryUsageDocuments(sourceDocumentId: ID): RollbackRelatedDocumentSummary[] {
    const outboundDocumentIds = new Set(
      this.state.costApplications
        .filter((application) => application.sourceDocumentId === sourceDocumentId && application.outboundDocumentId !== sourceDocumentId)
        .map((application) => application.outboundDocumentId)
    );
    return [...outboundDocumentIds]
      .map((documentId) => this.findRollbackDocumentSummary(documentId))
      .filter((item): item is RollbackRelatedDocumentSummary => Boolean(item))
      .sort((left, right) =>
        left.accountingDate.localeCompare(right.accountingDate) ||
        left.number.localeCompare(right.number)
      );
  }

  assertDocumentHasNoDescendants(documentId: ID, message: string) {
    const descendants = this.documentDescendants(documentId);
    if (descendants.length === 0) return;
    throw new DomainError("document_has_descendants", message, { descendants });
  }

  applyProcurementCostCorrection(input: { procurementCostId: ID; newAmountRub: number; reason: string }) {
    const cost = this.mustFind(this.state.procurementCosts, input.procurementCostId, "procurement_cost_not_found");
    const nextAmountRub = round2(input.newAmountRub);
    assertNonNegative(nextAmountRub, "Сумма расхода не может быть отрицательной");
    const accountingDelta = round2(nextAmountRub - cost.amountRub);
    const sourceDocument = this.mustFind(this.state.documents, cost.documentId, "document_not_found");
    const beforeCost = { ...cost };
    const beforeDocument = { ...sourceDocument };
    const currentLines = this.state.procurementCostLines.filter((line) => line.procurementCostId === cost.id);
    const nextLines = this.reallocateProcurementCostLines(currentLines, nextAmountRub);
    const currentLineAmountRub = round2(currentLines.reduce((sum, line) => sum + Number(line.allocatedAmountRub ?? 0), 0));
    const allocationDelta = round2(nextAmountRub - currentLineAmountRub);
    if (accountingDelta !== 0 && allocationDelta !== accountingDelta) {
      throw new DomainError(
        "procurement_cost_correction_desynced",
        "Расход уже частично исправлен. Сначала примените текущую сумму повторно, чтобы синхронизировать строки документа."
      );
    }
    const correction = this.createCorrectionCase(sourceDocument.id, "open_period_edit", input.reason, {
      beforeAmountRub: cost.amountRub,
      afterAmountRub: nextAmountRub,
      delta: accountingDelta
    });
    this.state.documentVersions.push({
      id: id("doc_version"),
      documentId: sourceDocument.id,
      versionNo: this.state.documentVersions.filter((version) => version.documentId === sourceDocument.id).length + 1,
      snapshot: { ...sourceDocument, procurementCost: { ...cost } },
      reason: input.reason,
      createdAt: nowIso()
    });
    const inventoryDeltasByAccount = new Map<string, number>();
    let soldCostDeltaRub = 0;
    currentLines.forEach((line, index) => {
      const nextLine = nextLines[index];
      const allocatedDelta = round2(nextLine.allocatedAmountRub - Number(line.allocatedAmountRub ?? 0));
      const remainingDelta = round2(nextLine.remainingInventoryAmountRub - Number(line.remainingInventoryAmountRub ?? 0));
      const soldDelta = round2(nextLine.soldCostAmountRub - Number(line.soldCostAmountRub ?? 0));
      const lot = line.lotId ? this.state.inventoryLots.find((candidate) => candidate.id === line.lotId) : undefined;
      if (lot) {
        lot.costInitialRub = round2(lot.costInitialRub + allocatedDelta);
        if (remainingDelta !== 0) {
          lot.costRemainingRub = round2(Math.max(0, lot.costRemainingRub + remainingDelta));
          lot.unitCostRub = lot.qtyRemaining > 0 ? round6(lot.costRemainingRub / lot.qtyRemaining) : 0;
          this.addStockState(lot.productId, lot.warehouseId, 0, remainingDelta, lot.stockStateCode);
          const warehouse = this.mustFind(this.state.warehouses, lot.warehouseId, "warehouse_not_found");
          const accountCode = accountForWarehouse(warehouse);
          inventoryDeltasByAccount.set(accountCode, round2((inventoryDeltasByAccount.get(accountCode) ?? 0) + remainingDelta));
        }
      }
      soldCostDeltaRub = round2(soldCostDeltaRub + soldDelta);
      line.basisValue = nextLine.basisValue;
      line.qtyInitial = nextLine.qtyInitial;
      line.qtyRemaining = nextLine.qtyRemaining;
      line.qtySold = nextLine.qtySold;
      line.allocatedAmountRub = nextLine.allocatedAmountRub;
      line.remainingInventoryAmountRub = nextLine.remainingInventoryAmountRub;
      line.soldCostAmountRub = nextLine.soldCostAmountRub;
    });
    this.syncProcurementCostDocumentLines(sourceDocument.id, currentLines);
    sourceDocument.amountRub = nextAmountRub;
    this.syncProcurementCostPayment(cost, nextAmountRub);
    cost.amountRub = nextAmountRub;

    if (accountingDelta !== 0) {
      const document = this.createDocument({
        documentType: "correction",
        accountingDate: sourceDocument.accountingDate,
        title: "Корректировка расхода закупки",
        amountRub: Math.abs(accountingDelta),
        comment: input.reason
      });
      const journalLines: JournalLineInput[] = [];
      inventoryDeltasByAccount.forEach((amount, accountCode) => {
        if (amount > 0) journalLines.push({ accountCode, debit: amount, memo: "Увеличение расхода закупки в остатках" });
        if (amount < 0) journalLines.push({ accountCode, credit: Math.abs(amount), memo: "Уменьшение расхода закупки в остатках" });
      });
      if (soldCostDeltaRub > 0) {
        journalLines.push({ accountCode: "90.02", debit: soldCostDeltaRub, memo: "Увеличение расхода закупки по проданным товарам" });
      }
      if (soldCostDeltaRub < 0) {
        journalLines.push({ accountCode: "90.02", credit: Math.abs(soldCostDeltaRub), memo: "Уменьшение расхода закупки по проданным товарам" });
      }
      const sourceAccountCode = cost.paidImmediately ? "51" : "60.01";
      if (accountingDelta > 0) {
        journalLines.push({ accountCode: sourceAccountCode, credit: Math.abs(accountingDelta), memo: "Увеличение источника расхода" });
      } else {
        journalLines.push({ accountCode: sourceAccountCode, debit: Math.abs(accountingDelta), memo: "Уменьшение источника расхода" });
      }
      this.postDocument(document.id, journalLines);
      this.linkDocuments(sourceDocument.id, document.id, "correction");
    }
    correction.status = "applied";
    correction.appliedAt = nowIso();
    this.audit("procurement_cost", cost.id, "correct", beforeCost, cost, input.reason);
    this.audit("document", sourceDocument.id, "correct", beforeDocument, sourceDocument, input.reason);
    this.queueRecalculation("inventory_cost", { procurementCostId: cost.id });
    return correction;
  }

  private reallocateProcurementCostLines(lines: ProcurementCostLine[], targetAmountRub: number) {
    if (lines.length === 0) {
      if (targetAmountRub > 0) {
        throw new DomainError("procurement_cost_no_lines", "Нет строк распределения расхода");
      }
      return [] as Array<{
        basisValue: number;
        qtyInitial: number;
        qtyRemaining: number;
        qtySold: number;
        allocatedAmountRub: number;
        remainingInventoryAmountRub: number;
        soldCostAmountRub: number;
      }>;
    }

    const basisValues = lines.map((line) => {
      const explicitBasis = Number(line.basisValue ?? 0);
      if (explicitBasis > 0) return round6(explicitBasis);
      const currentAmount = Math.abs(Number(line.allocatedAmountRub ?? 0));
      return currentAmount > 0 ? round6(currentAmount) : 1;
    });
    const totalBasis = round6(basisValues.reduce((sum, value) => sum + value, 0));
    if (totalBasis <= 0 && targetAmountRub > 0) {
      throw new DomainError("procurement_cost_no_basis", "Нет базы для распределения расхода");
    }

    let allocatedTotal = 0;
    let remainingTotal = 0;
    let soldTotal = 0;
    const nextLines = lines.map((line, index) => {
      const isLast = index === lines.length - 1;
      const allocatedAmountRub = isLast
        ? round2(targetAmountRub - allocatedTotal)
        : round2((targetAmountRub * basisValues[index]) / totalBasis);
      allocatedTotal = round2(allocatedTotal + allocatedAmountRub);

      const lot = line.lotId ? this.state.inventoryLots.find((candidate) => candidate.id === line.lotId) : undefined;
      const qtyInitial = round4(Math.max(0, Number(lot?.qtyInitial ?? line.qtyInitial ?? 0)));
      const qtyRemaining = round4(Math.max(0, Number(lot?.qtyRemaining ?? line.qtyRemaining ?? 0)));
      const qtySold = round4(Math.max(0, qtyInitial - qtyRemaining));
      const previousAllocated = Number(line.allocatedAmountRub ?? 0);
      const previousSold = Number(line.soldCostAmountRub ?? 0);
      const soldRatio = Math.max(0, Math.min(1,
        qtyInitial > 0
          ? qtySold / qtyInitial
          : previousAllocated > 0
            ? previousSold / previousAllocated
            : 0
      ));
      const soldCostAmountRub = round2(allocatedAmountRub * soldRatio);
      const remainingInventoryAmountRub = round2(allocatedAmountRub - soldCostAmountRub);
      remainingTotal = round2(remainingTotal + remainingInventoryAmountRub);
      soldTotal = round2(soldTotal + soldCostAmountRub);
      return {
        basisValue: basisValues[index],
        qtyInitial,
        qtyRemaining,
        qtySold,
        allocatedAmountRub,
        remainingInventoryAmountRub,
        soldCostAmountRub
      };
    });

    const correction = round2(targetAmountRub - remainingTotal - soldTotal);
    if (correction !== 0 && nextLines.length > 0) {
      const last = nextLines[nextLines.length - 1];
      if (last.qtyRemaining > 0) {
        last.remainingInventoryAmountRub = round2(last.remainingInventoryAmountRub + correction);
      } else {
        last.soldCostAmountRub = round2(last.soldCostAmountRub + correction);
      }
    }
    return nextLines;
  }

  private syncProcurementCostDocumentLines(documentId: ID, lines: ProcurementCostLine[]) {
    const documentLines = this.state.documentLines
      .filter((line) => line.documentId === documentId && line.lineType === "procurement_cost_line")
      .sort((left, right) => left.lineNo - right.lineNo);
    const usedLineIds = new Set<ID>();

    lines.forEach((line, index) => {
      const findMatchingLine = () => documentLines.find((documentLine) => {
        if (usedLineIds.has(documentLine.id)) return false;
        const payload = documentLine.payload ?? {};
        return (!line.lotId || payload.lotId === line.lotId) && payload.productId === line.productId;
      }) ?? documentLines.find((documentLine) => !usedLineIds.has(documentLine.id) && documentLine.payload?.productId === line.productId)
        ?? documentLines[index];

      const documentLine = findMatchingLine();
      if (!documentLine) {
        this.state.documentLines.push({
          id: id("doc_line"),
          documentId,
          lineNo: this.state.documentLines.filter((candidate) => candidate.documentId === documentId).length + 1,
          lineType: "procurement_cost_line",
          amountRub: line.allocatedAmountRub,
          payload: {
            lotId: line.lotId,
            productId: line.productId,
            warehouseId: line.warehouseId,
            remainingInventoryAmountRub: line.remainingInventoryAmountRub,
            soldCostAmountRub: line.soldCostAmountRub
          }
        });
        return;
      }

      usedLineIds.add(documentLine.id);
      documentLine.amountRub = line.allocatedAmountRub;
      documentLine.payload = {
        ...documentLine.payload,
        lotId: line.lotId,
        productId: line.productId,
        warehouseId: line.warehouseId,
        remainingInventoryAmountRub: line.remainingInventoryAmountRub,
        soldCostAmountRub: line.soldCostAmountRub
      };
    });
  }

  private syncProcurementCostPayment(cost: ProcurementCost, nextAmountRub: number) {
    if (!cost.paidImmediately) return;
    const payment = this.state.payments.find((candidate) =>
      candidate.documentId === cost.documentId &&
      candidate.paymentType === "procurement_cost_payment"
    );
    if (!payment) return;
    const previousAmountRub = round2(Number(payment.amountRub ?? 0));
    const delta = round2(nextAmountRub - previousAmountRub);
    if (delta === 0) return;
    const beforePayment = { ...payment };
    payment.amountRub = nextAmountRub;
    this.state.paymentAllocations
      .filter((allocation) =>
        allocation.paymentId === payment.id &&
        allocation.documentId === cost.documentId &&
        allocation.allocationPurpose === "procurement_cost"
      )
      .forEach((allocation) => {
        allocation.amountRub = nextAmountRub;
      });
    const cashAccount = this.state.cashAccounts.find((account) => account.id === payment.cashAccountId);
    if (cashAccount) {
      const direction = payment.paymentDirection === "incoming" ? 1 : -1;
      cashAccount.balanceRub = round2(cashAccount.balanceRub + direction * delta);
    }
    this.audit("payment", payment.id, "correct", beforePayment, payment, "Исправление расхода закупки");
  }

  applyReceiptQuantityCorrection(input: {
    goodsReceiptId: ID;
    purchaseOrderLineId: ID;
    newQtyReceived: number;
    reason: string;
  }) {
    const receipt = this.mustFind(this.state.goodsReceipts, input.goodsReceiptId, "receipt_not_found");
    const receiptLine = this.state.goodsReceiptLines.find((line) => line.goodsReceiptId === receipt.id && line.purchaseOrderLineId === input.purchaseOrderLineId);
    if (!receiptLine) throw new DomainError("receipt_line_not_found", "Строка приемки не найдена");
    if (input.newQtyReceived >= receiptLine.qtyReceived) {
      throw new DomainError("unsupported_correction", "Этот метод предназначен для уменьшения приемки");
    }
    const sourceDocument = this.mustFind(this.state.documents, receipt.documentId, "document_not_found");
    const qtyDelta = round4(receiptLine.qtyReceived - input.newQtyReceived);
    const amountDelta = round2(receiptLine.unitCostRub * qtyDelta);
    const correction = this.createCorrectionCase(sourceDocument.id, "open_period_edit", input.reason, {
      productId: receiptLine.productId,
      oldQty: receiptLine.qtyReceived,
      newQty: input.newQtyReceived,
      amountDelta
    });
    const state = this.stockState(receiptLine.productId, receipt.warehouseId);
    if (state.qty + 0.0001 < qtyDelta) {
      correction.status = "failed";
      throw new DomainError("negative_stock_after_correction", "Исправление создаст отрицательный остаток", { state, qtyDelta });
    }
    const document = this.createDocument({
      documentType: "correction",
      accountingDate: sourceDocument.accountingDate,
      title: "Корректировка приемки товара",
      amountRub: amountDelta,
      comment: input.reason
    });
    this.consumeFifo({
      productId: receiptLine.productId,
      warehouseId: receipt.warehouseId,
      qty: qtyDelta,
      documentId: document.id,
      occurredAt: sourceDocument.accountingDate,
      applicationType: "correction",
      movementType: "correction"
    });
    this.postDocument(document.id, [
      { accountCode: "60.02", debit: amountDelta, memo: "Возврат доли оплаты в аванс по недопоставке" },
      { accountCode: "41.01", credit: amountDelta, memo: "Уменьшение фактически принятого товара" }
    ]);
    this.linkDocuments(sourceDocument.id, document.id, "correction");
    receiptLine.qtyReceived = input.newQtyReceived;
    receiptLine.allocatedGoodsCostRub = round2(receiptLine.allocatedGoodsCostRub - amountDelta);
    receiptLine.unitCostRub = round6(receiptLine.allocatedGoodsCostRub / receiptLine.qtyReceived);
    receipt.goodsCostRubTotal = round2(receipt.goodsCostRubTotal - amountDelta);
    correction.status = "applied";
    correction.appliedAt = nowIso();
    this.queueRecalculation("inventory_cost", { goodsReceiptId: receipt.id });
    return correction;
  }


  createAgentToken(input: { name: string; scopes?: string[]; mode?: "read_only" | "read_write"; maskedToken?: string; tokenHash?: string }): AgentToken {
    const mode = input.mode ?? (input.scopes?.some((scope) => /write|post|patch|delete|sync/i.test(scope)) ? "read_write" : "read_only");
    const scopes = input.scopes?.length ? input.scopes : (mode === "read_only" ? ["reports:read", "documents:read", "channels:read"] : ["reports:read", "documents:write", "channels:sync"]);
    const token: AgentToken = {
      id: id("agent"),
      organizationId: this.currentOrgId(),
      name: input.name,
      mode,
      scopes,
      status: "active",
      maskedToken: input.maskedToken ?? "mpf_••••",
      tokenHash: input.tokenHash,
      createdAt: nowIso()
    };
    this.state.agentTokens.push(token);
    return token;
  }

  setupSnapshot() {
    return {
      organization: this.state.organization,
      accountingPolicy: this.state.accountingPolicy,
      periods: this.state.periods,
      cashAccounts: this.state.cashAccounts,
      warehouses: this.state.warehouses,
      configured: Boolean(this.state.organization)
    };
  }

  updateOrganization(input: Partial<Pick<Organization, "displayName" | "legalForm" | "taxMode" | "timezone" | "inn">>) {
    const { organization } = this.ensureBootstrapped();
    const before = { ...organization };
    if (input.displayName !== undefined) organization.displayName = input.displayName;
    if (input.legalForm !== undefined) organization.legalForm = input.legalForm;
    if (input.inn !== undefined) organization.inn = input.inn || undefined;
    if (input.taxMode !== undefined) organization.taxMode = input.taxMode;
    if (input.timezone !== undefined) organization.timezone = input.timezone;
    organization.updatedAt = nowIso();
    this.audit("organization", organization.id, "update", before, organization);
    return organization;
  }

  updateSetup(input: BootstrapInput) {
    const { organization, policy } = this.ensureBootstrapped();
    this.validateSetupInput(input, this.state.documents.length > 0);

    const organizationBefore = { ...organization };
    const policyBefore = { ...policy };

    organization.displayName = input.displayName;
    organization.legalForm = input.legalForm ?? organization.legalForm;
    organization.inn = input.inn || undefined;
    organization.timezone = input.timezone ?? organization.timezone;
    organization.taxMode = input.taxMode ?? organization.taxMode;
    organization.updatedAt = nowIso();

    policy.allowOpenPeriodEdits = input.allowOpenPeriodEdits ?? policy.allowOpenPeriodEdits ?? true;
    policy.comment = input.comment || undefined;

    if (this.state.documents.length === 0 && input.accountingStartDate !== policy.accountingStartDate) {
      policy.accountingStartDate = input.accountingStartDate;
      this.state.periods = monthPeriods(organization.id, input.accountingStartDate, 24);
    }

    this.audit("organization", organization.id, "update", organizationBefore, organization, "Обновление первичной настройки");
    this.audit("accounting_policy", policy.id, "update", policyBefore, policy, "Обновление первичной настройки");
    return this.setupSnapshot();
  }

  extendAccountingStartDateBackward(accountingStartDate: string, reason = "Расширение горизонта учета") {
    const { organization, policy } = this.ensureBootstrapped();
    if (!accountingStartDate) {
      throw new DomainError("accounting_start_required", "Укажите дату старта учета");
    }
    const startDate = new Date(`${accountingStartDate}T00:00:00.000Z`);
    if (Number.isNaN(startDate.getTime())) {
      throw new DomainError("invalid_accounting_start", "Некорректная дата старта учета");
    }
    if (accountingStartDate >= policy.accountingStartDate) return policy;

    const before = { ...policy };
    const existingPeriodsByStart = new Map(this.state.periods.map((period) => [period.startsOn, period]));
    const latestPeriodEnd = this.state.periods.reduce(
      (latest, period) => period.endsOn > latest ? period.endsOn : latest,
      policy.accountingStartDate
    );
    const months = Math.max(24, this.monthsBetweenInclusive(accountingStartDate, latestPeriodEnd));

    policy.accountingStartDate = accountingStartDate;
    this.state.periods = monthPeriods(organization.id, accountingStartDate, months).map((period) => {
      const existing = existingPeriodsByStart.get(period.startsOn);
      return existing
        ? { ...period, id: existing.id }
        : period;
    });

    this.audit("accounting_policy", policy.id, "update", before, policy, reason);
    return policy;
  }

  accountByIdOrCode(idOrCode: ID): ChartAccount {
    return this.state.chartAccounts.find((account) => account.id === idOrCode || account.code === idOrCode) ??
      this.mustFind(this.state.chartAccounts, idOrCode, "account_not_found");
  }

  journalEntryDetails(entryId: ID) {
    const entry = this.mustFind(this.state.journalEntries, entryId, "journal_entry_not_found");
    return {
      entry,
      lines: this.state.journalLines.filter((line) => line.journalEntryId === entry.id),
      document: this.state.documents.find((document) => document.id === entry.documentId)
    };
  }

  createManualDocument(input: {
    documentType?: string;
    accountingDate: string;
    title: string;
    amountRub?: number;
    comment?: string;
    source?: Document["source"];
    lines?: Array<{ lineType?: string; qty?: number; amountRub?: number; payload?: Record<string, unknown> }>;
    journalLines?: JournalLineInput[];
    post?: boolean;
  }): Document {
    const document = this.createDocument({
      documentType: input.documentType ?? "accounting_note",
      accountingDate: input.accountingDate,
      title: input.title,
      amountRub: input.amountRub ?? 0,
      source: input.source,
      comment: input.comment
    });
    (input.lines ?? []).forEach((line, index) => {
      this.state.documentLines.push({
        id: id("doc_line"),
        documentId: document.id,
        lineNo: index + 1,
        lineType: line.lineType ?? "manual",
        qty: line.qty,
        amountRub: line.amountRub,
        payload: line.payload ?? {}
      });
    });
    if (input.post) {
      this.postExistingDocument(document.id, input.journalLines);
    }
    return document;
  }

  updateDraftDocument(documentId: ID, patch: {
    accountingDate?: string;
    title?: string;
    amountRub?: number;
    comment?: string;
    lines?: Array<{ lineType?: string; qty?: number; amountRub?: number; payload?: Record<string, unknown> }>;
    changeReason?: string;
  }): Document {
    const document = this.mustFind(this.state.documents, documentId, "document_not_found");
    if (document.status !== "draft") {
      throw new DomainError("document_not_editable", "Проведенный документ меняется только через исправление");
    }
    this.assertDocumentHasNoDescendants(document.id, "Нельзя изменить документ, пока от него зависят другие документы");
    if (patch.accountingDate) this.assertAccountingDateAllowed(patch.accountingDate);
    const before = {
      document: { ...document },
      lines: this.state.documentLines.filter((line) => line.documentId === document.id).map((line) => ({ ...line }))
    };
    if (patch.accountingDate !== undefined) document.accountingDate = patch.accountingDate;
    if (patch.title !== undefined) document.title = patch.title;
    if (patch.amountRub !== undefined) document.amountRub = patch.amountRub;
    if (patch.comment !== undefined) document.comment = patch.comment;
    if (patch.lines) {
      this.state.documentLines = this.state.documentLines.filter((line) => line.documentId !== document.id);
      patch.lines.forEach((line, index) => {
        this.state.documentLines.push({
          id: id("doc_line"),
          documentId: document.id,
          lineNo: index + 1,
          lineType: line.lineType ?? "manual",
          qty: line.qty,
          amountRub: line.amountRub,
          payload: line.payload ?? {}
        });
      });
    }
    this.state.documentVersions.push({
      id: id("doc_version"),
      documentId: document.id,
      versionNo: this.state.documentVersions.filter((version) => version.documentId === document.id).length + 1,
      snapshot: before,
      reason: patch.changeReason ?? "Редактирование черновика",
      createdAt: nowIso()
    });
    this.audit("document", document.id, "update", before.document, document, patch.changeReason);
    return document;
  }

  postExistingDocument(documentId: ID, journalLines?: JournalLineInput[]) {
    const document = this.mustFind(this.state.documents, documentId, "document_not_found");
    if (document.status === "posted") {
      return { document, entry: this.state.journalEntries.find((entry) => entry.documentId === document.id) };
    }
    if (document.status === "cancelled") {
      throw new DomainError("document_cancelled", "Отмененный документ нельзя провести повторно");
    }
    const registry = this.state.documentTypes.find((type) => type.code === document.documentType);
    if (!registry) throw new DomainError("unknown_document_type", `Неизвестный тип документа: ${document.documentType}`);
    this.assertAccountingDateAllowed(document.accountingDate);
    if (!registry.isPosting) {
      document.status = "posted";
      document.postedAt = nowIso();
      this.audit("document", document.id, "post", undefined, document, "Документ без проводок");
      return { document };
    }
    if (!journalLines || journalLines.length === 0) {
      throw new DomainError("posting_rule_required", "Для этого типа документа нужна проводка или специализированное бизнес-действие");
    }
    return { document, entry: this.postDocument(document.id, journalLines) };
  }

  deleteDraftDocument(documentId: ID): Document {
    const document = this.mustFind(this.state.documents, documentId, "document_not_found");
    if (document.status !== "draft") {
      throw new DomainError("document_delete_not_allowed", "Удалять можно только черновики без проведённых последствий");
    }
    this.assertDocumentHasNoDescendants(document.id, "Нельзя удалить документ, пока от него зависят другие документы");
    if (this.state.journalEntries.some((entry) => entry.documentId === document.id)) {
      throw new DomainError("document_has_postings", "Нельзя удалить документ с проводками");
    }

    switch (document.documentType) {
      case "purchase_order": {
        const order = this.state.purchaseOrders.find((candidate) => candidate.documentId === document.id);
        if (!order) break;
        if (this.paymentsForPurchaseOrder(order.id).length > 0 || this.state.goodsReceipts.some((receipt) => receipt.purchaseOrderId === order.id)) {
          throw new DomainError("purchase_order_has_dependencies", "Нельзя удалить заказ, по которому уже есть оплаты или приемки");
        }
        this.state.purchaseOrderLines = this.state.purchaseOrderLines.filter((line) => line.purchaseOrderId !== order.id);
        this.state.purchaseOrders = this.state.purchaseOrders.filter((candidate) => candidate.id !== order.id);
        break;
      }
      case "goods_receipt": {
        const receipt = this.state.goodsReceipts.find((candidate) => candidate.documentId === document.id);
        if (!receipt) break;
        this.state.goodsReceiptLines = this.state.goodsReceiptLines.filter((line) => line.goodsReceiptId !== receipt.id);
        this.state.goodsReceipts = this.state.goodsReceipts.filter((candidate) => candidate.id !== receipt.id);
        break;
      }
      case "procurement_cost": {
        const cost = this.state.procurementCosts.find((candidate) => candidate.documentId === document.id);
        if (!cost) break;
        this.state.procurementCostLines = this.state.procurementCostLines.filter((line) => line.procurementCostId !== cost.id);
        this.state.procurementCosts = this.state.procurementCosts.filter((candidate) => candidate.id !== cost.id);
        break;
      }
      case "shortage_resolution": {
        const shortage = this.state.shortageResolutions.find((candidate) => candidate.documentId === document.id);
        if (!shortage) break;
        const shortageLineIds = new Set(this.state.shortageResolutionLines.filter((line) => line.shortageResolutionId === shortage.id).map((line) => line.id));
        this.state.supplierClaims = this.state.supplierClaims.filter((claim) => !shortageLineIds.has(claim.shortageResolutionLineId));
        this.state.shortageResolutionLines = this.state.shortageResolutionLines.filter((line) => line.shortageResolutionId !== shortage.id);
        this.state.shortageResolutions = this.state.shortageResolutions.filter((candidate) => candidate.id !== shortage.id);
        break;
      }
      case "stock_transfer": {
        const transfer = this.state.stockTransfers.find((candidate) => candidate.documentId === document.id);
        if (!transfer) break;
        this.state.stockTransferLines = this.state.stockTransferLines.filter((line) => line.stockTransferId !== transfer.id);
        this.state.stockTransfers = this.state.stockTransfers.filter((candidate) => candidate.id !== transfer.id);
        break;
      }
      case "sale": {
        const sale = this.state.sales.find((candidate) => candidate.documentId === document.id);
        if (!sale) break;
        if (this.state.salesReturns.some((candidate) => candidate.saleId === sale.id)) {
          throw new DomainError("sale_has_returns", "Нельзя удалить продажу, по которой уже есть возвраты");
        }
        this.state.saleLines = this.state.saleLines.filter((line) => line.saleId !== sale.id);
        this.state.sales = this.state.sales.filter((candidate) => candidate.id !== sale.id);
        break;
      }
      case "sales_return": {
        const salesReturn = this.state.salesReturns.find((candidate) => candidate.documentId === document.id);
        if (!salesReturn) break;
        this.state.salesReturns = this.state.salesReturns.filter((candidate) => candidate.id !== salesReturn.id);
        break;
      }
      case "channel_finance_event": {
        const event = this.state.channelFinanceEvents.find((candidate) => candidate.documentId === document.id);
        if (!event) break;
        this.state.channelFinanceEvents = this.state.channelFinanceEvents.filter((candidate) => candidate.id !== event.id);
        break;
      }
      case "payout": {
        const payout = this.state.payouts.find((candidate) => candidate.documentId === document.id);
        if (!payout) break;
        if (payout.paymentId) {
          const payment = this.mustFind(this.state.payments, payout.paymentId, "payment_not_found");
          const paymentDocument = this.mustFind(this.state.documents, payment.documentId, "document_not_found");
          if (paymentDocument.status !== "draft") {
            throw new DomainError("document_delete_not_allowed", "Удалять можно только черновики без проведённых последствий");
          }
          if (this.state.paymentAllocations.some((allocation) => allocation.paymentId === payment.id)) {
            throw new DomainError("payment_has_allocations", "Нельзя удалить платеж, который уже распределен по другим документам");
          }
          this.state.payments = this.state.payments.filter((candidate) => candidate.id !== payment.id);
          this.state.documentLines = this.state.documentLines.filter((line) => line.documentId !== payment.documentId);
          this.state.documentVersions = this.state.documentVersions.filter((version) => version.documentId !== payment.documentId);
          this.state.documents = this.state.documents.filter((candidate) => candidate.id !== payment.documentId);
        }
        this.state.payoutLines
          .filter((line) => line.payoutId === payout.id && line.sourceType === "finance_event" && line.sourceId)
          .forEach((line) => {
            const financeEvent = this.state.channelFinanceEvents.find((candidate) => candidate.id === line.sourceId);
            if (financeEvent?.payoutId === payout.id) financeEvent.payoutId = undefined;
          });
        if (payout.externalEventId) {
          const externalEvent = this.state.externalEvents.find((candidate) => candidate.id === payout.externalEventId);
          if (externalEvent?.materializedDocumentId === document.id) {
            externalEvent.materializedDocumentId = undefined;
            externalEvent.reason = undefined;
            externalEvent.lastError = undefined;
            externalEvent.status = "ignored";
            externalEvent.updatedAt = nowIso();
          }
        }
        this.state.payoutLines = this.state.payoutLines.filter((line) => line.payoutId !== payout.id);
        this.state.payouts = this.state.payouts.filter((candidate) => candidate.id !== payout.id);
        break;
      }
      case "stocktake": {
        const stocktake = this.state.stocktakes.find((candidate) => candidate.documentId === document.id);
        if (!stocktake) break;
        this.state.stocktakeLines = this.state.stocktakeLines.filter((line) => line.stocktakeId !== stocktake.id);
        this.state.stocktakes = this.state.stocktakes.filter((candidate) => candidate.id !== stocktake.id);
        break;
      }
      case "payment": {
        const payment = this.state.payments.find((candidate) => candidate.documentId === document.id);
        if (!payment) break;
        if (this.state.paymentAllocations.some((allocation) => allocation.paymentId === payment.id)) {
          throw new DomainError("payment_has_allocations", "Нельзя удалить платеж, который уже распределен по другим документам");
        }
        this.state.payments = this.state.payments.filter((candidate) => candidate.id !== payment.id);
        break;
      }
      default:
        break;
    }

    this.state.documentLines = this.state.documentLines.filter((line) => line.documentId !== document.id);
    this.state.documentVersions = this.state.documentVersions.filter((version) => version.documentId !== document.id);
    this.state.documents = this.state.documents.filter((candidate) => candidate.id !== document.id);
    this.audit("document", document.id, "delete", document, undefined, "Удаление черновика");
    return document;
  }

  applyDocumentCorrection(documentId: ID, patch: Record<string, unknown>, reason = "Исправление документа") {
    const document = this.mustFind(this.state.documents, documentId, "document_not_found");
    this.assertDocumentHasNoDescendants(document.id, "Нельзя изменить документ, пока от него зависят другие документы");
    const before = { ...document };
    const correction = this.createCorrectionCase(document.id, "open_period_edit", reason, { patch });
    this.state.documentVersions.push({
      id: id("doc_version"),
      documentId: document.id,
      versionNo: this.state.documentVersions.filter((version) => version.documentId === document.id).length + 1,
      snapshot: before,
      reason,
      createdAt: nowIso()
    });
    if (document.status === "draft") {
      if (typeof patch.title === "string") document.title = patch.title;
      if (typeof patch.comment === "string") document.comment = patch.comment;
      if (typeof patch.amountRub === "number") document.amountRub = patch.amountRub;
      correction.impactSummary = { ...correction.impactSummary, mode: "draft_patch" };
    } else {
      const correctionDocument = this.createDocument({
        documentType: "correction",
        accountingDate: document.accountingDate,
        title: `Исправление ${document.number}`,
        amountRub: typeof patch.amountRub === "number" ? Math.abs(patch.amountRub - document.amountRub) : 0,
        comment: reason
      });
      correction.impactSummary = { ...correction.impactSummary, correctionDocumentId: correctionDocument.id };
    }
    correction.status = "applied";
    correction.appliedAt = nowIso();
    this.audit("document", document.id, "correct", before, document, reason);
    this.queueRecalculation("reports", { documentId });
    return { correction, document };
  }

  createRecalculationJob(input: { jobType: "inventory_cost" | "sales_profit" | "settlements" | "reports" | "external_event_reprocess"; scope?: Record<string, unknown> }) {
    return this.queueRecalculation(input.jobType, input.scope ?? {});
  }

  retryRecalculationJob(jobId: ID) {
    const job = this.mustFind(this.state.recalculationJobs, jobId, "recalculation_job_not_found");
    job.status = "completed";
    job.progress = 100;
    job.finishedAt = nowIso();
    return job;
  }

  productDetails(productId: ID) {
    const product = this.mustFind(this.state.products, productId, "product_not_found");
    const movements = this.state.stockMovements.filter((movement) => movement.productId === product.id);
    const relatedDocumentIds = new Set<string>();
    this.state.inventoryLots
      .filter((lot) => lot.productId === product.id)
      .forEach((lot) => relatedDocumentIds.add(lot.sourceDocumentId));
    movements.forEach((movement) => relatedDocumentIds.add(movement.documentId));
    this.state.purchaseOrderLines
      .filter((line) => line.productId === product.id)
      .forEach((line) => {
        const order = this.state.purchaseOrders.find((candidate) => candidate.id === line.purchaseOrderId);
        if (order) relatedDocumentIds.add(order.documentId);
      });
    return {
      product,
      lots: this.state.inventoryLots.filter((lot) => lot.productId === product.id),
      stock: this.state.stockStates.filter((stock) => stock.productId === product.id),
      movements,
      documents: this.state.documents.filter((document) => relatedDocumentIds.has(document.id)),
      externalLinks: this.state.productExternalLinks.filter((link) => link.productId === product.id)
    };
  }

  setProductImage(productId: ID, imageUrl: string) {
    const product = this.mustFind(this.state.products, productId, "product_not_found");
    const before = { ...product };
    product.imageUrl = imageUrl;
    this.audit("product", product.id, "image_update", before, product);
    return { id: `${product.id}:main`, productId: product.id, url: imageUrl, sortOrder: 0 };
  }

  deleteProductImage(productId: ID) {
    const product = this.mustFind(this.state.products, productId, "product_not_found");
    const before = { ...product };
    product.imageUrl = undefined;
    this.audit("product", product.id, "image_delete", before, product);
    return product;
  }

  // --- Фотостудия: медиа товара (исходники + сгенерированные слайды) ---

  listProductAssets(productId: ID): ProductAsset[] {
    return this.state.productAssets
      .filter((asset) => asset.productId === productId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt));
  }

  createProductAsset(input: {
    productId: ID;
    role: ProductAssetRole;
    storageKey: string;
    url: string;
    slideType?: string;
    mimeType?: string;
    status?: ProductAssetStatus;
    createdBy?: "user" | "agent";
    sortOrder?: number;
    meta?: Record<string, unknown>;
  }): ProductAsset {
    const organizationId = this.currentOrgId();
    const product = this.mustFind(this.state.products, input.productId, "product_not_found");
    const existing = this.state.productAssets.filter((asset) => asset.productId === product.id);
    const sortOrder = input.sortOrder ?? existing.reduce((max, asset) => Math.max(max, asset.sortOrder + 1), 0);
    const asset: ProductAsset = {
      id: id("asset"),
      organizationId,
      productId: product.id,
      role: input.role,
      slideType: input.slideType,
      storageKey: input.storageKey,
      url: input.url,
      mimeType: input.mimeType,
      sortOrder,
      status: input.status ?? "pending",
      createdBy: input.createdBy ?? "user",
      createdAt: nowIso(),
      meta: input.meta
    };
    this.state.productAssets.push(asset);
    this.audit("product_asset", asset.id, "create", undefined, asset);
    return asset;
  }

  confirmProductAsset(
    assetId: ID,
    patch: { width?: number; height?: number; mimeType?: string } = {}
  ): ProductAsset {
    const asset = this.mustFind(this.state.productAssets, assetId, "product_asset_not_found");
    const before = { ...asset };
    asset.status = "ready";
    if (patch.width !== undefined) asset.width = patch.width;
    if (patch.height !== undefined) asset.height = patch.height;
    if (patch.mimeType) asset.mimeType = patch.mimeType;
    asset.updatedAt = nowIso();
    this.audit("product_asset", asset.id, "confirm", before, asset);
    return asset;
  }

  updateProductAsset(
    assetId: ID,
    patch: { role?: ProductAssetRole; status?: ProductAssetStatus; slideType?: string; sortOrder?: number; meta?: Record<string, unknown> }
  ): ProductAsset {
    const asset = this.mustFind(this.state.productAssets, assetId, "product_asset_not_found");
    const before = { ...asset };
    if (patch.role) asset.role = patch.role;
    if (patch.status) asset.status = patch.status;
    if (patch.slideType !== undefined) asset.slideType = patch.slideType;
    if (patch.sortOrder !== undefined) asset.sortOrder = patch.sortOrder;
    if (patch.meta) asset.meta = { ...(asset.meta ?? {}), ...patch.meta };
    asset.updatedAt = nowIso();
    this.audit("product_asset", asset.id, "update", before, asset);
    return asset;
  }

  deleteProductAsset(assetId: ID): { id: ID; deleted: true } {
    const asset = this.mustFind(this.state.productAssets, assetId, "product_asset_not_found");
    this.state.productAssets = this.state.productAssets.filter((candidate) => candidate.id !== asset.id);
    this.audit("product_asset", asset.id, "delete", asset, undefined);
    return { id: asset.id, deleted: true };
  }

  createCashAccount(input: { name: string; accountCode: "50" | "51"; openingBalanceRub?: number }): CashAccount {
    const organizationId = this.currentOrgId();
    const account: CashAccount = {
      id: id("cash"),
      organizationId,
      name: input.name,
      accountCode: input.accountCode,
      balanceRub: round2(input.openingBalanceRub ?? 0),
      isActive: true
    };
    this.state.cashAccounts.push(account);
    this.audit("cash_account", account.id, "create", undefined, account);
    return account;
  }

  updateCashAccount(accountId: ID, patch: Partial<Pick<CashAccount, "name" | "isActive">>): CashAccount {
    const account = this.mustFind(this.state.cashAccounts, accountId, "cash_account_not_found");
    const before = { ...account };
    if (patch.name !== undefined) account.name = patch.name;
    if (patch.isActive !== undefined) account.isActive = patch.isActive;
    this.audit("cash_account", account.id, "update", before, account);
    return account;
  }

  postOwnerContribution(paymentId: ID): Payment {
    const payment = this.mustFind(this.state.payments, paymentId, "payment_not_found");
    const document = this.mustFind(this.state.documents, payment.documentId, "document_not_found");
    if (document.status === "posted") return payment;
    if (payment.paymentType !== "owner_contribution") {
      throw new DomainError("payment_type_mismatch", "Это не пополнение владельцем");
    }
    this.postDocument(payment.documentId, [
      { accountCode: "51", debit: payment.amountRub, memo: "Поступление денег" },
      { accountCode: "80.01", credit: payment.amountRub, memo: "Вклад владельца" }
    ]);
    this.applyPaymentToCashAccount(payment);
    return payment;
  }

  postSupplierPayment(paymentId: ID): Payment {
    const payment = this.mustFind(this.state.payments, paymentId, "payment_not_found");
    const document = this.mustFind(this.state.documents, payment.documentId, "document_not_found");
    if (document.status === "posted") return payment;
    if (payment.paymentType !== "supplier_payment") {
      throw new DomainError("payment_type_mismatch", "Это не оплата поставщику");
    }
    const allocation = this.state.paymentAllocations.find((candidate) => candidate.paymentId === payment.id && candidate.allocationPurpose === "goods_purchase");
    if (!allocation?.purchaseOrderId) {
      throw new DomainError("payment_allocation_not_found", "Для платежа не найден связанный заказ поставщику");
    }
    const order = this.mustFind(this.state.purchaseOrders, allocation.purchaseOrderId, "purchase_order_not_found");
    this.postDocument(payment.documentId, [
      { accountCode: "60.02", debit: payment.amountRub, memo: "Аванс поставщику" },
      { accountCode: "51", credit: payment.amountRub, memo: "Оплата с расчетного счета" }
    ]);
    this.applyPaymentToCashAccount(payment);
    this.state.settlementEntries.push({
      id: id("settlement"),
      organizationId: this.currentOrgId(),
      counterpartyId: order.supplierId,
      documentId: payment.documentId,
      settlementType: "supplier_advance",
      debitRub: payment.amountRub,
      creditRub: 0,
      createdAt: nowIso()
    });
    this.ensureDocumentLink(payment.documentId, order.documentId, "payment");
    return payment;
  }

  postOwnerWithdrawal(paymentId: ID): Payment {
    const payment = this.mustFind(this.state.payments, paymentId, "payment_not_found");
    const document = this.mustFind(this.state.documents, payment.documentId, "document_not_found");
    if (document.status === "posted") return payment;
    if (payment.paymentType !== "owner_withdrawal") {
      throw new DomainError("payment_type_mismatch", "Это не изъятие владельца");
    }
    this.postDocument(payment.documentId, [
      { accountCode: "80.02", debit: payment.amountRub, memo: "Изъятие владельца" },
      { accountCode: "51", credit: payment.amountRub, memo: "Выплата владельцу" }
    ]);
    this.applyPaymentToCashAccount(payment);
    return payment;
  }

  purchaseOrderDetails(purchaseOrderId: ID) {
    const order = this.mustFind(this.state.purchaseOrders, purchaseOrderId, "purchase_order_not_found");
    return {
      order,
      document: this.state.documents.find((document) => document.id === order.documentId),
      lines: this.state.purchaseOrderLines.filter((line) => line.purchaseOrderId === order.id),
      payments: this.paymentsForPurchaseOrder(order.id),
      receipts: this.state.goodsReceipts.filter((receipt) => receipt.purchaseOrderId === order.id),
      costs: this.state.procurementCosts.filter((cost) => cost.purchaseOrderId === order.id),
      shortages: this.state.shortageResolutions.filter((resolution) => resolution.purchaseOrderId === order.id),
      links: this.state.documentLinks.filter((link) => link.fromDocumentId === order.documentId || link.toDocumentId === order.documentId)
    };
  }

  updatePurchaseOrderDraft(purchaseOrderId: ID, input: {
    supplierId?: ID;
    destinationWarehouseId?: ID;
    supplierCurrency?: PurchaseOrder["supplierCurrency"];
    orderedAt?: string;
    lines?: Array<{ productId: ID; qty: number; supplierUnitPrice: number; lineNote?: string }>;
    comment?: string;
  }): PurchaseOrder {
    const order = this.mustFind(this.state.purchaseOrders, purchaseOrderId, "purchase_order_not_found");
    if (this.paymentsForPurchaseOrder(order.id).length > 0 || this.state.goodsReceipts.some((receipt) => receipt.purchaseOrderId === order.id)) {
      throw new DomainError("purchase_order_not_editable", "Заказ с оплатами или приемками нельзя редактировать напрямую");
    }
    const document = this.mustFind(this.state.documents, order.documentId, "document_not_found");
    const before = this.purchaseOrderDetails(order.id);
    if (input.supplierId !== undefined) order.supplierId = input.supplierId;
    if (input.destinationWarehouseId !== undefined) order.destinationWarehouseId = input.destinationWarehouseId;
    if (input.supplierCurrency !== undefined) order.supplierCurrency = input.supplierCurrency;
    if (input.orderedAt !== undefined) {
      this.assertAccountingDateAllowed(input.orderedAt);
      order.orderedAt = input.orderedAt;
      document.accountingDate = input.orderedAt;
    }
    if (input.comment !== undefined) {
      order.comment = input.comment;
      document.comment = input.comment;
    }
    if (input.lines) {
      if (input.lines.length === 0) throw new DomainError("empty_order", "В заказе должна быть хотя бы одна строка");
      const existingLines = this.state.purchaseOrderLines
        .filter((line) => line.purchaseOrderId === order.id)
        .slice()
        .sort((left, right) => left.lineNo - right.lineNo);
      const existingDocumentLines = this.state.documentLines
        .filter((line) => line.documentId === document.id)
        .slice()
        .sort((left, right) => left.lineNo - right.lineNo);
      const nextPurchaseOrderLines: PurchaseOrderLine[] = [];
      const nextDocumentLines: DocumentLine[] = [];

      input.lines.forEach((line, index) => {
        assertPositive(line.qty, "Количество в заказе должно быть положительным");
        assertNonNegative(line.supplierUnitPrice, "Цена поставщика не может быть отрицательной");
        const existingLine = existingLines[index];
        const purchaseOrderLine: PurchaseOrderLine = {
          id: existingLine?.id ?? id("po_line"),
          purchaseOrderId: order.id,
          productId: line.productId,
          lineNo: index + 1,
          qtyOrdered: round4(line.qty),
          supplierUnitPrice: round6(line.supplierUnitPrice),
          supplierAmount: round2(line.qty * line.supplierUnitPrice),
          lineNote: line.lineNote
        };
        nextPurchaseOrderLines.push(purchaseOrderLine);

        const existingDocumentLine = existingDocumentLines[index];
        nextDocumentLines.push({
          id: existingDocumentLine?.id ?? id("doc_line"),
          documentId: document.id,
          lineNo: purchaseOrderLine.lineNo,
          lineType: "purchase_order_line",
          qty: purchaseOrderLine.qtyOrdered,
          payload: {
            purchaseOrderLineId: purchaseOrderLine.id,
            productId: purchaseOrderLine.productId,
            supplierAmount: purchaseOrderLine.supplierAmount
          }
        });
      });
      this.state.purchaseOrderLines = this.state.purchaseOrderLines
        .filter((line) => line.purchaseOrderId !== order.id)
        .concat(nextPurchaseOrderLines);
      this.state.documentLines = this.state.documentLines
        .filter((line) => line.documentId !== document.id)
        .concat(nextDocumentLines);
    }
    const lines = this.state.purchaseOrderLines.filter((line) => line.purchaseOrderId === order.id);
    order.totalSupplierAmount = round2(lines.reduce((sum, line) => sum + line.supplierAmount, 0));
    order.totalQty = round4(lines.reduce((sum, line) => sum + line.qtyOrdered, 0));
    this.state.documentVersions.push({
      id: id("doc_version"),
      documentId: document.id,
      versionNo: this.state.documentVersions.filter((version) => version.documentId === document.id).length + 1,
      snapshot: before,
      reason: "Редактирование заказа поставщику",
      createdAt: nowIso()
    });
    this.audit("purchase_order", order.id, "update", before.order, order);
    return order;
  }

  postPurchaseOrder(purchaseOrderId: ID): PurchaseOrder {
    const order = this.mustFind(this.state.purchaseOrders, purchaseOrderId, "purchase_order_not_found");
    const document = this.mustFind(this.state.documents, order.documentId, "document_not_found");
    this.assertAccountingDateAllowed(order.orderedAt);
    order.status = "ordered";
    document.status = "posted";
    document.postedAt = document.postedAt ?? nowIso();
    this.audit("document", document.id, "post", undefined, document, "Заказ не создает проводок");
    return order;
  }

  paymentsForPurchaseOrder(purchaseOrderId: ID) {
    const paymentIds = new Set(this.state.paymentAllocations.filter((allocation) => allocation.purchaseOrderId === purchaseOrderId).map((allocation) => allocation.paymentId));
    return this.state.payments.filter((payment) => paymentIds.has(payment.id));
  }

  receiptDetails(receiptId: ID) {
    const receipt = this.mustFind(this.state.goodsReceipts, receiptId, "receipt_not_found");
    return {
      receipt,
      document: this.state.documents.find((document) => document.id === receipt.documentId),
      lines: this.state.goodsReceiptLines.filter((line) => line.goodsReceiptId === receipt.id),
      lots: this.state.inventoryLots.filter((lot) => lot.sourceDocumentId === receipt.documentId)
    };
  }

  receiptDispatchContext(receiptId: ID, channelId?: ID) {
    const receipt = this.mustFind(this.state.goodsReceipts, receiptId, "receipt_not_found");
    const document = this.mustFind(this.state.documents, receipt.documentId, "document_not_found");
    if (receipt.status !== "posted" || document.status !== "posted") {
      throw new DomainError("receipt_not_posted", "Отправка в канал доступна только после проведения приемки");
    }
    const sourceWarehouse = this.mustFind(this.state.warehouses, receipt.warehouseId, "warehouse_not_found");
    const channels = this.state.salesChannels.filter((candidate) => candidate.channelType === "marketplace" && candidate.status !== "disabled");
    const channel = channelId ? this.mustFind(channels, channelId, "channel_not_found") : undefined;
    const salesPointWarehouse = channel
      ? this.state.warehouses.find((warehouse) => warehouse.id === channel.salesPointWarehouseId)
      : undefined;
    const lines = this.state.goodsReceiptLines
      .filter((line) => line.goodsReceiptId === receipt.id)
      .map((line) => {
        const product = this.mustFind(this.state.products, line.productId, "product_not_found");
        const alreadyDispatchedQty = this.dispatchedQtyForReceiptLine(line.id, channel?.id);
        const qtyAvailableToDispatch = this.remainingQtyForReceiptLine(line.id, receipt.warehouseId, "sellable");
        const externalLinks = channel
          ? this.state.productExternalLinks.filter((link) => link.productId === line.productId && link.channelId === channel.id && link.status === "active")
          : [];
        const externalProducts = externalLinks
          .map((link) => this.state.externalProducts.find((candidate) => candidate.id === link.externalProductId))
          .filter(Boolean);
        return {
          goodsReceiptLineId: line.id,
          purchaseOrderLineId: line.purchaseOrderLineId,
          productId: line.productId,
          productSku: product.sku,
          productName: product.name,
          qtyReceived: line.qtyReceived,
          qtyAvailableToDispatch,
          qtyAlreadyDispatched: alreadyDispatchedQty,
          unitCostRub: line.unitCostRub,
          allocatedGoodsCostRub: line.allocatedGoodsCostRub,
          weightGrams: product.weightGrams,
          lengthMm: product.lengthMm,
          widthMm: product.widthMm,
          heightMm: product.heightMm,
          externalOfferIds: externalProducts.map((candidate) => String(candidate?.externalSku ?? "")).filter(Boolean)
        };
      });
    return {
      receipt,
      document,
      sourceWarehouse,
      channel,
      salesPointWarehouse,
      channels,
      lines
    };
  }

  postPayment(paymentId: ID): Payment {
    const payment = this.mustFind(this.state.payments, paymentId, "payment_not_found");
    if (this.isDocumentPosted(payment.documentId)) return payment;
    switch (payment.paymentType) {
      case "owner_contribution":
        return this.postOwnerContribution(payment.id);
      case "supplier_payment":
        return this.postSupplierPayment(payment.id);
      case "channel_payout": {
        const payout = this.state.payouts.find((candidate) => candidate.paymentId === payment.id);
        if (!payout) {
          throw new DomainError("payout_not_found", "Для платежа не найдена выплата канала");
        }
        this.postChannelPayout(payout.id);
        return payment;
      }
      case "owner_withdrawal":
        return this.postOwnerWithdrawal(payment.id);
      default:
        throw new DomainError("payment_post_not_supported", "Для этого типа платежа нет отдельного проведения");
    }
  }

  postGoodsReceipt(receiptId: ID): GoodsReceipt {
    const receipt = this.mustFind(this.state.goodsReceipts, receiptId, "receipt_not_found");
    const document = this.mustFind(this.state.documents, receipt.documentId, "document_not_found");
    if (document.status === "posted" && receipt.status === "posted") return receipt;
    if (document.status === "cancelled") {
      throw new DomainError("document_cancelled", "Отмененную приемку нельзя провести повторно");
    }
    const order = this.mustFind(this.state.purchaseOrders, receipt.purchaseOrderId, "purchase_order_not_found");
    const receiptLines = this.state.goodsReceiptLines.filter((line) => line.goodsReceiptId === receipt.id);
    const documentLines = this.state.documentLines.filter((line) => line.documentId === document.id);

    receiptLines.forEach((receiptLine) => {
      const existingLine = documentLines.find((line) => (line.payload as Record<string, unknown>)?.receiptLineId === receiptLine.id);
      const lot = this.createLot({
        productId: receiptLine.productId,
        warehouseId: receipt.warehouseId,
        documentId: document.id,
        sourceLineId: receiptLine.id,
        qty: receiptLine.qtyReceived,
        costRub: receiptLine.allocatedGoodsCostRub,
        date: receipt.receiptDate,
        movementType: "receipt"
      });
      if (existingLine) {
        existingLine.payload = { ...(existingLine.payload ?? {}), lotId: lot.id };
      }
    });

    const setoff = round2(Math.min(receipt.goodsCostRubTotal, this.supplierAdvanceBalance(order.id)));
    const journalLines: JournalLineInput[] = [
      { accountCode: "41.01", debit: receipt.goodsCostRubTotal, memo: "Поступление товара на склад" },
      { accountCode: "60.01", credit: receipt.goodsCostRubTotal, memo: "Задолженность поставщику по приемке" }
    ];
    if (setoff > 0) {
      journalLines.push(
        { accountCode: "60.01", debit: setoff, memo: "Зачет аванса поставщику" },
        { accountCode: "60.02", credit: setoff, memo: "Зачет аванса поставщику" }
      );
    }
    this.postDocument(document.id, journalLines);
    this.ensureDocumentLink(order.documentId, document.id, "receipt");
    this.state.settlementEntries.push({
      id: id("settlement"),
      organizationId: this.currentOrgId(),
      counterpartyId: order.supplierId,
      documentId: document.id,
      settlementType: "supplier_payable",
      debitRub: 0,
      creditRub: receipt.goodsCostRubTotal,
      createdAt: nowIso()
    });
    if (setoff > 0) {
      this.state.settlementEntries.push({
        id: id("settlement"),
        organizationId: this.currentOrgId(),
        counterpartyId: order.supplierId,
        documentId: document.id,
        settlementType: "supplier_advance",
        debitRub: 0,
        creditRub: setoff,
        createdAt: nowIso()
      });
    }
    // Распределяем расходы закупки, добавленные до этой приёмки («товары в пути»), на новые партии.
    this.capitalizePendingProcurementCosts(order.id);
    receipt.status = "posted";
    return receipt;
  }

  procurementCostDetails(costId: ID) {
    const cost = this.mustFind(this.state.procurementCosts, costId, "procurement_cost_not_found");
    return {
      cost,
      document: this.state.documents.find((document) => document.id === cost.documentId),
      lines: this.state.procurementCostLines.filter((line) => line.procurementCostId === cost.id)
    };
  }

  postProcurementCost(costId: ID): ProcurementCost {
    const cost = this.mustFind(this.state.procurementCosts, costId, "procurement_cost_not_found");
    const document = this.mustFind(this.state.documents, cost.documentId, "document_not_found");
    if (document.status === "posted" && cost.status === "posted") return cost;
    if (document.status === "cancelled") {
      throw new DomainError("document_cancelled", "Отмененный расход закупки нельзя провести повторно");
    }
    if (cost.pendingAllocation) {
      // Расход до приёмки: деньги ушли, сумма висит в 41.02 «Товары в пути» до распределения на партии при приёмке.
      const creditAccount = cost.paidImmediately ? "51" : "60.01";
      this.postDocument(document.id, [
        { accountCode: "41.02", debit: cost.amountRub, memo: "Расход закупки (товары в пути)" },
        { accountCode: creditAccount, credit: cost.amountRub, memo: cost.paidImmediately ? "Оплачен расход закупки" : "Задолженность за расход закупки" }
      ]);
      this.ensurePaidProcurementCostPayment(cost, document);
      if (cost.purchaseOrderId) {
        const order = this.mustFind(this.state.purchaseOrders, cost.purchaseOrderId, "purchase_order_not_found");
        this.ensureDocumentLink(order.documentId, document.id, "procurement_cost");
      }
      cost.status = "posted";
      return cost;
    }
    const previewLines = this.state.procurementCostLines.filter((line) => line.procurementCostId === cost.id);
    previewLines.forEach((line) => {
      const lot = line.lotId ? this.mustFind(this.state.inventoryLots, line.lotId, "lot_not_found") : undefined;
      if (!lot) return;
      lot.costInitialRub = round2(lot.costInitialRub + line.allocatedAmountRub);
      if (line.remainingInventoryAmountRub > 0 && lot.qtyRemaining > 0) {
        lot.costRemainingRub = round2(lot.costRemainingRub + line.remainingInventoryAmountRub);
        lot.unitCostRub = round6(lot.costRemainingRub / lot.qtyRemaining);
        this.addStockState(lot.productId, lot.warehouseId, 0, line.remainingInventoryAmountRub);
      }
    });

    const creditAccount = cost.paidImmediately ? "51" : "60.01";
    const journalLines: JournalLineInput[] = [];
    const remainingByAccount = new Map<string, number>();
    previewLines.forEach((line) => {
      if (!line.warehouseId || line.remainingInventoryAmountRub <= 0) return;
      const warehouse = this.mustFind(this.state.warehouses, line.warehouseId, "warehouse_not_found");
      const accountCode = accountForWarehouse(warehouse);
      remainingByAccount.set(accountCode, round2((remainingByAccount.get(accountCode) ?? 0) + line.remainingInventoryAmountRub));
    });
    remainingByAccount.forEach((amount, accountCode) => {
      if (amount > 0) journalLines.push({ accountCode, debit: amount, memo: "Дополнительный расход в остатках" });
    });
    const soldCostAmountRub = round2(previewLines.reduce((sum, line) => sum + (line.soldCostAmountRub ?? 0), 0));
    if (soldCostAmountRub > 0) {
      journalLines.push({ accountCode: "90.02", debit: soldCostAmountRub, memo: "Дополнительный расход по проданным товарам" });
    }
    journalLines.push({
      accountCode: creditAccount,
      credit: cost.amountRub,
      memo: cost.paidImmediately ? "Оплачен расход закупки" : "Задолженность за расход закупки"
    });
    this.postDocument(document.id, journalLines);

    this.ensurePaidProcurementCostPayment(cost, document);
    if (cost.purchaseOrderId) {
      const order = this.mustFind(this.state.purchaseOrders, cost.purchaseOrderId, "purchase_order_not_found");
      this.ensureDocumentLink(order.documentId, document.id, "procurement_cost");
    }
    cost.status = "posted";
    return cost;
  }

  private ensurePaidProcurementCostPayment(cost: ProcurementCost, document: Document) {
    if (!cost.paidImmediately) return;
    let payment = this.state.payments.find((candidate) => candidate.documentId === document.id && candidate.paymentType === "procurement_cost_payment");
    if (!payment) {
      const cashAccount = this.state.cashAccounts.find((account) => account.accountCode === "51" && account.isActive);
      if (!cashAccount) throw new DomainError("cash_account_not_found", "Не найден расчетный счет");
      payment = {
        id: id("payment"),
        organizationId: this.currentOrgId(),
        documentId: document.id,
        cashAccountId: cashAccount.id,
        paymentDirection: "outgoing",
        paymentType: "procurement_cost_payment",
        amountRub: cost.amountRub,
        paidAt: cost.costDate,
        comment: cost.comment
      };
      this.state.payments.push(payment);
      this.state.paymentAllocations.push({
        id: id("payment_alloc"),
        paymentId: payment.id,
        allocationPurpose: "procurement_cost",
        documentId: document.id,
        purchaseOrderId: cost.purchaseOrderId,
        amountRub: cost.amountRub
      });
    }
    this.applyPaymentToCashAccount(payment);
  }

  // Распределяет «висящие» расходы заказа (41.02) на партии новой приёмки: Дт 41.0x / Кт 41.02.
  private capitalizePendingProcurementCosts(purchaseOrderId: ID) {
    const pending = this.state.procurementCosts.filter((cost) => cost.purchaseOrderId === purchaseOrderId && cost.pendingAllocation && cost.status !== "cancelled");
    for (const cost of pending) {
      // Если расход нельзя распределить (например «по весу» без заполненного веса товара) —
      // не блокируем приёмку: расход остаётся «в пути», его можно распределить позже.
      try {
      if (this.procurementCostTargets(purchaseOrderId, cost.allocationBasis).length === 0) continue;
      const document = this.mustFind(this.state.documents, cost.documentId, "document_not_found");
      const preview = this.previewProcurementCost({ purchaseOrderId, allocationBasis: cost.allocationBasis, amountRub: cost.amountRub });
      this.buildProcurementCostLines(cost, document, preview);
      const remainingByAccount = new Map<string, number>();
      preview.lines.forEach((line) => {
        const lot = line.lotId ? this.state.inventoryLots.find((candidate) => candidate.id === line.lotId) : undefined;
        if (lot) {
          lot.costInitialRub = round2(lot.costInitialRub + line.allocatedAmountRub);
          if (line.remainingInventoryAmountRub > 0 && lot.qtyRemaining > 0) {
            lot.costRemainingRub = round2(lot.costRemainingRub + line.remainingInventoryAmountRub);
            lot.unitCostRub = round6(lot.costRemainingRub / lot.qtyRemaining);
            this.addStockState(lot.productId, lot.warehouseId, 0, line.remainingInventoryAmountRub);
          }
        }
        if (line.warehouseId && line.remainingInventoryAmountRub > 0) {
          const warehouse = this.mustFind(this.state.warehouses, line.warehouseId, "warehouse_not_found");
          const accountCode = accountForWarehouse(warehouse);
          remainingByAccount.set(accountCode, round2((remainingByAccount.get(accountCode) ?? 0) + line.remainingInventoryAmountRub));
        }
      });
      const journalLines: JournalLineInput[] = [];
      remainingByAccount.forEach((amount, accountCode) => {
        if (amount > 0) journalLines.push({ accountCode, debit: amount, memo: "Капитализация расхода закупки" });
      });
      const soldCostAmountRub = round2(preview.lines.reduce((sum, line) => sum + (line.soldCostAmountRub ?? 0), 0));
      if (soldCostAmountRub > 0) {
        journalLines.push({ accountCode: "90.02", debit: soldCostAmountRub, memo: "Расход закупки по проданным товарам" });
      }
      journalLines.push({ accountCode: "41.02", credit: cost.amountRub, memo: "Списание товаров в пути" });
      this.appendJournalEntry(document, journalLines);
      cost.pendingAllocation = undefined;
      } catch {
        // Расход остаётся «в пути» — пользователь дозаполнит данные (вес) или сменит базу распределения.
      }
    }
  }

  // Добавляет дополнительную проводку к уже проведённому документу, не меняя его статус.
  private appendJournalEntry(document: Document, lines: JournalLineInput[]) {
    const debit = round2(lines.reduce((sum, line) => sum + (line.debit ?? 0), 0));
    const credit = round2(lines.reduce((sum, line) => sum + (line.credit ?? 0), 0));
    if (debit !== credit) {
      throw new DomainError("unbalanced_journal_entry", "Проводка не сбалансирована", { debit, credit, lines });
    }
    lines.forEach((line) => {
      if (!this.state.chartAccounts.some((account) => account.code === line.accountCode)) {
        throw new DomainError("unknown_account", `Неизвестный счет ${line.accountCode}`);
      }
    });
    const entry = {
      id: id("je"),
      organizationId: this.currentOrgId(),
      documentId: document.id,
      accountingDate: document.accountingDate,
      memo: document.title,
      createdAt: nowIso()
    };
    this.state.journalEntries.push(entry);
    lines.forEach((line) => {
      this.state.journalLines.push({
        id: id("jl"),
        journalEntryId: entry.id,
        accountCode: line.accountCode,
        debit: round2(line.debit ?? 0),
        credit: round2(line.credit ?? 0),
        memo: line.memo ?? document.title
      });
    });
    return entry;
  }

  shortagePreview(purchaseOrderId: ID) {
    const order = this.mustFind(this.state.purchaseOrders, purchaseOrderId, "purchase_order_not_found");
    const lines = this.state.purchaseOrderLines.filter((line) => line.purchaseOrderId === order.id).map((line) => {
      const qtyReceived = this.receivedQtyForLine(line.id);
      const qtyShortage = this.openShortageQtyForLine(order.id, line.id);
      return {
        purchaseOrderLineId: line.id,
        productId: line.productId,
        qtyOrdered: line.qtyOrdered,
        qtyReceived,
        qtyShortage,
        paidShareRub: this.paidShareForOrderLine(order.id, line, qtyShortage)
      };
    }).filter((line) => line.qtyShortage > 0);
    return { purchaseOrderId: order.id, lines };
  }

  shortageDetails(shortageId: ID) {
    const shortage = this.mustFind(this.state.shortageResolutions, shortageId, "shortage_not_found");
    return {
      shortage,
      document: this.state.documents.find((document) => document.id === shortage.documentId),
      lines: this.state.shortageResolutionLines.filter((line) => line.shortageResolutionId === shortage.id),
      claims: this.state.supplierClaims.filter((claim) => this.state.shortageResolutionLines.some((line) => line.shortageResolutionId === shortage.id && line.id === claim.shortageResolutionLineId))
    };
  }

  postShortage(shortageId: ID) {
    const shortage = this.mustFind(this.state.shortageResolutions, shortageId, "shortage_not_found");
    const document = this.mustFind(this.state.documents, shortage.documentId, "document_not_found");
    if (document.status === "posted" && shortage.status === "posted") return shortage;
    if (document.status === "cancelled") {
      throw new DomainError("document_cancelled", "Отмененное решение по недопоставке нельзя провести повторно");
    }
    const order = this.mustFind(this.state.purchaseOrders, shortage.purchaseOrderId, "purchase_order_not_found");
    const shortageLines = this.state.shortageResolutionLines.filter((line) => line.shortageResolutionId === shortage.id);
    const journalLines: JournalLineInput[] = [];
    shortageLines.forEach((line) => {
      if (line.action === "supplier_claim" && line.paidShareRub > 0) {
        journalLines.push(
          { accountCode: "76.02", debit: line.paidShareRub, memo: "Претензия поставщику" },
          { accountCode: "60.02", credit: line.paidShareRub, memo: "Закрытие аванса по недопоставке" }
        );
        const claimExists = this.state.supplierClaims.some((claim) => claim.shortageResolutionLineId === line.id);
        if (!claimExists) {
          this.state.supplierClaims.push({
            id: id("claim"),
            organizationId: this.currentOrgId(),
            shortageResolutionLineId: line.id,
            supplierId: order.supplierId,
            amountRub: line.paidShareRub,
            status: "open"
          });
        }
      }
      if (line.action === "loss" && line.paidShareRub > 0) {
        journalLines.push(
          { accountCode: "91.02", debit: line.paidShareRub, memo: "Списание недопоставки в убыток" },
          { accountCode: "60.02", credit: line.paidShareRub, memo: "Закрытие аванса по недопоставке" }
        );
      }
    });
    if (journalLines.length > 0) {
      this.postDocument(document.id, journalLines);
    } else {
      document.status = "posted";
      document.postedAt = nowIso();
      this.audit("document", document.id, "post", undefined, document, "Решение по недопоставке без проводок");
    }
    this.ensureDocumentLink(order.documentId, document.id, "shortage");
    shortage.status = "posted";
    return shortage;
  }

  transferDetails(transferId: ID) {
    const transfer = this.mustFind(this.state.stockTransfers, transferId, "transfer_not_found");
    return {
      transfer,
      document: this.state.documents.find((document) => document.id === transfer.documentId),
      lines: this.state.stockTransferLines.filter((line) => line.stockTransferId === transfer.id)
    };
  }

  postStockTransfer(transferId: ID): StockTransfer {
    const transfer = this.mustFind(this.state.stockTransfers, transferId, "transfer_not_found");
    const document = this.mustFind(this.state.documents, transfer.documentId, "document_not_found");
    if (document.status === "posted" && transfer.status === "posted") return transfer;
    if (document.status === "cancelled") {
      throw new DomainError("document_cancelled", "Отмененное перемещение нельзя провести повторно");
    }
    const transferLines = this.state.stockTransferLines.filter((line) => line.stockTransferId === transfer.id);
    let totalCost = 0;
    transferLines.forEach((line) => {
      const applications = this.consumeFifo({
        productId: line.productId,
        warehouseId: transfer.fromWarehouseId,
        stateCode: transfer.fromStockStateCode ?? "sellable",
        qty: line.qty,
        documentId: document.id,
        occurredAt: transfer.transferDate,
        applicationType: "transfer",
        movementType: "transfer_out"
      });
      const costRub = round2(applications.reduce((sum, application) => sum + application.costRub, 0));
      totalCost = round2(totalCost + costRub);
      line.costRub = costRub;
      const lot = this.createLot({
        productId: line.productId,
        warehouseId: transfer.toWarehouseId,
        stateCode: transfer.toStockStateCode ?? "sellable",
        documentId: document.id,
        sourceLineId: line.id,
        qty: line.qty,
        costRub,
        date: transfer.transferDate,
        movementType: "transfer_in"
      });
      const documentLine = this.state.documentLines.find((candidate) =>
        candidate.documentId === document.id &&
        candidate.lineType === "stock_transfer_line" &&
        (candidate.payload as Record<string, unknown>)?.productId === line.productId &&
        Number(candidate.qty ?? 0) === Number(line.qty)
      );
      if (documentLine) {
        documentLine.amountRub = costRub;
        documentLine.payload = { ...(documentLine.payload ?? {}), transferLineId: line.id, lotId: lot.id };
      }
    });
    document.amountRub = totalCost;
    const fromAccount = accountForWarehouse(this.mustFind(this.state.warehouses, transfer.fromWarehouseId, "warehouse_not_found"));
    const toAccount = accountForWarehouse(this.mustFind(this.state.warehouses, transfer.toWarehouseId, "warehouse_not_found"));
    if (fromAccount === toAccount) {
      document.status = "posted";
      document.postedAt = nowIso();
      this.audit("document", document.id, "post", undefined, document, "Перемещение внутри одного субсчета");
    } else {
      this.postDocument(document.id, [
        { accountCode: toAccount, debit: totalCost, memo: "Перемещение товара: приход" },
        { accountCode: fromAccount, credit: totalCost, memo: "Перемещение товара: расход" }
      ]);
    }
    transfer.status = "posted";
    return transfer;
  }

  stockForSalesPoint(warehouseId: ID) {
    const warehouse = this.mustFind(this.state.warehouses, warehouseId, "warehouse_not_found");
    if (warehouse.warehouseType !== "sales_point") {
      throw new DomainError("warehouse_not_sales_point", "Склад не является точкой продаж");
    }
    const stock = this.state.stockStates
      .filter((candidate) => candidate.warehouseId === warehouse.id)
      .map((candidate) => ({ ...candidate, product: this.state.products.find((product) => product.id === candidate.productId), warehouse }));
    const transferDocumentIds = new Set(
      this.state.stockTransfers
        .filter((transfer) => transfer.toWarehouseId === warehouse.id || transfer.fromWarehouseId === warehouse.id)
        .map((transfer) => transfer.documentId)
    );
    return {
      warehouse,
      stock,
      lots: this.state.inventoryLots.filter((lot) => lot.warehouseId === warehouse.id),
      recentDocuments: this.state.documents
        .filter((document) => transferDocumentIds.has(document.id))
        .slice()
        .sort((left, right) => String(right.accountingDate).localeCompare(String(left.accountingDate)))
        .slice(0, 12)
    };
  }

  reports() {
    const balances = this.ledgerBalances();
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
    const inventory = this.state.stockStates.map((stock) => ({
      ...stock,
      product: this.state.products.find((product) => product.id === stock.productId),
      warehouse: this.state.warehouses.find((warehouse) => warehouse.id === stock.warehouseId)
    }));
    return {
      trialBalance: this.state.chartAccounts.map((account) => ({
        account,
        debit: balances[account.code]?.debit ?? 0,
        credit: balances[account.code]?.credit ?? 0,
        balance: round2((balances[account.code]?.debit ?? 0) - (balances[account.code]?.credit ?? 0))
      })),
      pnl,
      balanceSheet: {
        assets: debitBalance(balances["41.01"]) + debitBalance(balances["41.02"]) + debitBalance(balances["41.03"]) + debitBalance(balances[MARKETPLACE_SHIPPED_ACCOUNT_CODE]) + debitBalance(balances["50"]) + debitBalance(balances["51"]) + debitBalance(balances["76.02"]) + debitBalance(balances["76.ТП"]),
        liabilities: creditBalance(balances["60.01"]) + creditBalance(balances["60.02"]) + creditBalance(balances["76.ТП"]),
        equity: creditBalance(balances["80.01"]) - debitBalance(balances["80.02"]) + pnl.netProfit
      },
      cashFlow: {
        cashBalance: debitBalance(balances["51"]) + debitBalance(balances["50"]),
        incoming: this.state.payments.filter((payment) => payment.paymentDirection === "incoming").reduce((sum, payment) => sum + payment.amountRub, 0),
        outgoing: this.state.payments.filter((payment) => payment.paymentDirection === "outgoing").reduce((sum, payment) => sum + payment.amountRub, 0)
      },
      inventory,
      unitEconomics: this.state.saleLines.map((line) => ({
        saleLine: line,
        product: this.state.products.find((product) => product.id === line.productId),
        grossMarginRub: round2(line.revenueRub - line.costRub),
        grossMarginPercent: line.revenueRub > 0 ? round2(((line.revenueRub - line.costRub) / line.revenueRub) * 100) : 0
      }))
    };
  }

  ledgerBalances() {
    return this.state.journalLines.reduce<Record<string, { debit: number; credit: number }>>((acc, line) => {
      const current = acc[line.accountCode] ?? { debit: 0, credit: 0 };
      current.debit = round2(current.debit + line.debit);
      current.credit = round2(current.credit + line.credit);
      acc[line.accountCode] = current;
      return acc;
    }, {});
  }

  stockByProduct() {
    return this.state.stockStates.map((state) => ({
      ...state,
      product: this.state.products.find((product) => product.id === state.productId),
      warehouse: this.state.warehouses.find((warehouse) => warehouse.id === state.warehouseId)
    }));
  }

  private createDocument(input: {
    documentType: string;
    accountingDate: string;
    title: string;
    amountRub: number;
    source?: Document["source"];
    comment?: string;
  }): Document {
    this.ensureBootstrapped();
    const registry = this.state.documentTypes.find((type) => type.code === input.documentType);
    if (!registry) {
      throw new DomainError("unknown_document_type", `Неизвестный тип документа: ${input.documentType}`);
    }
    this.assertAccountingDateAllowed(input.accountingDate);
    const document: Document = {
      id: id("doc"),
      organizationId: this.currentOrgId(),
      documentType: input.documentType,
      number: this.nextDocumentNumber(input.documentType),
      status: "draft",
      accountingDate: input.accountingDate,
      source: input.source ?? "manual",
      amountRub: input.amountRub,
      title: input.title,
      comment: input.comment,
      createdAt: nowIso()
    };
    this.state.documents.push(document);
    this.audit("document", document.id, "create", undefined, document);
    return document;
  }

  private createPayment(input: {
    paymentDirection: Payment["paymentDirection"];
    paymentType: Payment["paymentType"];
    amountRub: number;
    paidAt: string;
    title: string;
    counterpartyId?: ID;
    cashAccountId?: ID;
    comment?: string;
  }): Payment {
    assertPositive(input.amountRub, "Сумма платежа должна быть положительной");
    const cashAccount = input.cashAccountId
      ? this.mustFind(this.state.cashAccounts, input.cashAccountId, "cash_account_not_found")
      : this.state.cashAccounts.find((account) => account.accountCode === "51" && account.isActive);
    if (!cashAccount) throw new DomainError("cash_account_not_found", "Не найден расчетный счет");
    const document = this.createDocument({
      documentType: "payment",
      accountingDate: input.paidAt,
      title: input.title,
      amountRub: input.amountRub,
      comment: input.comment
    });
    const payment: Payment = {
      id: id("payment"),
      organizationId: this.currentOrgId(),
      documentId: document.id,
      cashAccountId: cashAccount.id,
      paymentDirection: input.paymentDirection,
      paymentType: input.paymentType,
      counterpartyId: input.counterpartyId,
      paidAt: input.paidAt,
      amountRub: input.amountRub,
      comment: input.comment
    };
    this.state.payments.push(payment);
    return payment;
  }

  private postDocument(documentId: ID, lines: JournalLineInput[]) {
    const document = this.mustFind(this.state.documents, documentId, "document_not_found");
    if (document.status === "posted") {
      return this.state.journalEntries.find((entry) => entry.documentId === documentId);
    }
    const debit = round2(lines.reduce((sum, line) => sum + (line.debit ?? 0), 0));
    const credit = round2(lines.reduce((sum, line) => sum + (line.credit ?? 0), 0));
    if (debit !== credit) {
      throw new DomainError("unbalanced_journal_entry", "Проводка не сбалансирована", { debit, credit, lines });
    }
    lines.forEach((line) => {
      if (!this.state.chartAccounts.some((account) => account.code === line.accountCode)) {
        throw new DomainError("unknown_account", `Неизвестный счет ${line.accountCode}`);
      }
    });
    const entry = {
      id: id("je"),
      organizationId: this.currentOrgId(),
      documentId,
      accountingDate: document.accountingDate,
      memo: document.title,
      createdAt: nowIso()
    };
    this.state.journalEntries.push(entry);
    lines.forEach((line) => {
      this.state.journalLines.push({
        id: id("jl"),
        journalEntryId: entry.id,
        accountCode: line.accountCode,
        debit: round2(line.debit ?? 0),
        credit: round2(line.credit ?? 0),
        memo: line.memo ?? document.title
      });
    });
    document.status = "posted";
    document.postedAt = nowIso();
    this.audit("document", document.id, "post", undefined, document);
    return entry;
  }

  private createLot(input: {
    productId: ID;
    warehouseId: ID;
    stateCode?: string;
    documentId: ID;
    sourceLineId?: ID;
    qty: number;
    costRub: number;
    date: string;
    movementType: StockMovement["movementType"];
  }): InventoryLot {
    assertPositive(input.qty, "Количество партии должно быть положительным");
    assertNonNegative(input.costRub, "Стоимость партии не может быть отрицательной");
    const lot: InventoryLot = {
      id: id("lot"),
      organizationId: this.currentOrgId(),
      productId: input.productId,
      warehouseId: input.warehouseId,
      stockStateCode: input.stateCode ?? "sellable",
      sourceDocumentId: input.documentId,
      sourceLineId: input.sourceLineId,
      receivedAt: input.date,
      qtyInitial: round4(input.qty),
      qtyRemaining: round4(input.qty),
      costInitialRub: round2(input.costRub),
      costRemainingRub: round2(input.costRub),
      unitCostRub: round6(input.costRub / input.qty),
      status: "open"
    };
    this.state.inventoryLots.push(lot);
    this.addStockState(input.productId, input.warehouseId, input.qty, input.costRub, input.stateCode);
    this.state.stockMovements.push({
      id: id("stock_move"),
      organizationId: this.currentOrgId(),
      productId: input.productId,
      warehouseId: input.warehouseId,
      stockStateCode: input.stateCode ?? "sellable",
      documentId: input.documentId,
      movementType: input.movementType,
      qty: round4(input.qty),
      costRub: round2(input.costRub),
      occurredAt: input.date,
      lotId: lot.id
    });
    return lot;
  }

  private consumeFifo(input: {
    productId: ID;
    warehouseId: ID;
    stateCode?: string;
    qty: number;
    documentId: ID;
    occurredAt: string;
    applicationType: CostApplication["applicationType"];
    movementType: StockMovement["movementType"];
  }): CostApplication[] {
    assertPositive(input.qty, "Количество списания должно быть положительным");
    let remainingQty = round4(input.qty);
    const lots = this.state.inventoryLots
      .filter((lot) =>
        lot.productId === input.productId &&
        lot.warehouseId === input.warehouseId &&
        (lot.stockStateCode ?? "sellable") === (input.stateCode ?? "sellable") &&
        lot.qtyRemaining > 0
      )
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    const availableQty = round4(lots.reduce((sum, lot) => sum + lot.qtyRemaining, 0));
    if (availableQty + 0.0001 < input.qty) {
      throw new DomainError("insufficient_stock", "Недостаточно товара для операции", { input, availableQty });
    }
    const applications: CostApplication[] = [];
    for (const lot of lots) {
      if (remainingQty <= 0) break;
      const qty = round4(Math.min(remainingQty, lot.qtyRemaining));
      const costRub = round2(lot.unitCostRub * qty);
      lot.qtyRemaining = round4(lot.qtyRemaining - qty);
      lot.costRemainingRub = round2(lot.costRemainingRub - costRub);
      if (lot.qtyRemaining <= 0.0001) {
        lot.qtyRemaining = 0;
        lot.costRemainingRub = 0;
        lot.status = "depleted";
      }
      this.addStockState(input.productId, input.warehouseId, -qty, -costRub, lot.stockStateCode);
      const application: CostApplication = {
        id: id("cost_app"),
        organizationId: this.currentOrgId(),
        sourceDocumentId: lot.sourceDocumentId,
        outboundDocumentId: input.documentId,
        productId: input.productId,
        fromLotId: lot.id,
        qty,
        costRub,
        applicationType: input.applicationType,
        createdAt: nowIso()
      };
      this.state.costApplications.push(application);
      this.state.stockMovements.push({
        id: id("stock_move"),
        organizationId: this.currentOrgId(),
        productId: input.productId,
        warehouseId: input.warehouseId,
        stockStateCode: lot.stockStateCode ?? "sellable",
        documentId: input.documentId,
        movementType: input.movementType,
        qty: -qty,
        costRub: -costRub,
        occurredAt: input.occurredAt,
        lotId: lot.id
      });
      applications.push(application);
      remainingQty = round4(remainingQty - qty);
    }
    return applications;
  }

  private addStockState(productId: ID, warehouseId: ID, qtyDelta: number, costDelta: number, stateCode = "sellable"): StockState {
    let state = this.state.stockStates.find((candidate) =>
      candidate.productId === productId &&
      candidate.warehouseId === warehouseId &&
      (candidate.stateCode ?? "sellable") === stateCode
    );
    if (!state) {
      state = { productId, warehouseId, stateCode, qty: 0, costRub: 0 };
      this.state.stockStates.push(state);
    }
    state.qty = round4(state.qty + qtyDelta);
    state.costRub = round2(state.costRub + costDelta);
    return state;
  }

  private stockState(productId: ID, warehouseId: ID, stateCode = "sellable"): StockState {
    return this.state.stockStates.find((candidate) =>
      candidate.productId === productId &&
      candidate.warehouseId === warehouseId &&
      (candidate.stateCode ?? "sellable") === stateCode
    ) ?? {
      productId,
      warehouseId,
      stateCode,
      qty: 0,
      costRub: 0
    };
  }

  private ownWarehouse(): Warehouse {
    const warehouse = this.state.warehouses.find((candidate) => candidate.warehouseType === "own");
    if (!warehouse) throw new DomainError("warehouse_not_found", "Не найден собственный склад");
    return warehouse;
  }

  private linkDocuments(fromDocumentId: ID, toDocumentId: ID, linkType: string): DocumentLink {
    const link: DocumentLink = {
      id: id("doc_link"),
      organizationId: this.currentOrgId(),
      fromDocumentId,
      toDocumentId,
      linkType
    };
    this.state.documentLinks.push(link);
    return link;
  }

  private ensureDocumentLink(fromDocumentId: ID, toDocumentId: ID, linkType: string): DocumentLink {
    const existing = this.state.documentLinks.find((link) =>
      link.fromDocumentId === fromDocumentId &&
      link.toDocumentId === toDocumentId &&
      link.linkType === linkType
    );
    return existing ?? this.linkDocuments(fromDocumentId, toDocumentId, linkType);
  }

  private documentDescendantIdForLink(link: DocumentLink, currentDocumentId: ID): ID | undefined {
    switch (link.linkType) {
      case "payment":
      case "channel_fee":
        return link.toDocumentId === currentDocumentId ? link.fromDocumentId : undefined;
      case "sale_finance":
      case "return":
      case "receipt":
      case "procurement_cost":
      case "shortage":
      case "correction":
      default:
        return link.fromDocumentId === currentDocumentId ? link.toDocumentId : undefined;
    }
  }

  private applyPaymentToCashAccount(payment: Payment): Payment {
    const cashAccount = this.mustFind(this.state.cashAccounts, payment.cashAccountId, "cash_account_not_found");
    const direction = payment.paymentDirection === "incoming" ? 1 : -1;
    cashAccount.balanceRub = round2(cashAccount.balanceRub + direction * payment.amountRub);
    return payment;
  }

  private rollbackPaymentsForDocument(documentId: ID) {
    const payments = this.state.payments.filter((candidate) => candidate.documentId === documentId);
    if (payments.length === 0) return;
    for (const payment of payments) {
      const cashAccount = this.mustFind(this.state.cashAccounts, payment.cashAccountId, "cash_account_not_found");
      const direction = payment.paymentDirection === "incoming" ? 1 : -1;
      cashAccount.balanceRub = round2(cashAccount.balanceRub - direction * payment.amountRub);
    }
    const paymentIds = new Set(payments.map((payment) => payment.id));
    this.state.paymentAllocations = this.state.paymentAllocations.filter((allocation) => !paymentIds.has(allocation.paymentId));
    this.state.payments = this.state.payments.filter((candidate) => !paymentIds.has(candidate.id));
  }

  private restoreCostApplicationsToLots(applications: CostApplication[]) {
    for (const application of applications) {
      const lot = this.state.inventoryLots.find((candidate) => candidate.id === application.fromLotId);
      if (!lot) continue;
      lot.qtyRemaining = round4(lot.qtyRemaining + application.qty);
      lot.costRemainingRub = round2(lot.costRemainingRub + application.costRub);
      if (lot.qtyRemaining > 0 || lot.costRemainingRub > 0) lot.status = "open";
      this.addStockState(lot.productId, lot.warehouseId, application.qty, application.costRub, lot.stockStateCode);
    }
  }

  private removeLotsFromStockStates(lots: InventoryLot[]) {
    for (const lot of lots) {
      const qtyToRemove = round4(lot.qtyRemaining);
      const costToRemove = round2(lot.costRemainingRub);
      if (qtyToRemove > 0 || costToRemove > 0) {
        this.addStockState(lot.productId, lot.warehouseId, -qtyToRemove, -costToRemove, lot.stockStateCode);
      }
    }
  }

  private compactZeroStockStates() {
    this.state.stockStates.forEach((stockState) => {
      if (Math.abs(Number(stockState.qty ?? 0)) <= 0.0001) {
        stockState.qty = 0;
        stockState.costRub = 0;
      }
    });
    this.state.stockStates = this.state.stockStates.filter((stockState) =>
      Math.abs(Number(stockState.qty ?? 0)) > 0.0001 || Math.abs(Number(stockState.costRub ?? 0)) > 0.01
    );
  }

  private audit(entityType: string, entityId: ID, eventType: string, before?: unknown, after?: unknown, reason?: string): AuditEvent {
    const organizationId = this.state.organization?.id ?? "unconfigured";
    const event: AuditEvent = {
      id: id("audit"),
      organizationId,
      actorLabel: "system",
      entityType,
      entityId,
      eventType,
      before,
      after,
      reason,
      createdAt: nowIso()
    };
    this.state.auditEvents.push(event);
    return event;
  }

  private createCorrectionCase(sourceDocumentId: ID, correctionType: "open_period_edit" | "reversal" | "current_period_adjustment" | "reprocess_external_event", reason: string, impactSummary: Record<string, unknown>): CorrectionCase {
    const correction: CorrectionCase = {
      id: id("correction"),
      organizationId: this.currentOrgId(),
      sourceDocumentId,
      correctionType,
      reason,
      status: "previewed",
      impactSummary,
      createdAt: nowIso()
    };
    this.state.correctionCases.push(correction);
    return correction;
  }

  private queueRecalculation(jobType: "inventory_cost" | "sales_profit" | "settlements" | "reports" | "external_event_reprocess", scope: Record<string, unknown>) {
    const job = {
      id: id("recalc"),
      organizationId: this.currentOrgId(),
      jobType,
      scope,
      status: "completed" as const,
      progress: 100,
      createdAt: nowIso(),
      finishedAt: nowIso()
    };
    this.state.recalculationJobs.push(job);
    return job;
  }

  private supplierAdvanceBalance(purchaseOrderId: ID): number {
    const paid = this.state.paymentAllocations
      .filter((allocation) =>
        allocation.purchaseOrderId === purchaseOrderId &&
        allocation.allocationPurpose === "goods_purchase" &&
        this.isPaymentAllocationPosted(allocation)
      )
      .reduce((sum, allocation) => sum + allocation.amountRub, 0);
    const received = this.state.goodsReceipts
      .filter((receipt) => receipt.purchaseOrderId === purchaseOrderId && receipt.status === "posted" && this.isDocumentPosted(receipt.documentId))
      .reduce((sum, receipt) => sum + receipt.goodsCostRubTotal, 0);
    const resolved = this.state.shortageResolutions
      .filter((resolution) => resolution.purchaseOrderId === purchaseOrderId && resolution.status === "posted")
      .flatMap((resolution) => this.state.shortageResolutionLines.filter((line) => line.shortageResolutionId === resolution.id))
      .reduce((sum, line) => sum + (line.action === "supplier_claim" || line.action === "loss" ? line.paidShareRub : 0), 0);
    return round2(paid - received - resolved);
  }

  private paidShareForOrderLine(orderId: ID, orderLine: PurchaseOrderLine, qty: number): number {
    const linkedGoodsPaymentRub = this.state.paymentAllocations
      .filter((allocation) =>
        allocation.purchaseOrderId === orderId &&
        allocation.allocationPurpose === "goods_purchase" &&
        this.isPaymentAllocationPosted(allocation)
      )
      .reduce((sum, allocation) => sum + allocation.amountRub, 0);
    const orderLines = this.state.purchaseOrderLines.filter((line) => line.purchaseOrderId === orderId);
    const totalBasis = orderLines.reduce((sum, line) => sum + line.supplierAmount, 0);
    const lineBasis = qty * orderLine.supplierUnitPrice;
    return totalBasis > 0 ? round2((linkedGoodsPaymentRub * lineBasis) / totalBasis) : 0;
  }

  private procurementCostTargets(purchaseOrderId: ID | undefined, allocationBasis: ProcurementCost["allocationBasis"]) {
    const lots = this.state.inventoryLots.filter((lot) => {
      if (lot.status === "reversed" || lot.qtyInitial <= 0) return false;
      if (!purchaseOrderId) return true;
      const receipt = this.state.goodsReceipts.find((candidate) => candidate.documentId === lot.sourceDocumentId);
      return receipt?.purchaseOrderId === purchaseOrderId;
    });

    return lots.map((lot) => {
      const product = this.mustFind(this.state.products, lot.productId, "product_not_found");
      const qtyInitial = round4(lot.qtyInitial);
      const qtyRemaining = round4(Math.max(0, lot.qtyRemaining));
      const qtySold = round4(Math.max(0, qtyInitial - qtyRemaining));
      let basisValue = 0;
      if (allocationBasis === "by_cost") {
        basisValue = round6(Math.max(0, lot.costInitialRub));
      } else if (allocationBasis === "by_unit") {
        basisValue = qtyInitial;
      } else {
        if (!product.weightGrams || product.weightGrams <= 0) {
          throw new DomainError("product_weight_required", `Для распределения по весу заполните вес товара: ${product.name}`);
        }
        basisValue = round6(qtyInitial * product.weightGrams);
      }
      return { lot, product, qtyInitial, qtyRemaining, qtySold, basisValue };
    }).filter((target) => target.basisValue > 0);
  }

  private returnDocumentLines(returnId: ID) {
    const salesReturn = this.mustFind(this.state.salesReturns, returnId, "return_not_found");
    return this.state.documentLines.filter((line) => line.documentId === salesReturn.documentId && line.lineType === "sales_return_line");
  }

  private returnedQtyForSaleLine(saleLineId: ID, excludeReturnId?: ID): number {
    const excludedDocumentId = excludeReturnId
      ? this.state.salesReturns.find((candidate) => candidate.id === excludeReturnId)?.documentId
      : undefined;
    return round4(
      this.state.documentLines
        .filter((line) => line.lineType === "sales_return_line")
        .filter((line) => !excludedDocumentId || line.documentId !== excludedDocumentId)
        .filter((line) => {
          const payload = (line.payload ?? {}) as Record<string, unknown>;
          const salesReturn = this.state.salesReturns.find((candidate) => candidate.documentId === line.documentId);
          return payload.saleLineId === saleLineId && salesReturn?.status === "posted";
        })
        .reduce((sum, line) => sum + Number(line.qty ?? 0), 0)
    );
  }

  private markExternalEventProcessed(eventId: ID | undefined, documentId: ID) {
    if (!eventId) return;
    this.bufferExternalEventUpdate(eventId, {
      status: "processed",
      materializedDocumentId: documentId,
      reason: undefined,
      lastError: undefined,
      updatedAt: nowIso()
    });
  }

  private markExternalEventNeedsAttention(eventId: ID | undefined, documentId: ID, reason: string) {
    if (!eventId) return;
    this.bufferExternalEventUpdate(eventId, {
      status: "needs_attention",
      materializedDocumentId: documentId,
      reason,
      lastError: reason,
      updatedAt: nowIso()
    });
  }

  // Запись статуса события отложена, чтобы posting-методы (postSale/postReturn/...) оставались
  // синхронными. Для in-memory сразу мутируем объект в state (тесты видят результат); для
  // Postgres патч копится и применяется в flushPendingExternalEventUpdates() на commit сессии.
  private bufferExternalEventUpdate(eventId: ID, patch: Partial<ExternalEvent>) {
    this.pendingExternalEventUpdates.set(eventId, { ...this.pendingExternalEventUpdates.get(eventId), ...patch });
    const inState = this.state.externalEvents.find((candidate) => candidate.id === eventId);
    if (inState) Object.assign(inState, patch);
  }

  async flushPendingExternalEventUpdates() {
    if (this.pendingExternalEventUpdates.size === 0) return;
    const updates = Array.from(this.pendingExternalEventUpdates.entries());
    this.pendingExternalEventUpdates.clear();
    for (const [eventId, patch] of updates) {
      const event = await this.externalEvents.getById(eventId);
      if (!event) continue;
      Object.assign(event, patch);
      await this.externalEvents.upsert(event);
    }
  }

  private receivedQtyForLine(purchaseOrderLineId: ID): number {
    const postedReceiptIds = new Set(
      this.state.goodsReceipts
        .filter((receipt) => receipt.status === "posted" && this.isDocumentPosted(receipt.documentId))
        .map((receipt) => receipt.id)
    );
    return round4(
      this.state.goodsReceiptLines
        .filter((line) => line.purchaseOrderLineId === purchaseOrderLineId && postedReceiptIds.has(line.goodsReceiptId))
        .reduce((sum, line) => sum + line.qtyReceived, 0)
    );
  }

  private dispatchedQtyForReceiptLine(goodsReceiptLineId: ID, channelId?: ID): number {
    const postedTransferIds = new Set(
      this.state.stockTransfers
        .filter((transfer) =>
          transfer.status === "posted" &&
          this.isDocumentPosted(transfer.documentId) &&
          (!channelId || transfer.channelId === channelId)
        )
        .map((transfer) => transfer.id)
    );
    return round4(
      this.state.stockTransferLines
        .filter((line) => line.sourceGoodsReceiptLineId === goodsReceiptLineId && postedTransferIds.has(line.stockTransferId))
        .reduce((sum, line) => sum + line.qty, 0)
    );
  }

  private remainingQtyForReceiptLine(goodsReceiptLineId: ID, warehouseId?: ID, stateCode = "sellable"): number {
    return round4(
      this.state.inventoryLots
        .filter((lot) =>
          lot.sourceLineId === goodsReceiptLineId &&
          lot.status !== "reversed" &&
          lot.qtyRemaining > 0 &&
          (!warehouseId || lot.warehouseId === warehouseId) &&
          (lot.stockStateCode ?? "sellable") === stateCode
        )
        .reduce((sum, lot) => sum + lot.qtyRemaining, 0)
    );
  }

  private openShortageQtyForLine(orderId: ID, purchaseOrderLineId: ID): number {
    const line = this.mustFind(this.state.purchaseOrderLines, purchaseOrderLineId, "purchase_order_line_not_found");
    const resolvedQty = round4(
      this.state.shortageResolutions
        .filter((resolution) => resolution.purchaseOrderId === orderId && resolution.status === "posted")
        .flatMap((resolution) => this.state.shortageResolutionLines.filter((candidate) => candidate.shortageResolutionId === resolution.id))
        .filter((candidate) => candidate.purchaseOrderLineId === purchaseOrderLineId)
        .reduce((sum, candidate) => sum + candidate.qtyShortage, 0)
    );
    return round4(Math.max(0, line.qtyOrdered - this.receivedQtyForLine(purchaseOrderLineId) - resolvedQty));
  }

  private isPaymentAllocationPosted(allocation: PaymentAllocation): boolean {
    const payment = this.state.payments.find((candidate) => candidate.id === allocation.paymentId);
    return payment ? this.isDocumentPosted(payment.documentId) : false;
  }

  private isDocumentPosted(documentId: ID): boolean {
    return this.state.documents.find((document) => document.id === documentId)?.status === "posted";
  }

  private channelClearingBalance(channelId: ID): number {
    const documents = new Set(
      [
        ...this.state.sales.filter((sale) => sale.channelId === channelId).flatMap((sale) => [sale.documentId, sale.financialDocumentId].filter(Boolean) as string[]),
        ...this.state.salesReturns.filter((saleReturn) => saleReturn.channelId === channelId).map((saleReturn) => saleReturn.documentId),
        ...this.state.channelFinanceEvents.filter((event) => event.channelId === channelId).map((event) => event.documentId),
        ...this.state.payouts.filter((payout) => payout.channelId === channelId).map((payout) => payout.documentId)
      ]
    );
    const entryIds = this.state.journalEntries.filter((entry) => documents.has(entry.documentId)).map((entry) => entry.id);
    return round2(
      this.state.journalLines
        .filter((line) => entryIds.includes(line.journalEntryId) && line.accountCode === "76.ТП")
        .reduce((sum, line) => sum + line.debit - line.credit, 0)
    );
  }

  private unbalancedEntries() {
    return this.state.journalEntries.filter((entry) => {
      const lines = this.state.journalLines.filter((line) => line.journalEntryId === entry.id);
      const debit = round2(lines.reduce((sum, line) => sum + line.debit, 0));
      const credit = round2(lines.reduce((sum, line) => sum + line.credit, 0));
      return debit !== credit;
    });
  }

  private nextDocumentNumber(type: string): string {
    const prefixByType: Record<string, string> = {
      accounting_note: "ЗАМ",
      opening_balance: "СТ",
      purchase_order: "ЗП",
      payment: "ОПЛ",
      goods_receipt: "ПР",
      procurement_cost: "РЗ",
      shortage_resolution: "НД",
      stock_transfer: "ПМ",
      sale: "ПРД",
      sale_accrual: "НПР",
      sales_return: "ВЗ",
      channel_finance_event: "КН",
      payout: "ВПЛ",
      operating_expense: "ОР",
      stocktake: "ИНВ",
      correction: "КОР"
    };
    const prefix = prefixByType[type] ?? "ДОК";
    const maxSequence = this.state.documents
      .filter((document) => document.documentType === type)
      .reduce((current, document) => {
        const value = String(document.number ?? "");
        if (!value.startsWith(`${prefix}-`)) return current;
        const parsed = Number.parseInt(value.slice(prefix.length + 1), 10);
        return Number.isFinite(parsed) ? Math.max(current, parsed) : current;
      }, 0);
    return `${prefix}-${String(maxSequence + 1).padStart(5, "0")}`;
  }

  private periodForDate(date: string): AccountingPeriod | undefined {
    return this.state.periods.find((period) => period.startsOn <= date && period.endsOn >= date);
  }

  private monthsBetweenInclusive(from: string, to: string) {
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);
    return (toDate.getUTCFullYear() - fromDate.getUTCFullYear()) * 12 + toDate.getUTCMonth() - fromDate.getUTCMonth() + 1;
  }

  private validateSetupInput(input: BootstrapInput, documentsExist: boolean) {
    if (!input.displayName.trim()) {
      throw new DomainError("organization_name_required", "Укажите название учетного контура");
    }
    if (input.inn && !/^\d{12}$/.test(input.inn)) {
      throw new DomainError("invalid_inn", "ИНН ИП должен содержать 12 цифр");
    }
    if (!input.accountingStartDate) {
      throw new DomainError("accounting_start_required", "Укажите дату старта учета");
    }
    const startDate = new Date(input.accountingStartDate);
    if (Number.isNaN(startDate.getTime())) {
      throw new DomainError("invalid_accounting_start", "Некорректная дата старта учета");
    }
    const now = new Date();
    const maxFuture = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    if (startDate > maxFuture) {
      throw new DomainError("accounting_start_too_far", "Дата старта учета не может быть позже чем через год");
    }
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    if (startDate < startOfCurrentMonth && input.confirmHistoricalStart === false) {
      throw new DomainError("historical_start_requires_confirmation", "Подтвердите историческую дату старта учета");
    }
    if (documentsExist && this.state.accountingPolicy && input.accountingStartDate !== this.state.accountingPolicy.accountingStartDate) {
      throw new DomainError("accounting_start_locked", "Нельзя менять дату старта после появления учетных документов");
    }
  }

  private assertAccountingDateAllowed(date: string) {
    const { policy } = this.ensureBootstrapped();
    if (date < policy.accountingStartDate) {
      throw new DomainError("before_accounting_start", "Дата раньше начала учета");
    }
    const period = this.periodForDate(date);
    if (!period) {
      throw new DomainError("period_not_found", "Для даты нет учетного периода");
    }
  }

  private mustFind<T extends { id: ID }>(items: T[], idValue: ID, code: string): T {
    const item = items.find((candidate) => candidate.id === idValue);
    if (!item) throw new DomainError(code, `Не найдена запись ${idValue}`);
    return item;
  }
}

const OPENING_STOCK_STATE_CODES = new Set(["sellable", "damaged", "lost_pending", "reserved"]);

function allocateReceiptLines(
  receiptLines: Array<{ purchaseOrderLineId: ID; qtyReceived: number }>,
  orderLines: PurchaseOrderLine[],
  goodsCostRubTotal: number
): ReceiptPreviewLine[] {
  const bases = receiptLines.map((line) => {
    const orderLine = orderLines.find((candidate) => candidate.id === line.purchaseOrderLineId);
    if (!orderLine) throw new DomainError("purchase_order_line_not_found", "Строка заказа не найдена");
    return {
      receiptLine: line,
      orderLine,
      basis: round2(line.qtyReceived * orderLine.supplierUnitPrice)
    };
  });
  const totalBasis = round2(bases.reduce((sum, item) => sum + item.basis, 0));
  const totalQty = round4(bases.reduce((sum, item) => sum + item.receiptLine.qtyReceived, 0));
  let allocated = 0;
  return bases.map((item, index) => {
    const isLast = index === bases.length - 1;
    const share = totalBasis > 0 ? item.basis / totalBasis : item.receiptLine.qtyReceived / totalQty;
    const allocatedGoodsCostRub = isLast ? round2(goodsCostRubTotal - allocated) : round2(goodsCostRubTotal * share);
    allocated = round2(allocated + allocatedGoodsCostRub);
    return {
      purchaseOrderLineId: item.orderLine.id,
      productId: item.orderLine.productId,
      qtyReceived: round4(item.receiptLine.qtyReceived),
      supplierAmountBasis: item.basis,
      allocatedGoodsCostRub,
      unitCostRub: item.receiptLine.qtyReceived > 0 ? round6(allocatedGoodsCostRub / item.receiptLine.qtyReceived) : 0
    };
  });
}

function seedChartAccounts(organizationId: ID): ChartAccount[] {
  const accounts: Array<Omit<ChartAccount, "id" | "organizationId" | "isActive">> = [
    { code: "41.01", name: "Товары на своем складе", kind: "asset", normalSide: "debit" },
    { code: "41.02", name: "Товары в пути", kind: "asset", normalSide: "debit" },
    { code: "41.03", name: "Товары на точках продаж", kind: "asset", normalSide: "debit" },
    { code: MARKETPLACE_SHIPPED_ACCOUNT_CODE, name: "Продажи ждут начисления", kind: "asset", normalSide: "debit" },
    { code: "50", name: "Касса", kind: "asset", normalSide: "debit" },
    { code: "51", name: "Расчетный счет", kind: "asset", normalSide: "debit" },
    { code: "60.01", name: "Задолженность поставщикам", kind: "liability", normalSide: "credit" },
    { code: "60.02", name: "Авансы поставщикам", kind: "asset", normalSide: "debit" },
    { code: "62", name: "Дебиторская задолженность покупателей", kind: "asset", normalSide: "debit" },
    { code: "76.02", name: "Претензии поставщикам", kind: "asset", normalSide: "debit" },
    { code: "76.ТП", name: "Расчеты с точками продаж", kind: "asset", normalSide: "debit" },
    { code: "80.01", name: "Вклады владельца", kind: "equity", normalSide: "credit" },
    { code: "80.02", name: "Изъятия владельца", kind: "equity", normalSide: "debit" },
    { code: "84", name: "Нераспределенная прибыль", kind: "equity", normalSide: "credit" },
    { code: "90.01", name: "Выручка", kind: "revenue", normalSide: "credit" },
    { code: "90.02", name: "Себестоимость продаж", kind: "expense", normalSide: "debit" },
    { code: "91.01", name: "Прочие доходы", kind: "revenue", normalSide: "credit" },
    { code: "91.02", name: "Прочие расходы и потери", kind: "expense", normalSide: "debit" },
    { code: "94", name: "Недостачи и потери", kind: "expense", normalSide: "debit" },
    { code: "26", name: "Общехозяйственные расходы", kind: "expense", normalSide: "debit" },
    { code: "44", name: "Расходы на продажу", kind: "expense", normalSide: "debit" }
  ];
  return accounts.map((account) => ({ id: id("account"), organizationId, isActive: true, ...account }));
}

function channelFinanceDocumentTitle(eventKind: ChannelFinanceEvent["eventKind"], category?: ChannelFinanceEvent["category"]) {
  if (eventKind === "compensation") return "Компенсация канала";
  if (category === "ads") return "Реклама канала";
  if (category === "storage") return "Хранение канала";
  if (category === "cross_docking" || category === "inbound_handling") return "Логистика и обработка канала";
  return "Комиссия или удержание канала";
}

function defaultFinanceTreatment(eventKind: ChannelFinanceEvent["eventKind"]): NonNullable<ChannelFinanceEvent["treatment"]> {
  if (eventKind === "compensation") return "other_income";
  if (eventKind === "penalty") return "other_expense";
  return "channel_operating";
}

function defaultFinanceCategory(eventKind: ChannelFinanceEvent["eventKind"]): NonNullable<ChannelFinanceEvent["category"]> {
  if (eventKind === "compensation") return "compensation";
  if (eventKind === "penalty") return "penalty";
  if (eventKind === "logistics") return "last_mile_logistics";
  return "commission";
}

function seedDocumentTypes(): DocumentTypeRegistry[] {
  const types: Array<[string, string, string, boolean, string | undefined]> = [
    ["accounting_note", "documents", "Учетная заметка", false, undefined],
    ["opening_balance", "inventory", "Стартовый остаток", true, "opening_balance"],
    ["purchase_order", "procurement", "Заказ поставщику", false, undefined],
    ["payment", "money", "Платеж", true, "payment"],
    ["goods_receipt", "procurement", "Приемка товара", true, "goods_receipt"],
    ["procurement_cost", "procurement", "Дополнительный расход закупки", true, "procurement_cost"],
    ["shortage_resolution", "procurement", "Решение по недопоставке", true, "shortage_resolution"],
    ["stock_transfer", "inventory", "Перемещение товара", true, "stock_transfer"],
    ["sale", "sales", "Продажа", true, "sale"],
    [MARKETPLACE_SALE_RECOGNITION_DOCUMENT_TYPE, "sales", "Начисление продажи маркетплейса", true, MARKETPLACE_SALE_RECOGNITION_DOCUMENT_TYPE],
    ["sales_return", "sales", "Возврат", true, "sales_return"],
    ["channel_finance_event", "channels", "Финансовое событие канала", true, "channel_finance_event"],
    ["payout", "channels", "Выплата точки продаж", true, "payout"],
    ["operating_expense", "expenses", "Операционный расход", true, "operating_expense"],
    ["stocktake", "inventory", "Инвентаризация", true, "stocktake"],
    ["correction", "controls", "Корректировка", true, "correction"]
  ];
  return types.map(([code, moduleCode, displayName, isPosting, postingRuleCode]) => ({
    code,
    moduleCode,
    displayName,
    isPosting,
    postingRuleCode,
    allowsDraft: true,
    allowsReversal: true,
    allowsCorrection: true
  }));
}

function accountForWarehouse(warehouse: Warehouse): "41.01" | "41.02" | "41.03" {
  if (warehouse.warehouseType === "transit") return "41.02";
  if (warehouse.warehouseType === "sales_point") return "41.03";
  return "41.01";
}

function saleRequiresDeferredMarketplaceRecognition(sale: Pick<Sale, "externalEventId">, channel: Pick<SalesChannel, "channelType">) {
  return channel.channelType === "marketplace" && Boolean(sale.externalEventId);
}

function saleFinancialAmountRub(sale: Pick<Sale, "grossAmountRub" | "recognizedGrossAmountRub">) {
  return round2(Number(sale.recognizedGrossAmountRub ?? sale.grossAmountRub ?? 0));
}

function normalizeParentPostingNumber(postingNumber: string) {
  const value = String(postingNumber ?? "").trim();
  if (!value) return "";
  const parts = value.split("-").filter(Boolean);
  if (parts.length >= 3) return `${parts[0]}-${parts[1]}`;
  return value;
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
