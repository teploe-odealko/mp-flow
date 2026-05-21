import type { AppState } from "@/layout/AppShell";
import { procurementCostTypeLabel } from "@/lib/i18n";

export type FinanceOperationKind =
  | "operating_expense"
  | "procurement_cost"
  | "supplier_payment"
  | "owner_contribution"
  | "owner_withdrawal"
  | "payout";

export type FinanceOperationView = "all" | "outgoing" | "incoming" | "attention";
export type FinanceOperationTypeFilter =
  | "all"
  | "expense_like"
  | "owner"
  | FinanceOperationKind;
export type FinanceOperationStatusFilter =
  | "all"
  | "draft"
  | "ready"
  | "needs_payment"
  | "completed"
  | "needs_reconciliation";

export interface FinanceOperation {
  id: string;
  kind: FinanceOperationKind;
  date: string;
  direction: "incoming" | "outgoing";
  amountRub: number;
  title: string;
  subtitle?: string;
  sourceLabel?: string;
  effectLabel: string;
  statusKey: Exclude<FinanceOperationStatusFilter, "all"> | "cancelled";
  statusLabel: string;
  statusTone: "success" | "warning" | "danger" | "neutral" | "info";
  typeLabel: string;
  typeTone: "success" | "warning" | "danger" | "neutral" | "info" | "primary";
  primaryHref: string;
  documentHref?: string;
  documentNumber?: string;
  postAction?: { endpoint: string; label: string };
  needsAttention: boolean;
}

export function buildFinanceOperations(state: AppState): FinanceOperation[] {
  const documents = state.documents ?? [];
  const payments = state.payments ?? [];
  const paymentAllocations = state.paymentAllocations ?? [];
  const counterparties = state.counterparties ?? [];
  const channels = state.salesChannels ?? [];
  const purchaseOrders = state.purchaseOrders ?? [];
  const expenseCategories = state.expenseCategories ?? [];
  const ownerTransactions = state.ownerTransactions ?? [];
  const operatingExpenses = state.operatingExpenses ?? [];
  const procurementCosts = state.procurementCosts ?? [];
  const payouts = state.payouts ?? [];

  const documentsById = new Map<string, any>(documents.map((item: any) => [item.id, item]));
  const paymentsById = new Map<string, any>(payments.map((item: any) => [item.id, item]));
  const counterpartiesById = new Map<string, any>(counterparties.map((item: any) => [item.id, item]));
  const channelsById = new Map<string, any>(channels.map((item: any) => [item.id, item]));
  const ordersById = new Map<string, any>(purchaseOrders.map((item: any) => [item.id, item]));
  const categoriesById = new Map<string, any>(expenseCategories.map((item: any) => [item.id, item]));
  const allocationsByPaymentId = new Map<string, any[]>();

  for (const allocation of paymentAllocations) {
    const bucket = allocationsByPaymentId.get(allocation.paymentId) ?? [];
    bucket.push(allocation);
    allocationsByPaymentId.set(allocation.paymentId, bucket);
  }

  const operations: FinanceOperation[] = [];

  for (const expense of operatingExpenses) {
    const document = documentsById.get(expense.documentId);
    const category = categoriesById.get(expense.categoryId);
    const counterparty = expense.counterpartyId ? counterpartiesById.get(expense.counterpartyId) : undefined;
    let statusKey: FinanceOperation["statusKey"] = "draft";
    let statusLabel = "Черновик";
    let statusTone: FinanceOperation["statusTone"] = "neutral";

    if (document?.status === "cancelled") {
      statusKey = "cancelled";
      statusLabel = "Отменено";
      statusTone = "danger";
    } else if (expense.paymentStatus === "draft") {
      statusKey = "draft";
      statusLabel = "Черновик";
      statusTone = "neutral";
    } else if (expense.paymentStatus === "unpaid") {
      statusKey = "needs_payment";
      statusLabel = "К оплате";
      statusTone = "warning";
    } else if (expense.paymentMode === "without_payment") {
      statusKey = "completed";
      statusLabel = "Без оплаты";
      statusTone = "info";
    } else {
      statusKey = "completed";
      statusLabel = "Оплачено";
      statusTone = "success";
    }

    operations.push({
      id: expense.id,
      kind: "operating_expense",
      date: expense.expenseDate,
      direction: "outgoing",
      amountRub: Number(expense.amountRub ?? 0),
      title: "Расход компании",
      subtitle: category?.name ?? "Операционный расход",
      sourceLabel: counterparty?.name ?? "Без контрагента",
      effectLabel: "Расход периода",
      statusKey,
      statusLabel,
      statusTone,
      typeLabel: "Расход компании",
      typeTone: "warning",
      primaryHref: `/finance/expenses/${expense.id}`,
      documentHref: document ? `/documents/${document.id}` : undefined,
      documentNumber: document?.number,
      postAction: statusKey === "draft" ? { endpoint: `/api/finance/expenses/${expense.id}/post`, label: "Провести" } : undefined,
      needsAttention: statusKey === "draft" || statusKey === "needs_payment"
    });
  }

  for (const cost of procurementCosts) {
    const document = documentsById.get(cost.documentId);
    const order = cost.purchaseOrderId ? ordersById.get(cost.purchaseOrderId) : undefined;
    const orderDocument = order ? documentsById.get(order.documentId) : undefined;
    const supplier = order?.supplierId ? counterpartiesById.get(order.supplierId) : undefined;
    let statusKey: FinanceOperation["statusKey"] = "draft";
    let statusLabel = "Черновик";
    let statusTone: FinanceOperation["statusTone"] = "neutral";

    if (document?.status === "cancelled" || cost.status === "cancelled") {
      statusKey = "cancelled";
      statusLabel = "Отменено";
      statusTone = "danger";
    } else if (cost.status === "draft") {
      statusKey = "draft";
      statusLabel = "Черновик";
      statusTone = "neutral";
    } else if (cost.paidImmediately) {
      statusKey = "completed";
      statusLabel = "Оплачено";
      statusTone = "success";
    } else {
      statusKey = "needs_payment";
      statusLabel = "К оплате";
      statusTone = "warning";
    }

    operations.push({
      id: cost.id,
      kind: "procurement_cost",
      date: cost.costDate,
      direction: "outgoing",
      amountRub: Number(cost.amountRub ?? 0),
      title: "Расход поставки",
      subtitle: procurementCostTypeLabel[cost.costType] ?? "Дополнительный расход",
      sourceLabel: [orderDocument?.number, supplier?.name].filter(Boolean).join(" · ") || "Без заказа поставщику",
      effectLabel: "Увеличивает себестоимость товара",
      statusKey,
      statusLabel,
      statusTone,
      typeLabel: "Расход поставки",
      typeTone: "info",
      primaryHref: order ? `/procurement/purchase-orders/${order.id}` : `/documents/${cost.documentId}`,
      documentHref: document ? `/documents/${document.id}` : undefined,
      documentNumber: document?.number,
      postAction: statusKey === "draft" ? { endpoint: `/api/procurement/costs/${cost.id}/post`, label: "Провести" } : undefined,
      needsAttention: statusKey === "draft" || statusKey === "needs_payment"
    });
  }

  for (const payment of payments.filter((candidate: any) => candidate.paymentType === "supplier_payment")) {
    const document = documentsById.get(payment.documentId);
    const allocation = (allocationsByPaymentId.get(payment.id) ?? []).find((item: any) => item.allocationPurpose === "goods_purchase");
    const order = allocation?.purchaseOrderId ? ordersById.get(allocation.purchaseOrderId) : undefined;
    const orderDocument = order ? documentsById.get(order.documentId) : undefined;
    const supplier = payment.counterpartyId ? counterpartiesById.get(payment.counterpartyId) : undefined;
    let statusKey: FinanceOperation["statusKey"] = "draft";
    let statusLabel = "Черновик";
    let statusTone: FinanceOperation["statusTone"] = "neutral";

    if (document?.status === "cancelled") {
      statusKey = "cancelled";
      statusLabel = "Отменено";
      statusTone = "danger";
    } else if (document?.status === "posted") {
      statusKey = "completed";
      statusLabel = "Оплачено";
      statusTone = "success";
    }

    operations.push({
      id: payment.id,
      kind: "supplier_payment",
      date: payment.paidAt,
      direction: "outgoing",
      amountRub: Number(payment.amountRub ?? 0),
      title: "Оплата поставщику",
      subtitle: orderDocument?.number ?? "Платеж поставщику",
      sourceLabel: supplier?.name ?? "Без поставщика",
      effectLabel: "Аванс поставщику",
      statusKey,
      statusLabel,
      statusTone,
      typeLabel: "Оплата поставщику",
      typeTone: "warning",
      primaryHref: order ? `/procurement/purchase-orders/${order.id}` : `/documents/${payment.documentId}`,
      documentHref: document ? `/documents/${document.id}` : undefined,
      documentNumber: document?.number,
      postAction: statusKey === "draft" ? { endpoint: `/api/payments/${payment.id}/post`, label: "Провести" } : undefined,
      needsAttention: statusKey === "draft"
    });
  }

  for (const transaction of ownerTransactions) {
    const payment = paymentsById.get(transaction.paymentId);
    const document = documentsById.get(transaction.documentId);
    const direction = transaction.transactionType === "contribution" ? "incoming" : "outgoing";
    let statusKey: FinanceOperation["statusKey"] = "completed";
    let statusLabel = direction === "incoming" ? "Поступило" : "Оплачено";
    let statusTone: FinanceOperation["statusTone"] = direction === "incoming" ? "success" : "warning";
    let postAction: FinanceOperation["postAction"];

    if (document?.status === "cancelled") {
      statusKey = "cancelled";
      statusLabel = "Отменено";
      statusTone = "danger";
    } else if (document?.status !== "posted" && transaction.transactionType === "contribution") {
      statusKey = "draft";
      statusLabel = "Черновик";
      statusTone = "neutral";
      postAction = payment ? { endpoint: `/api/payments/${payment.id}/post`, label: "Провести" } : undefined;
    }

    operations.push({
      id: transaction.id,
      kind: transaction.transactionType === "contribution" ? "owner_contribution" : "owner_withdrawal",
      date: payment?.paidAt ?? document?.accountingDate ?? "",
      direction,
      amountRub: Number(transaction.amountRub ?? payment?.amountRub ?? 0),
      title: transaction.transactionType === "contribution" ? "Пополнение владельцем" : "Вывод владельцу",
      subtitle: payment?.comment ?? undefined,
      sourceLabel: "Владелец",
      effectLabel: transaction.transactionType === "contribution" ? "Средства владельца" : "Изъятие средств владельца",
      statusKey,
      statusLabel,
      statusTone,
      typeLabel: transaction.transactionType === "contribution" ? "Пополнение" : "Вывод владельца",
      typeTone: transaction.transactionType === "contribution" ? "success" : "neutral",
      primaryHref: document ? `/documents/${document.id}` : "/money",
      documentHref: document ? `/documents/${document.id}` : undefined,
      documentNumber: document?.number,
      postAction,
      needsAttention: statusKey === "draft"
    });
  }

  for (const payout of payouts) {
    const document = documentsById.get(payout.documentId);
    const channel = channelsById.get(payout.channelId);
    let statusKey: FinanceOperation["statusKey"] = "draft";
    let statusLabel = "Черновик";
    let statusTone: FinanceOperation["statusTone"] = "neutral";
    let postAction: FinanceOperation["postAction"];

    if (document?.status === "cancelled" || payout.status === "reversed") {
      statusKey = "cancelled";
      statusLabel = "Отменено";
      statusTone = "danger";
    } else if (payout.status === "needs_reconciliation" || Number(payout.differenceRub ?? 0) !== 0) {
      statusKey = "needs_reconciliation";
      statusLabel = "Нужна сверка";
      statusTone = "warning";
    } else if (payout.status === "ready") {
      statusKey = "ready";
      statusLabel = "Готово провести";
      statusTone = "info";
      if (Number(payout.differenceRub ?? 0) === 0 || payout.differenceAccepted) {
        postAction = { endpoint: `/api/finance/payouts/${payout.id}/post`, label: "Провести" };
      }
    } else if (payout.status === "posted" || payout.status === "reconciled") {
      statusKey = "completed";
      statusLabel = "Получено";
      statusTone = "success";
    }

    operations.push({
      id: payout.id,
      kind: "payout",
      date: payout.payoutDate,
      direction: "incoming",
      amountRub: Number(payout.bankReceiptRub ?? payout.expectedAmountRub ?? payout.grossEventsRub ?? 0),
      title: "Поступление от маркетплейса",
      subtitle: payout.externalPayoutId ?? payout.id,
      sourceLabel: channel?.name ?? "Канал продаж",
      effectLabel: "Закрывает расчеты с маркетплейсом",
      statusKey,
      statusLabel,
      statusTone,
      typeLabel: "Выплата маркетплейса",
      typeTone: "success",
      primaryHref: `/finance/payouts/${payout.id}/reconciliation`,
      documentHref: document ? `/documents/${document.id}` : undefined,
      documentNumber: document?.number,
      postAction,
      needsAttention: statusKey === "draft" || statusKey === "ready" || statusKey === "needs_reconciliation"
    });
  }

  return operations
    .filter((item) => item.date)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

export function matchesFinanceView(operation: FinanceOperation, view: FinanceOperationView) {
  if (view === "incoming") return operation.direction === "incoming";
  if (view === "outgoing") return operation.direction === "outgoing";
  if (view === "attention") return operation.needsAttention;
  return true;
}

export function matchesFinanceType(operation: FinanceOperation, type: FinanceOperationTypeFilter) {
  if (type === "all") return true;
  if (type === "expense_like") return operation.kind === "operating_expense" || operation.kind === "procurement_cost";
  if (type === "owner") return operation.kind === "owner_contribution" || operation.kind === "owner_withdrawal";
  return operation.kind === type;
}

export function matchesFinanceStatus(operation: FinanceOperation, status: FinanceOperationStatusFilter) {
  if (status === "all") return true;
  return operation.statusKey === status;
}

export function sumOperationAmounts(operations: FinanceOperation[]) {
  return round2(operations.reduce((sum, item) => sum + Number(item.amountRub ?? 0), 0));
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
