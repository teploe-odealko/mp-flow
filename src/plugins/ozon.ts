import type { ExternalProduct, ID, Product } from "../core/models";
import { round4 } from "../core/utils";
import { buildSuggestedMarketplaceAllocations } from "./shared/marketplace-allocation";
import type {
  CardGuidelines,
  DispatchAutoAllocateInput,
  DispatchAutoAllocateResult,
  DispatchPlan,
  DispatchPlanDestination,
  DispatchPlanLine,
  DispatchPlanningInput,
  MarketplacePlugin,
  PluginCredentials,
  SyncContext,
  SyncResult
} from "./types";

const OZON_API_BASE = "https://api-seller.ozon.ru";

type OzonProductListItem = {
  product_id?: number;
  offer_id?: string;
  archived?: boolean;
};

type OzonProductInfo = {
  id?: number;
  sku?: number;
  name?: string;
  offer_id?: string;
  barcodes?: string[];
  primary_image?: string | string[];
  images?: string[];
  volume_weight?: number;
  weight?: number;
  weight_unit?: string;
  width?: number;
  height?: number;
  depth?: number;
  dimension_unit?: string;
  stocks?: {
    stocks?: Array<{ present?: number; reserved?: number; sku?: number; source?: string }>;
  };
};

type OzonPosting = {
  posting_number?: string;
  order_id?: number;
  in_process_at?: string;
  created_at?: string;
  status?: string;
  substatus?: string;
  return_status?: string;
  cancellation?: { cancel_reason?: string; cancellation_type?: string };
  products?: Array<{ offer_id?: string; sku?: number; name?: string; quantity?: number; price?: string | number }>;
  financial_data?: {
    products?: Array<{ product_id?: number; offer_id?: string; sku?: number; name?: string; quantity?: number; price?: string | number }>;
  };
};

type OzonFinanceOperation = {
  operation_id?: number | string;
  operation_type?: string;
  operation_type_name?: string;
  operation_date?: string;
  amount?: number;
  accruals_for_sale?: number;
  sale_commission?: number;
  posting?: { posting_number?: string; order_date?: string; delivery_schema?: string };
  items?: Array<{ name?: string; sku?: number }>;
  services?: Array<{ name?: string; price?: number }>;
};

type OzonSellerWarehouse = {
  id: string;
  title: string;
  isActive: boolean;
  isPickup?: boolean;
  region?: string | null;
  address?: string | null;
  macrolocalClusterId?: number | null;
};

type OzonExpandedFinanceEvent = {
  eventType: "sale_accrual" | "fee" | "payout";
  externalId: string;
  payload: Record<string, unknown>;
};

type OzonFinanceRoute = "fee" | "payout" | "expand_only";

// Полный список operationType, который мы сейчас явно поддерживаем в routing.
// Если операция попала сюда, ее route не должен зависеть от знака суммы.
const EXACT_FINANCE_OPERATION_ROUTES: Record<string, OzonFinanceRoute> = {
  OperationAgentDeliveredToCustomer: "expand_only",
  MarketplaceRedistributionOfAcquiringOperation: "fee",
  CustomerReviews: "fee",
  OperationItemReturn: "fee",
  InsuranceServiceSellerItem: "fee",
  MarketplaceServiceItemCrossdocking: "fee",
  OperationPointsForReviews: "fee",
  OperationMarketplaceSupplyAdditional: "fee",
  OperationMarketplaceSupplyExpirationDateProcessing: "fee",
  OperationMarketplaceCostPerClick: "fee",
  OperationMarketplaceServiceSupplyInboundCargoShortage: "fee",
  OperationMarketplaceItemTemporaryStorageRedistribution: "fee",
  DisposalReasonDamagedPackaging: "fee",
  SellerReturnsDeliveryToPickupPoint: "fee",
  OperationSubscriptionPremium: "fee",
  OperationSellerReturnsCargoAssortmentInvalid: "fee",
  OperationMarketplaceAcceleratedProductReviews: "fee",
  MarketplaceSellerInstallmentOperation: "fee",
  DisposalReasonFailedToPickupOnTime: "fee"
};

export const ozonPlugin: MarketplacePlugin = {
  code: "ozon",
  displayName: "Ozon",
  capabilities: ["products", "stocks", "sales", "returns", "finance_events", "payouts", "observed_stock"],
  stateNamespaces: [
    {
      namespace: "dispatch_flow",
      visibility: "private",
      scopeType: "goods_receipt",
      description: "Черновик распределения товаров из приемки по кластерам Ozon"
    },
    {
      namespace: "remote_supply",
      visibility: "private",
      scopeType: "stock_transfer",
      description: "Снимок внешней поставки Ozon, связанной с внутренним перемещением"
    },
    {
      namespace: "provider_runtime",
      visibility: "secret",
      scopeType: "channel",
      description: "Секретное runtime-состояние Ozon plugin"
    },
    {
      namespace: "card_studio",
      visibility: "private",
      scopeType: "flow_session",
      description: "План фотостудии карточки (research + единый стиль + последовательность слайдов)",
      maxPayloadBytes: 256 * 1024
    }
  ],
  fulfillment: {
    capabilities: ["dispatch_plan", "allocation_hints"],
    async planDispatchFromReceipt(input) {
      return planOzonDispatchFromReceipt(input);
    },
    async autoAllocateDispatch(input) {
      return autoAllocateOzonDispatch(input);
    }
  },
  card: {
    guidelines(): CardGuidelines {
      return {
        marketplace: "ozon",
        imageFormat: { aspectRatio: "3:4", minWidth: 900, minHeight: 1200, note: "Вертикальные; 1200×1600" },
        safeZones: "Оставляй пустые поля по краям: верхняя полоса ~110px (статус-бар), правый верхний угол (кнопка «в избранное»), левый нижний угол (бейдж скидки), нижняя полоса ~130px (точки листания), и ~50px по бокам. Весь текст, иконки и важные детали — внутри центральной безопасной зоны. Никаких видимых меток safe-zone на самой картинке.",
        slideTaxonomy: [
          { type: "hero", title: "Hero + УТП", purpose: "Товар крупно (60–80% кадра) + главное УТП крупным заголовком + 2–3 бейджа." },
          { type: "benefits", title: "Преимущества", purpose: "4 иконки + короткие тезисы ключевых выгод." },
          { type: "lifestyle", title: "В контексте", purpose: "Товар в реальном использовании, нужное настроение." },
          { type: "macro", title: "Детали / макро", purpose: "Крупно текстура, материал, важные детали конструкции." },
          { type: "usage", title: "Применение / инструкция", purpose: "Как использовать — шаги или сценарии." },
          { type: "specs", title: "Размеры / характеристики", purpose: "Размерная схема, ТТХ, что в комплекте." },
          { type: "comparison", title: "Почему мы / сравнение", purpose: "Закрытие возражений, отличие от аналогов." },
          { type: "trust", title: "Доверие / CTA", purpose: "Гарантия, подарок, призыв к покупке." }
        ],
        moderation: [
          "Товар на фото обязан соответствовать реальному; не перерисовывать его дизайн.",
          "Без логотипов и брендов конкурентов, без чужих watermark.",
          "Без обещаний, нарушающих правила (медицинские/«100% гарантия» и т.п.).",
          "Текст читаемый, не мелкий; не перегружать слайд.",
        ],
        recommendedSlideCount: { min: 8, max: 12 }
      };
    }
  },
  validateCredentials(credentials) {
    if (!credentials.clientId || !credentials.apiKey) {
      return { ok: false, message: "Для Ozon нужны только Client-Id и Api-Key" };
    }
    return { ok: true };
  },
  async checkAccess(credentials) {
    const shape = ozonPlugin.validateCredentials(credentials);
    if (!shape.ok) return shape;
    if (isDemoCredentials(credentials)) return { ok: true };
    return checkOzonAccess(credentials);
  },
  async sync(context) {
    if (isDemoCredentials(context.credentials)) {
      return syncDemo(context);
    }
    return syncRealOzon(context);
  }
};

async function syncRealOzon({ app, channelId, syncRunId, since, credentials, streams, autoLinkProducts }: SyncContext): Promise<SyncResult> {
  const channel = app.state.salesChannels.find((candidate) => candidate.id === channelId);
  const startedAt = parseSince(since, channel?.lastSyncAt);
  const finishedAt = new Date();
  const stats = { products: 0, events: 0, stocks: 0, sales: 0, returns: 0, finance_events: 0, payouts: 0 };
  const errors: string[] = [];
  const externalByOfferId = new Map<string, ExternalProduct>();
  const wantStream = (code: string) => !streams || streams.length === 0 || streams.includes(code as any);
  const wantProducts = wantStream("products");
  const wantStocks = wantStream("stocks");
  const wantSales = wantStream("sales");
  const wantReturns = wantStream("returns");
  const wantFinance = wantStream("finance_events");

  if (wantProducts || wantStocks) {
    try {
      const products = await loadProducts(credentials!, errors);
      for (const productInfo of products) {
        const offerId = normalizeSku(productInfo.offer_id);
        if (!offerId) continue;
        const externalProduct = ensureExternalProduct(app, channelId, productInfo);
        externalByOfferId.set(offerId, externalProduct);
        if (wantProducts) {
          stats.products += 1;
          // Onboarding import passes autoLinkProducts:false so cards arrive unmapped and the
          // user maps/creates internal products explicitly. Ongoing syncs keep auto-linking.
          if (autoLinkProducts !== false) {
            ensureInternalProduct(app, externalProduct, productInfo);
          }
        }

        if (wantStocks) {
          for (const stock of productInfo.stocks?.stocks ?? []) {
            const qtyObserved = Number(stock.present ?? 0) - Number(stock.reserved ?? 0);
            app.recordObservedStock({
              channelId,
              externalProductId: externalProduct.id,
              observedAt: finishedAt.toISOString(),
              qtyObserved: Number.isFinite(qtyObserved) ? Math.max(0, qtyObserved) : 0
            });
            stats.stocks += 1;
          }
        }
      }
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  await Promise.all([
    (async () => {
      if (!wantSales && !wantReturns) return;
      try {
        const [fbsPostings, fboPostings] = await Promise.all([
          loadFbsPostings(credentials!, startedAt, finishedAt, errors),
          loadFboPostings(credentials!, startedAt, finishedAt, errors)
        ]);
        for (const posting of [...fbsPostings, ...fboPostings]) {
          const payload = normalizePostingPayload(posting, externalByOfferId);
          const eventType = isReturnPosting(posting) ? "return" : "sale";
          if (eventType === "return" && !wantReturns) continue;
          if (eventType === "sale" && !wantSales) continue;
          await app.ingestExternalEvent({
            channelId,
            syncRunId,
            eventType,
            externalId: `ozon-posting-${posting.posting_number ?? posting.order_id ?? stats.events}`,
            occurredAt: ozonDateToIso(posting.in_process_at ?? posting.created_at) ?? finishedAt.toISOString(),
            payload
          });
          stats.events += 1;
          if (eventType === "return") stats.returns += 1;
          else stats.sales += 1;
        }
      } catch (error) {
        errors.push(errorMessage(error));
      }
    })(),
    (async () => {
      if (!wantFinance) return;
      try {
        for (const operation of await loadFinanceOperations(credentials!, startedAt, finishedAt, errors)) {
          for (const financeEvent of expandOzonFinanceEvents(operation)) {
            if (financeEvent.eventType !== "fee" && financeEvent.eventType !== "sale_accrual") continue;
            await app.ingestExternalEvent({
              channelId,
              syncRunId,
              eventType: financeEvent.eventType,
              externalId: financeEvent.externalId,
              occurredAt: ozonDateToIso(operation.operation_date) ?? finishedAt.toISOString(),
              payload: financeEvent.payload
            });
            stats.events += 1;
            stats.finance_events += 1;
          }
        }
      } catch (error) {
        errors.push(errorMessage(error));
      }
    })()
  ]);

  return {
    pluginCode: "ozon",
    channelId,
    status: errors.length > 0 ? "failed" : "completed",
    stats,
    errors
  };
}

async function checkOzonAccess(credentials: PluginCredentials): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await ozonRequest<{ result?: unknown }>(credentials, "/v3/product/list", { limit: 1, filter: { visibility: "ALL" } });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

function ensureInternalProduct(app: SyncContext["app"], externalProduct: ExternalProduct, productInfo: OzonProductInfo): Product {
  const existingLink = app.state.productExternalLinks.find((link) => link.externalProductId === externalProduct.id && link.status === "active");
  const byLink = existingLink ? app.state.products.find((product) => product.id === existingLink.productId) : undefined;
  const offerId = normalizeSku(productInfo.offer_id || externalProduct.externalSku);
  const product = byLink ?? findInternalProduct(app.state.products, offerId, productInfo);
  const patch = productInputFromOzon(productInfo, externalProduct.externalSku);
  if (product) {
    app.updateProduct(product.id, {
      name: patch.name || product.name,
      barcode: patch.barcode ?? product.barcode,
      weightGrams: patch.weightGrams ?? product.weightGrams,
      lengthMm: patch.lengthMm ?? product.lengthMm,
      widthMm: patch.widthMm ?? product.widthMm,
      heightMm: patch.heightMm ?? product.heightMm,
      manufacturerArticle: patch.manufacturerArticle ?? product.manufacturerArticle,
      imageUrl: patch.imageUrl ?? product.imageUrl,
      comment: patch.comment ?? product.comment
    });
    if (!existingLink) app.linkExternalProduct({ externalProductId: externalProduct.id, productId: product.id });
    return product;
  }
  const created = app.createProduct(patch);
  app.linkExternalProduct({ externalProductId: externalProduct.id, productId: created.id });
  return created;
}

function productInputFromOzon(productInfo: OzonProductInfo, fallbackSku: string): Parameters<SyncContext["app"]["createProduct"]>[0] {
  const offerId = normalizeSku(productInfo.offer_id) || fallbackSku;
  const marketplaceSku = productInfo.sku || productInfo.id;
  return {
    sku: offerId,
    name: productInfo.name || offerId,
    unit: "шт",
    barcode: productInfo.barcodes?.[0],
    weightGrams: ozonWeightGrams(productInfo),
    lengthMm: ozonDimensionMm(productInfo.depth, productInfo.dimension_unit),
    widthMm: ozonDimensionMm(productInfo.width, productInfo.dimension_unit),
    heightMm: ozonDimensionMm(productInfo.height, productInfo.dimension_unit),
    manufacturerArticle: marketplaceSku ? String(marketplaceSku) : undefined,
    comment: `Импортировано из Ozon Seller API. Offer ID: ${offerId}${marketplaceSku ? `, SKU: ${marketplaceSku}` : ""}`,
    imageUrl: firstImage(productInfo)
  };
}

async function loadProducts(credentials: PluginCredentials, errors: string[]): Promise<OzonProductInfo[]> {
  const listItems: OzonProductListItem[] = [];
  let lastId = "";
  do {
    const response = await ozonRequest<{ result?: { items?: OzonProductListItem[]; last_id?: string } }>(credentials, "/v3/product/list", {
      filter: { visibility: "ALL" },
      limit: 1000,
      last_id: lastId || undefined
    });
    const items = response.result?.items ?? [];
    listItems.push(...items);
    lastId = response.result?.last_id ?? "";
  } while (lastId);

  const details: OzonProductInfo[] = [];
  for (const chunk of chunks(listItems.map((item) => item.offer_id).filter(Boolean) as string[], 1000)) {
    try {
      const response = await ozonRequest<{ items?: OzonProductInfo[] }>(credentials, "/v3/product/info/list", { offer_id: chunk });
      details.push(...(response.items ?? []));
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }
  return details.length > 0 ? details : listItems.map((item): OzonProductInfo => ({ id: item.product_id, offer_id: item.offer_id }));
}

async function loadFbsPostings(credentials: PluginCredentials, from: Date, to: Date, errors: string[]) {
  const postings = await mapWithConcurrency(monthPeriods(from, to), 3, async (period) => {
    const monthlyPostings: OzonPosting[] = [];
    const limit = 1000;
    let offset = 0;
    while (true) {
      try {
        const response = await ozonRequest<{ result?: { postings?: OzonPosting[]; has_next?: boolean } }>(credentials, "/v3/posting/fbs/list", {
          dir: "ASC",
          filter: { since: period.from.toISOString(), to: period.to.toISOString() },
          limit,
          offset,
          with: { analytics_data: true, financial_data: true }
        });
        const page = response.result?.postings ?? [];
        monthlyPostings.push(...page);
        if (!response.result?.has_next || page.length === 0) break;
        offset += limit;
      } catch (error) {
        errors.push(`FBS ${period.from.toISOString().slice(0, 10)}: ${errorMessage(error)}`);
        break;
      }
    }
    return monthlyPostings;
  });
  return postings.flat();
}

async function loadFboPostings(credentials: PluginCredentials, from: Date, to: Date, errors: string[]) {
  const postings = await mapWithConcurrency(monthPeriods(from, to), 3, async (period) => {
    const monthlyPostings: OzonPosting[] = [];
    const limit = 1000;
    let offset = 0;
    while (true) {
      try {
        const response = await ozonRequest<{ result?: OzonPosting[] | { postings?: OzonPosting[]; has_next?: boolean } }>(credentials, "/v2/posting/fbo/list", {
          dir: "ASC",
          filter: { since: period.from.toISOString(), to: period.to.toISOString() },
          limit,
          offset,
          with: { analytics_data: true, financial_data: true }
        });
        const result = response.result;
        const page = Array.isArray(result) ? result : result?.postings ?? [];
        monthlyPostings.push(...page);
        const hasNext = Array.isArray(result) ? page.length === limit : Boolean(result?.has_next);
        if (!hasNext || page.length === 0) break;
        offset += limit;
      } catch (error) {
        errors.push(`FBO ${period.from.toISOString().slice(0, 10)}: ${errorMessage(error)}`);
        break;
      }
    }
    return monthlyPostings;
  });
  return postings.flat();
}

async function loadFinanceOperations(credentials: PluginCredentials, from: Date, to: Date, errors: string[]) {
  const operations = await mapWithConcurrency(monthPeriods(from, to), 3, async (period) => {
    const monthlyOperations: OzonFinanceOperation[] = [];
    let page = 1;
    while (true) {
      try {
        const response = await ozonRequest<{ result?: { operations?: OzonFinanceOperation[]; page_count?: number } }>(credentials, "/v3/finance/transaction/list", {
          filter: {
            date: { from: period.from.toISOString(), to: period.to.toISOString() },
            operation_type: [],
            posting_number: "",
            transaction_type: "all"
          },
          page,
          page_size: 1000
        });
        const batch = response.result?.operations ?? [];
        monthlyOperations.push(...batch);
        if (page >= (response.result?.page_count ?? 0) || batch.length === 0) break;
        page += 1;
      } catch (error) {
        errors.push(`finance ${period.from.toISOString().slice(0, 10)}: ${errorMessage(error)}`);
        break;
      }
    }
    return monthlyOperations;
  });
  return operations.flat();
}

async function ozonRequest<T>(credentials: PluginCredentials, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${OZON_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Id": credentials.clientId ?? "",
      "Api-Key": credentials.apiKey ?? ""
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({})) as T & { message?: string; error?: string; code?: number };
  if (!response.ok) {
    throw new Error(payload.message ?? payload.error ?? `Ozon API ${response.status}`);
  }
  return payload;
}

function ensureExternalProduct(app: SyncContext["app"], channelId: ID, productInfo: OzonProductInfo): ExternalProduct {
  const externalSku = normalizeSku(productInfo.offer_id) || String(productInfo.sku ?? productInfo.id ?? "unknown");
  const existing = app.state.externalProducts.find((product) => product.channelId === channelId && product.externalSku === externalSku);
  if (existing) {
    existing.externalName = productInfo.name ?? existing.externalName;
    existing.imageUrl = firstImage(productInfo) ?? existing.imageUrl;
    existing.status = "active";
    return existing;
  }
  return app.createExternalProduct({
    channelId,
    externalSku,
    externalName: productInfo.name ?? externalSku,
    imageUrl: firstImage(productInfo)
  });
}

function findInternalProduct(products: Product[], offerId: string, productInfo?: OzonProductInfo) {
  const normalized = normalizeSku(offerId).toLowerCase();
  const marketplaceSku = productInfo?.sku || productInfo?.id;
  return products.find((product) =>
    normalizeSku(product.sku).toLowerCase() === normalized ||
    normalizeSku(product.manufacturerArticle).toLowerCase() === normalized ||
    (marketplaceSku ? normalizeSku(product.manufacturerArticle).toLowerCase() === String(marketplaceSku).toLowerCase() : false)
  );
}

function ozonWeightGrams(productInfo: OzonProductInfo): number | undefined {
  if (typeof productInfo.weight === "number" && productInfo.weight > 0) {
    const unit = (productInfo.weight_unit ?? "").toLowerCase();
    if (unit.includes("kg") || unit.includes("кг")) return Math.round(productInfo.weight * 1000);
    if (unit.includes("g") || unit.includes("гр")) return Math.round(productInfo.weight);
  }
  if (typeof productInfo.volume_weight === "number" && productInfo.volume_weight > 0) {
    return Math.round(productInfo.volume_weight * 1000);
  }
  return undefined;
}

function ozonDimensionMm(value?: number, unit?: string): number | undefined {
  if (typeof value !== "number" || value <= 0) return undefined;
  const normalized = (unit ?? "").toLowerCase();
  if (normalized.includes("mm") || normalized.includes("мм")) return Math.round(value);
  if (normalized.includes("cm") || normalized.includes("см")) return Math.round(value * 10);
  if (normalized.includes("m") || normalized.includes("м")) return Math.round(value * 1000);
  return Math.round(value);
}

function normalizePostingPayload(posting: OzonPosting, externalByOfferId: Map<string, ExternalProduct>) {
  const products = posting.products ?? posting.financial_data?.products ?? [];
  const lines = products.map((product) => {
    const offerId = normalizeSku(product.offer_id);
    return {
      sku: offerId ? externalByOfferId.get(offerId)?.externalSku ?? offerId : String(product.sku ?? ""),
      name: product.name,
      qty: Number(product.quantity ?? 1),
      amountRub: Number(product.price ?? 0)
    };
  });
  const amountRub = lines.reduce((sum, line) => sum + line.amountRub * line.qty, 0);
  return {
    source: "ozon-seller-api",
    postingNumber: posting.posting_number,
    status: posting.status,
    lines,
    sku: lines[0]?.sku,
    qty: lines[0]?.qty ?? 1,
    amountRub
  };
}

function normalizeFinancePayload(operation: OzonFinanceOperation) {
  return {
    source: "ozon-seller-api",
    operationId: operation.operation_id,
    operationType: operation.operation_type,
    operationTypeName: operation.operation_type_name,
    postingNumber: operation.posting?.posting_number,
    amountRub: Math.abs(Number(operation.amount ?? 0)),
    signedAmountRub: Number(operation.amount ?? 0),
    saleAmountRub: Number(operation.accruals_for_sale ?? 0),
    commissionRub: Math.abs(Number(operation.sale_commission ?? 0)),
    services: operation.services ?? [],
    items: operation.items ?? [],
    kind: financeEventKind(operation)
  };
}

export function expandOzonFinanceEvents(operation: OzonFinanceOperation): OzonExpandedFinanceEvent[] {
  const eventType = financeEventType(operation);
  const baseExternalId = `ozon-finance-${operation.operation_id ?? `${operation.operation_date}-${operation.operation_type}`}`;
  const basePayload = normalizeFinancePayload(operation);
  const saleComponents = expandSaleSettlementComponents(operation, basePayload, baseExternalId);
  if (saleComponents.length > 0) return saleComponents;
  if (!eventType) return [];
  return [{ eventType, externalId: baseExternalId, payload: basePayload }];
}

function financeEventType(operation: OzonFinanceOperation): "fee" | "payout" | undefined {
  const operationType = String(operation.operation_type ?? "").trim();
  const type = `${operation.operation_type ?? ""} ${operation.operation_type_name ?? ""}`.toLowerCase();
  const hasSettlementBreakdown = Number(operation.accruals_for_sale ?? 0) > 0 || Number(operation.sale_commission ?? 0) !== 0;
  const explicitRoute = EXACT_FINANCE_OPERATION_ROUTES[operationType];
  if (explicitRoute === "expand_only") return undefined;
  if (explicitRoute) return explicitRoute;
  if (hasSettlementBreakdown || type.includes("sale") || type.includes("продаж")) return undefined;
  return "fee";
}

function financeEventKind(operation: OzonFinanceOperation) {
  const type = `${operation.operation_type ?? ""} ${operation.operation_type_name ?? ""}`.toLowerCase();
  if (type.includes("delivery") || type.includes("logistic") || type.includes("достав")) return "logistics";
  if (type.includes("penalty") || type.includes("штраф")) return "penalty";
  if (type.includes("compensation") || type.includes("компенсац")) return "compensation";
  return "commission";
}

function expandSaleSettlementComponents(
  operation: OzonFinanceOperation,
  basePayload: Record<string, unknown>,
  baseExternalId: string
): OzonExpandedFinanceEvent[] {
  const saleAmountRub = Number(operation.accruals_for_sale ?? 0);
  const type = `${operation.operation_type ?? ""} ${operation.operation_type_name ?? ""}`.toLowerCase();
  const isReturn = type.includes("return") || type.includes("возврат");
  const saleTreatment = isReturn ? "return_variable" : "sale_variable";
  const components: OzonExpandedFinanceEvent[] = [];
  const signedCommissionRub = Number(operation.sale_commission ?? 0);
  if (saleAmountRub <= 0 && signedCommissionRub === 0) return components;

  if (!isReturn && saleAmountRub > 0) {
    components.push({
      eventType: "sale_accrual",
      externalId: `${baseExternalId}-sale-accrual`,
      payload: {
        ...basePayload,
        amountRub: saleAmountRub,
        componentSource: "accruals_for_sale",
        componentTreatment: "sale_variable"
      }
    });
  }

  if (signedCommissionRub < 0) {
    components.push({
      eventType: "fee",
      externalId: `${baseExternalId}-commission`,
      payload: {
        ...basePayload,
        amountRub: Math.abs(signedCommissionRub),
        componentEventKind: "commission",
        componentCategory: "commission",
        componentTreatment: saleTreatment,
        operationTypeName: isReturn ? "Вознаграждение Ozon по возврату" : "Вознаграждение Ozon",
        componentSource: "sale_commission"
      }
    });
  }

  (operation.services ?? []).forEach((service, index) => {
    const signedPrice = Number(service.price ?? 0);
    if (!Number.isFinite(signedPrice) || signedPrice >= 0) return;
    const serviceName = String(service.name ?? `service_${index + 1}`).trim() || `service_${index + 1}`;
    components.push({
      eventType: "fee",
      externalId: `${baseExternalId}-service-${slugifyComponentKey(serviceName)}-${index + 1}`,
      payload: {
        ...basePayload,
        amountRub: Math.abs(signedPrice),
        operationTypeName: channelOperationLabel(serviceName, isReturn),
        services: [{ name: serviceName, price: signedPrice }],
        componentSource: "service",
        componentServiceName: serviceName,
        componentTreatment: saleTreatment
      }
    });
  });

  const knownNetRub = round4(saleAmountRub + signedCommissionRub + (operation.services ?? []).reduce((sum, service) => sum + Number(service.price ?? 0), 0));
  const residualRub = round4(Number(operation.amount ?? 0) - knownNetRub);
  if (residualRub < -0.01) {
    components.push({
      eventType: "fee",
      externalId: `${baseExternalId}-other`,
      payload: {
        ...basePayload,
        amountRub: Math.abs(residualRub),
        componentEventKind: "commission",
        componentCategory: "other",
        componentTreatment: saleTreatment,
        operationTypeName: isReturn ? "Прочее удержание Ozon по возврату" : "Прочее удержание Ozon по продаже",
        componentSource: "residual"
      }
    });
  }

  return components;
}

function channelOperationLabel(serviceName: string, isReturn: boolean) {
  if (!serviceName) return isReturn ? "Услуга канала по возврату" : "Услуга канала по продаже";
  const prefix = isReturn ? "Услуга Ozon по возврату" : "Услуга Ozon";
  return `${prefix} · ${serviceName}`;
}

function slugifyComponentKey(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "component";
}

function isReturnPosting(posting: OzonPosting) {
  const marker = [
    posting.status,
    posting.substatus,
    posting.return_status,
    posting.cancellation?.cancel_reason,
    posting.cancellation?.cancellation_type
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return marker.includes("return") || marker.includes("возврат");
}

function parseSince(since?: string, lastSyncAt?: string) {
  const fallback = lastSyncAt ? new Date(lastSyncAt) : new Date("2026-01-01T00:00:00.000Z");
  const value = since ? new Date(`${since.slice(0, 10)}T00:00:00.000Z`) : fallback;
  return Number.isNaN(value.getTime()) ? new Date("2026-01-01T00:00:00.000Z") : value;
}

function ozonDateToIso(value?: string) {
  if (!value) return undefined;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function monthPeriods(from: Date, to: Date) {
  const periods: Array<{ from: Date; to: Date }> = [];
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (cursor <= to) {
    const end = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    periods.push({ from: cursor, to: end < to ? end : to });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return periods;
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function firstImage(productInfo: OzonProductInfo) {
  if (Array.isArray(productInfo.primary_image)) return productInfo.primary_image[0];
  return productInfo.primary_image ?? productInfo.images?.[0];
}

function normalizeSku(value: unknown) {
  return String(value ?? "").trim();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isDemoCredentials(credentials?: PluginCredentials) {
  return credentials?.clientId === "demo-client" || credentials?.apiKey === "demo-key";
}

async function syncDemo({ app, channelId, syncRunId, streams, autoLinkProducts }: SyncContext): Promise<SyncResult> {
  const wantStream = (code: string) => !streams || streams.length === 0 || streams.includes(code as any);
  const product = app.state.products[0];
  if (!product) {
    return { pluginCode: "ozon", channelId, status: "completed", stats: { products: 0, events: 0, stocks: 0, sales: 0, finance_events: 0, payouts: 0 }, errors: [] };
  }
  const existing = app.state.externalProducts.find((candidate) => candidate.channelId === channelId && candidate.externalSku === `OZON-${product.sku}`);
  const external = existing ?? app.createExternalProduct({
    channelId,
    externalSku: `OZON-${product.sku}`,
    externalName: `${product.name} / карточка Ozon`
  });
  // Onboarding import passes autoLinkProducts:false — observe the card/stock but leave mapping
  // to an explicit user decision. Ongoing syncs (undefined/true) keep auto-linking.
  if (autoLinkProducts !== false && !app.state.productExternalLinks.some((link) => link.externalProductId === external.id && link.productId === product.id && link.status === "active")) {
    app.linkExternalProduct({ externalProductId: external.id, productId: product.id });
  }
  app.recordObservedStock({
    channelId,
    externalProductId: external.id,
    observedAt: "2026-06-19T12:00:00.000Z",
    qtyObserved: 195
  });
  await app.ingestExternalEvent({
    channelId,
    syncRunId,
    eventType: "sale",
    externalId: "ozon-sale-demo-1",
    occurredAt: "2026-06-19T13:20:00.000Z",
    payload: {
      postingNumber: "OZON-DEMO-POSTING-1",
      sku: external.externalSku,
      qty: 1,
      amountRub: 990,
      source: "ozon-demo-adapter"
    }
  });
  await app.ingestExternalEvent({
    channelId,
    syncRunId,
    eventType: "fee",
    externalId: "ozon-fee-demo-1",
    occurredAt: "2026-06-19T13:22:00.000Z",
    payload: {
      postingNumber: "OZON-DEMO-POSTING-1",
      operationType: "sale_commission",
      operationTypeName: "Комиссия за продажу",
      amountRub: 145,
      commissionRub: 145,
      source: "ozon-demo-adapter"
    }
  });
  return {
    pluginCode: "ozon",
    channelId,
    status: "completed",
    stats: { products: 1, events: 2, stocks: 1, sales: 1, finance_events: 1, payouts: 0 },
    errors: []
  };
}

async function planOzonDispatchFromReceipt(input: DispatchPlanningInput): Promise<DispatchPlan> {
  const notes: string[] = [];
  const warnings: string[] = [];
  const useLiveApi = Boolean(input.credentials?.clientId && input.credentials?.apiKey && !isDemoCredentials(input.credentials));
  let sellerWarehouses: OzonSellerWarehouse[] = [];
  let destinations: DispatchPlanDestination[] = [];
  let infoByOfferId = new Map<string, OzonProductInfo>();

  if (useLiveApi) {
    try {
      const [warehouses, productInfo, clusters] = await Promise.all([
        fetchOzonSellerWarehouses(input.credentials!),
        loadProductInfoByOfferIds(input.credentials!, input.lines.flatMap((line) => line.offerIds)),
        fetchOzonClusters(input.credentials!)
      ]);
      sellerWarehouses = warehouses;
      infoByOfferId = productInfo;
      destinations = clusters;
      notes.push("Кластеры и seller-склады загружены из Ozon Seller API.");
    } catch (error) {
      warnings.push(`Не удалось загрузить live-данные Ozon, используем offline-план: ${errorMessage(error)}`);
    }
  } else {
    notes.push("План собран без live-запроса к Ozon. Внутреннее распределение можно подготовить сразу и позже пересобрать с рабочими cred-ами.");
  }

  if (destinations.length === 0) {
    destinations = buildFallbackOzonDestinations(input.lines);
    notes.push("Для распределения используем локальный базовый набор кластеров Ozon.");
  }

  if (sellerWarehouses.length === 0) {
    sellerWarehouses = buildFallbackSellerWarehouses();
  }

  const lines: DispatchPlanLine[] = input.lines.map((line) => {
    const offerInfos = line.offerIds.map((offerId) => infoByOfferId.get(offerId)).filter(Boolean) as OzonProductInfo[];
    const marketplaceSkus = Array.from(new Set(
      offerInfos
        .flatMap((item) => [Number(item.sku ?? 0), Number(item.id ?? 0)])
        .filter((value) => Number.isFinite(value) && value > 0)
    ));
    const lineWarnings: string[] = [];
    if (line.offerIds.length === 0) {
      lineWarnings.push("Нет связанной карточки Ozon. Внешнюю часть отправки придется оформить вручную.");
    }
    if (line.availableQtyAtSource < line.qty) {
      lineWarnings.push("На исходном складе недостаточно книжного остатка для всей строки.");
    }
    if (useLiveApi && line.offerIds.length > 0 && marketplaceSkus.length === 0) {
      lineWarnings.push("Ozon не вернул marketplace SKU для выбранной карточки. План остается доступным, но без внешнего SKU.");
    }
    return {
      ...line,
      marketplaceSkus,
      placementZone: null,
      warnings: lineWarnings
    };
  });

  warnings.push(...lines.flatMap((line) => line.warnings ?? []));

  return {
    mode: "channel_allocation",
    notes,
    warnings,
    defaultSelectedDestinationIds: destinations.slice(0, 3).map((destination) => destination.id),
    sourceWarehouseId: input.sourceWarehouseId,
    salesPointWarehouseId: input.salesPointWarehouseId,
    lines,
    destinations,
    sellerWarehouses
  };
}

function autoAllocateOzonDispatch(input: DispatchAutoAllocateInput): DispatchAutoAllocateResult {
  const result = buildSuggestedMarketplaceAllocations({
    selectedDestinationIds: input.selectedDestinationIds,
    items: input.plan.lines.map((line) => ({
      itemId: line.itemId,
      totalQty: line.qty,
      minClusterQty: line.qty >= input.selectedDestinationIds.length ? 1 : 0,
      destinations: input.plan.destinations.map((destination) => ({
        destinationId: destination.id,
        recommendedQty: Number(destination.recommendedQty ?? 0),
        demand30dQty: Number(destination.demand30dQty ?? 0),
        averageDeliveryHours: destination.averageDeliveryHours ?? null,
        attentionLevel: destination.attentionLevel ?? null
      }))
    }))
  });

  const allocationsByDestination = new Map<string, Array<{ itemId: string; qty: number }>>();
  for (const allocation of result.allocations) {
    const bucket = allocationsByDestination.get(allocation.destinationId) ?? [];
    bucket.push({ itemId: allocation.itemId, qty: allocation.qty });
    allocationsByDestination.set(allocation.destinationId, bucket);
  }

  return {
    allocations: Array.from(allocationsByDestination.entries()).map(([destinationId, lines]) => ({ destinationId, lines })),
    notes: result.notes,
    errors: result.errors
  };
}

async function loadProductInfoByOfferIds(credentials: PluginCredentials, offerIds: string[]) {
  const uniqueOfferIds = Array.from(new Set(offerIds.map((offerId) => offerId.trim()).filter(Boolean)));
  const infoByOfferId = new Map<string, OzonProductInfo>();
  for (const chunk of chunks(uniqueOfferIds, 1000)) {
    const response = await ozonRequest<{ items?: OzonProductInfo[] }>(credentials, "/v3/product/info/list", { offer_id: chunk });
    for (const item of response.items ?? []) {
      const offerId = normalizeSku(item.offer_id);
      if (offerId) infoByOfferId.set(offerId, item);
    }
  }
  return infoByOfferId;
}

async function fetchOzonSellerWarehouses(credentials: PluginCredentials): Promise<OzonSellerWarehouse[]> {
  const response = await ozonRequest<Record<string, unknown>>(credentials, "/v1/warehouse/fbo/seller/list", {});
  const rows = arrayFromUnknown(response.warehouses ?? response.result ?? response);
  return rows
    .map((row) => {
      const item = row as Record<string, unknown>;
      const address = asRecord(item.address);
      const id = pickFirstString(item.seller_warehouse_id, item.id);
      const title = pickFirstString(item.seller_warehouse_name, item.name);
      if (!id || !title) return null;
      return {
        id,
        title,
        isActive: Boolean(item.is_active ?? true),
        isPickup: Boolean(item.is_pickup),
        region: pickFirstString(address?.region) ?? null,
        address: pickFirstString(address?.address) ?? null,
        macrolocalClusterId: positiveInteger(address?.macrolocal_cluster_id) ?? null
      } satisfies OzonSellerWarehouse;
    })
    .filter(Boolean) as OzonSellerWarehouse[];
}

async function fetchOzonClusters(credentials: PluginCredentials): Promise<DispatchPlanDestination[]> {
  const response = await ozonRequest<Record<string, unknown>>(credentials, "/v1/cluster/list", {});
  const rows = arrayFromUnknown(response.clusters ?? response.result ?? response.items ?? response);
  return rows
    .map((row) => {
      const item = row as Record<string, unknown>;
      const clusterId = positiveInteger(item.cluster_id ?? item.id ?? item.clusterId);
      const title = pickFirstString(item.name, item.title, item.cluster_name, item.clusterName);
      if (!clusterId || !title) return null;
      return {
        id: `cluster:${clusterId}`,
        title,
        clusterName: pickFirstString(item.cluster_name, item.clusterName, item.region_name) ?? title,
        deliveryMacrolocalClusterId: clusterId,
        recommendedQty: positiveNumber(item.recommended_qty ?? item.recommendedQty) ?? 0,
        demand30dQty: positiveNumber(item.demand_30d_qty ?? item.demand30dQty) ?? 0,
        averageDeliveryHours: positiveNumber(item.avg_delivery_hours ?? item.average_delivery_hours) ?? null,
        attentionLevel: pickFirstString(item.attention_level, item.attentionLevel) ?? null,
        minClusterQty: 1,
        providerMetadata: { clusterId }
      } satisfies DispatchPlanDestination;
    })
    .filter(Boolean)
    .slice(0, 8) as DispatchPlanDestination[];
}

function buildFallbackSellerWarehouses(): OzonSellerWarehouse[] {
  return [
    {
      id: "fallback-seller-wh-1",
      title: "Склад продавца Ozon",
      isActive: true,
      isPickup: true,
      region: "Москва"
    }
  ];
}

function buildFallbackOzonDestinations(lines: Array<{ qty: number }>): DispatchPlanDestination[] {
  const totalQty = Math.max(1, lines.reduce((sum, line) => sum + Math.max(0, Number(line.qty ?? 0)), 0));
  return [
    {
      id: "cluster:center",
      title: "Центр",
      clusterName: "Центральный кластер",
      deliveryMacrolocalClusterId: 101,
      recommendedQty: round4(totalQty * 0.45),
      demand30dQty: round4(totalQty * 0.48),
      averageDeliveryHours: 18,
      attentionLevel: "high",
      minClusterQty: 1
    },
    {
      id: "cluster:northwest",
      title: "Северо-Запад",
      clusterName: "Северо-Западный кластер",
      deliveryMacrolocalClusterId: 102,
      recommendedQty: round4(totalQty * 0.3),
      demand30dQty: round4(totalQty * 0.26),
      averageDeliveryHours: 26,
      attentionLevel: "medium",
      minClusterQty: 1
    },
    {
      id: "cluster:east",
      title: "Урал и Сибирь",
      clusterName: "Восточный кластер",
      deliveryMacrolocalClusterId: 103,
      recommendedQty: round4(totalQty * 0.25),
      demand30dQty: round4(totalQty * 0.22),
      averageDeliveryHours: 40,
      attentionLevel: "medium",
      minClusterQty: 1
    }
  ];
}

function arrayFromUnknown(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function positiveInteger(value: unknown) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function positiveNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}
