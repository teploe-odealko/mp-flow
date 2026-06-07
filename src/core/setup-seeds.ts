import type { ChartAccount, DocumentTypeRegistry, ID } from "./models";
import { id } from "./utils";

const MARKETPLACE_SHIPPED_ACCOUNT_CODE = "45.03";
const MARKETPLACE_SALE_RECOGNITION_DOCUMENT_TYPE = "sale_accrual";

export function seedChartAccounts(organizationId: ID): ChartAccount[] {
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

export function seedDocumentTypes(): DocumentTypeRegistry[] {
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
