import type { ChannelFinanceEvent } from "../core/models";

export type ChannelFinanceTreatment = NonNullable<ChannelFinanceEvent["treatment"]>;
export type ChannelFinanceCategory = NonNullable<ChannelFinanceEvent["category"]>;
export type ChannelFinanceKind = ChannelFinanceEvent["eventKind"];

type FinanceClassification = {
  eventKind: ChannelFinanceKind;
  treatment: ChannelFinanceTreatment;
  category: ChannelFinanceCategory;
};

type FinancePayloadContext = {
  operationType: string;
  operationTypeName: string;
  serviceNames: string[];
  itemNames: string[];
  haystack: string;
  hasPostingNumber: boolean;
  hasSaleCommission: boolean;
  isReturn: boolean;
};

const AD_PATTERNS = ["реклам", "advert", "promo", "trafaret", "трафарет", "banner", "search promotion", "продвиж"];
const STORAGE_PATTERNS = ["хранен", "storage", "warehouse storage", "fee for placement", "размещен"];
const CROSS_DOCK_PATTERNS = ["cross", "кросс", "dock", "докинг"];
const INBOUND_PATTERNS = ["прием", "accept", "inbound", "handling", "подготов", "prep", "маркиров", "label"];
const SUBSCRIPTION_PATTERNS = ["подпис", "subscription", "tariff", "тариф", "premium", "plus"];
const ACQUIRING_PATTERNS = ["эквайр", "acquir", "processing", "payment", "платеж"];
const RETURN_PATTERNS = ["return", "возврат"];
const LOGISTICS_PATTERNS = ["delivery", "logistic", "достав", "последн", "mile", "shipping", "перевоз"];
const PENALTY_PATTERNS = ["penalty", "штраф", "fine"];
const COMPENSATION_PATTERNS = ["compensation", "компенсац"];

const EXACT_OPERATION_RULES: Record<string, (ctx: FinancePayloadContext) => FinanceClassification> = {
  MarketplaceRedistributionOfAcquiringOperation: (ctx) => ({
    eventKind: "commission",
    category: "acquiring",
    treatment: ctx.hasPostingNumber ? "sale_variable" : "channel_operating"
  }),
  OperationMarketplaceCostPerClick: () => ({
    eventKind: "commission",
    category: "ads",
    treatment: "channel_operating"
  }),
  OperationPointsForReviews: () => ({
    eventKind: "commission",
    category: "ads",
    treatment: "channel_operating"
  }),
  OperationMarketplaceAcceleratedProductReviews: () => ({
    eventKind: "commission",
    category: "ads",
    treatment: "channel_operating"
  }),
  CustomerReviews: () => ({
    eventKind: "commission",
    category: "subscription",
    treatment: "channel_operating"
  }),
  OperationSubscriptionPremium: () => ({
    eventKind: "commission",
    category: "subscription",
    treatment: "channel_operating"
  }),
  OperationMarketplaceSupplyAdditional: () => ({
    eventKind: "logistics",
    category: "inbound_handling",
    treatment: "channel_operating"
  }),
  OperationMarketplaceSupplyExpirationDateProcessing: () => ({
    eventKind: "logistics",
    category: "inbound_handling",
    treatment: "channel_operating"
  }),
  OperationMarketplaceServiceSupplyInboundCargoShortage: () => ({
    eventKind: "logistics",
    category: "inbound_handling",
    treatment: "channel_operating"
  }),
  OperationMarketplaceItemTemporaryStorageRedistribution: () => ({
    eventKind: "commission",
    category: "storage",
    treatment: "channel_operating"
  }),
  InsuranceServiceSellerItem: () => ({
    eventKind: "commission",
    category: "other",
    treatment: "channel_operating"
  }),
  SellerReturnsDeliveryToPickupPoint: () => ({
    eventKind: "logistics",
    category: "other",
    treatment: "channel_operating"
  }),
  DisposalReasonDamagedPackaging: () => ({
    eventKind: "commission",
    category: "other",
    treatment: "channel_operating"
  }),
  DisposalReasonFailedToPickupOnTime: () => ({
    eventKind: "commission",
    category: "other",
    treatment: "channel_operating"
  }),
  OperationSellerReturnsCargoAssortmentInvalid: () => ({
    eventKind: "commission",
    category: "other",
    treatment: "channel_operating"
  }),
  MarketplaceSellerInstallmentOperation: (ctx) => ({
    eventKind: "commission",
    category: "commission",
    treatment: ctx.hasPostingNumber ? "sale_variable" : "channel_operating"
  })
};

const EXACT_SERVICE_RULES: Record<string, (ctx: FinancePayloadContext) => FinanceClassification> = {
  MarketplaceServiceItemCrossdocking: () => ({
    eventKind: "logistics",
    category: "cross_docking",
    treatment: "channel_operating"
  }),
  MarketplaceServiceItemTemporaryStorageRedistribution: () => ({
    eventKind: "commission",
    category: "storage",
    treatment: "channel_operating"
  }),
  MarketplaceServiceItemDisposalDetailed: () => ({
    eventKind: "commission",
    category: "other",
    treatment: "channel_operating"
  }),
  MarketplaceServiceProductMovementFromWarehouse: () => ({
    eventKind: "logistics",
    category: "other",
    treatment: "channel_operating"
  }),
  MarketplaceServiceItemInstallment: (ctx) => ({
    eventKind: "commission",
    category: "commission",
    treatment: ctx.hasPostingNumber ? "sale_variable" : "channel_operating"
  }),
  MarketplaceServiceItemDirectFlowLogistic: (ctx) => saleLogisticsClassification(ctx),
  MarketplaceServiceItemRedistributionLastMileCourier: (ctx) => saleLogisticsClassification(ctx),
  MarketplaceServiceItemDeliveryToHandoverPlaceOzon: (ctx) => saleLogisticsClassification(ctx)
};

export function classifyChannelFinancePayload(payload: Record<string, unknown>): FinanceClassification {
  const explicitKind = asFinanceKind(payload.componentEventKind ?? payload.kind);
  const explicitCategory = asFinanceCategory(payload.componentCategory);
  const explicitTreatment = asFinanceTreatment(payload.componentTreatment);
  if (explicitKind && explicitCategory && explicitTreatment) {
    return { eventKind: explicitKind, category: explicitCategory, treatment: explicitTreatment };
  }

  const ctx = buildPayloadContext(payload);

  const exactOperationRule = EXACT_OPERATION_RULES[ctx.operationType];
  if (exactOperationRule) return exactOperationRule(ctx);

  for (const serviceName of ctx.serviceNames) {
    const exactServiceRule = EXACT_SERVICE_RULES[serviceName];
    if (exactServiceRule) return exactServiceRule(ctx);
  }

  if (includesAny(ctx.haystack, COMPENSATION_PATTERNS)) {
    return { eventKind: "compensation", category: "compensation", treatment: "other_income" };
  }
  if (includesAny(ctx.haystack, PENALTY_PATTERNS)) {
    return { eventKind: "penalty", category: "penalty", treatment: "other_expense" };
  }
  if (includesAny(ctx.haystack, AD_PATTERNS)) {
    return { eventKind: "commission", category: "ads", treatment: "channel_operating" };
  }
  if (includesAny(ctx.haystack, STORAGE_PATTERNS)) {
    return { eventKind: "commission", category: "storage", treatment: "channel_operating" };
  }
  if (includesAny(ctx.haystack, CROSS_DOCK_PATTERNS)) {
    return { eventKind: "logistics", category: "cross_docking", treatment: "channel_operating" };
  }
  if (includesAny(ctx.haystack, INBOUND_PATTERNS)) {
    return { eventKind: "logistics", category: "inbound_handling", treatment: "channel_operating" };
  }
  if (includesAny(ctx.haystack, SUBSCRIPTION_PATTERNS)) {
    return { eventKind: "commission", category: "subscription", treatment: "channel_operating" };
  }
  if (includesAny(ctx.haystack, ACQUIRING_PATTERNS)) {
    return { eventKind: "commission", category: "acquiring", treatment: ctx.hasPostingNumber ? "sale_variable" : "channel_operating" };
  }
  if (includesAny(ctx.haystack, RETURN_PATTERNS) && includesAny(ctx.haystack, LOGISTICS_PATTERNS)) {
    return { eventKind: "logistics", category: "return_logistics", treatment: ctx.hasPostingNumber ? "return_variable" : "channel_operating" };
  }
  if (includesAny(ctx.haystack, LOGISTICS_PATTERNS)) {
    return { eventKind: "logistics", category: "last_mile_logistics", treatment: ctx.hasPostingNumber ? "sale_variable" : "channel_operating" };
  }
  if (ctx.hasPostingNumber || ctx.hasSaleCommission) {
    return {
      eventKind: "commission",
      category: includesAny(ctx.haystack, RETURN_PATTERNS) ? "return_logistics" : "commission",
      treatment: includesAny(ctx.haystack, RETURN_PATTERNS) ? "return_variable" : "sale_variable"
    };
  }
  return { eventKind: "commission", category: "other", treatment: "channel_operating" };
}

export function channelFinanceCategoryLabel(category?: ChannelFinanceCategory | null) {
  if (category === "commission") return "Комиссия";
  if (category === "acquiring") return "Эквайринг";
  if (category === "last_mile_logistics") return "Последняя миля";
  if (category === "return_logistics") return "Логистика возврата";
  if (category === "ads") return "Реклама";
  if (category === "storage") return "Хранение";
  if (category === "cross_docking") return "Кросс-докинг";
  if (category === "inbound_handling") return "Приемка и подготовка";
  if (category === "subscription") return "Подписка";
  if (category === "penalty") return "Штраф";
  if (category === "compensation") return "Компенсация";
  if (category === "other") return "Остальные расходы";
  return "Без категории";
}

export function channelFinanceTreatmentLabel(treatment?: ChannelFinanceTreatment | null) {
  if (treatment === "sale_variable") return "Переменный расход продажи";
  if (treatment === "return_variable") return "Переменный расход возврата";
  if (treatment === "channel_operating") return "Операционный расход канала";
  if (treatment === "inventory_capitalizable") return "Капитализация в запас";
  if (treatment === "other_expense") return "Прочий расход";
  if (treatment === "other_income") return "Прочий доход";
  return "Не определено";
}

export function isVariableMarketplaceTreatment(treatment?: ChannelFinanceTreatment | null) {
  return treatment === "sale_variable" || treatment === "return_variable";
}

export function isChannelOperatingTreatment(treatment?: ChannelFinanceTreatment | null) {
  return treatment === "channel_operating";
}

export function isExpenseFinanceTreatment(treatment?: ChannelFinanceTreatment | null) {
  return Boolean(treatment) && treatment !== "other_income";
}

export function linkedExpenseSaleIds(
  financeEvents: Array<Pick<ChannelFinanceEvent, "status" | "treatment" | "linkedSaleId" | "saleAllocations" | "amountRub">>
) {
  const saleIds = new Set<string>();
  for (const event of financeEvents) {
    if (event.status !== "posted") continue;
    if (!isExpenseFinanceTreatment(event.treatment)) continue;
    for (const allocation of channelFinanceSaleAllocations(event)) {
      if (Number(allocation.amountRub ?? 0) <= 0) continue;
      saleIds.add(allocation.saleId);
    }
  }
  return saleIds;
}

export function channelFinanceSourceOperationName(value: Record<string, unknown> | null | undefined) {
  const operationTypeName = stringValue(value?.operationTypeName);
  if (operationTypeName) return operationTypeName;
  const comment = stringValue(value?.comment);
  if (comment) return comment;
  return "—";
}

export function channelFinanceSourceOperationCode(value: Record<string, unknown> | null | undefined) {
  return stringValue(value?.operationType) || "—";
}

export function channelFinanceSaleAllocations(event: Pick<ChannelFinanceEvent, "linkedSaleId" | "saleAllocations" | "amountRub">) {
  if (Array.isArray(event.saleAllocations) && event.saleAllocations.length > 0) {
    return event.saleAllocations.map((allocation) => ({
      saleId: allocation.saleId,
      amountRub: Number(allocation.amountRub ?? 0)
    }));
  }
  if (event.linkedSaleId) {
    return [{ saleId: event.linkedSaleId, amountRub: Number(event.amountRub ?? 0) }];
  }
  return [];
}

export function channelFinanceAllocatedAmountForSale(
  event: Pick<ChannelFinanceEvent, "linkedSaleId" | "saleAllocations" | "amountRub">,
  saleId: string
) {
  const allocation = channelFinanceSaleAllocations(event).find((row) => row.saleId === saleId);
  return Number(allocation?.amountRub ?? 0);
}

function includesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

function buildPayloadContext(payload: Record<string, unknown>): FinancePayloadContext {
  const serviceNames = arrayOfNames(payload.services).map((value) => String(value ?? "").trim()).filter(Boolean);
  const itemNames = arrayOfNames(payload.items).map((value) => String(value ?? "").trim()).filter(Boolean);
  const operationType = String(payload.operationType ?? "").trim();
  const operationTypeName = String(payload.operationTypeName ?? "").trim();
  const haystack = [operationType, operationTypeName, ...serviceNames, ...itemNames]
    .map((value) => value.toLowerCase())
    .join(" ");
  return {
    operationType,
    operationTypeName,
    serviceNames,
    itemNames,
    haystack,
    hasPostingNumber: Boolean(String(payload.postingNumber ?? "").trim()),
    hasSaleCommission: Number(payload.commissionRub ?? 0) > 0 || Number(payload.saleAmountRub ?? 0) > 0,
    isReturn: includesAny(haystack, RETURN_PATTERNS)
  };
}

function arrayOfNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return [row.name, row.title, row.service, row.type, row.operationTypeName].filter(Boolean);
  });
}

function saleLogisticsClassification(ctx: FinancePayloadContext): FinanceClassification {
  return {
    eventKind: "logistics",
    category: ctx.isReturn ? "return_logistics" : "last_mile_logistics",
    treatment: ctx.hasPostingNumber ? (ctx.isReturn ? "return_variable" : "sale_variable") : "channel_operating"
  };
}

function stringValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "";
}

function asFinanceKind(value: unknown): ChannelFinanceKind | undefined {
  return ["commission", "logistics", "penalty", "compensation"].includes(String(value ?? ""))
    ? (value as ChannelFinanceKind)
    : undefined;
}

function asFinanceCategory(value: unknown): ChannelFinanceCategory | undefined {
  return [
    "commission",
    "acquiring",
    "last_mile_logistics",
    "return_logistics",
    "ads",
    "storage",
    "cross_docking",
    "inbound_handling",
    "subscription",
    "penalty",
    "compensation",
    "other"
  ].includes(String(value ?? ""))
    ? (value as ChannelFinanceCategory)
    : undefined;
}

function asFinanceTreatment(value: unknown): ChannelFinanceTreatment | undefined {
  return [
    "sale_variable",
    "return_variable",
    "channel_operating",
    "inventory_capitalizable",
    "other_expense",
    "other_income"
  ].includes(String(value ?? ""))
    ? (value as ChannelFinanceTreatment)
    : undefined;
}
