export const documentStatusLabel: Record<string, string> = {
  draft: "Черновик",
  posted: "Проведён",
  cancelled: "Отменён",
  corrected: "Исправлен",
  reversed: "Сторнирован"
};

export const documentStatusTone: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  draft: "neutral",
  posted: "success",
  cancelled: "danger",
  corrected: "info",
  reversed: "warning"
};

export const accountKindLabel: Record<string, string> = {
  asset: "Актив",
  liability: "Пассив",
  equity: "Капитал",
  revenue: "Доход",
  income: "Доход",
  expense: "Расход"
};

export const warehouseTypeLabel: Record<string, string> = {
  own: "Свой склад",
  transit: "В пути",
  sales_point: "Точка продаж"
};

export const stockStateLabel: Record<string, string> = {
  sellable: "Годен к продаже",
  damaged: "Брак",
  lost_pending: "Потеря требует решения",
  reserved: "Зарезервирован"
};

export const channelTypeLabel: Record<string, string> = {
  marketplace: "Маркетплейс",
  manual: "Ручной канал",
  wholesale: "Опт",
  other: "Другой"
};

export const channelStatusLabel: Record<string, string> = {
  active: "Активен",
  disabled: "Отключён",
  needs_setup: "Нужны учётные данные",
  error: "Ошибка",
  available: "Доступен",
  installed: "Установлен"
};

export const paymentTypeLabel: Record<string, string> = {
  owner_contribution: "Пополнение владельцем",
  supplier_payment: "Оплата поставщику",
  procurement_cost_payment: "Расход поставки",
  channel_payout: "Выплата канала",
  operating_expense_payment: "Операционный расход",
  owner_withdrawal: "Изъятие владельцем",
  other_incoming: "Прочее поступление",
  other_outgoing: "Прочее списание"
};

export const paymentDirectionLabel: Record<string, string> = {
  incoming: "Поступление",
  outgoing: "Списание"
};

export const purchaseOrderStatusLabel: Record<string, string> = {
  draft: "Черновик",
  ordered: "Заказан",
  cancelled: "Отменён",
  closed: "Закрыт"
};

export const procurementCostTypeLabel: Record<string, string> = {
  delivery: "Доставка",
  customs: "Таможня",
  packaging: "Упаковка",
  certification: "Сертификация",
  other: "Прочее"
};

export const allocationBasisLabel: Record<string, string> = {
  by_cost: "По стоимости",
  by_weight: "По весу",
  by_unit: "По штукам"
};

export const shortageActionLabel: Record<string, string> = {
  wait_supplier: "Ждать поставщика",
  supplier_claim: "Претензия поставщику",
  loss: "Списать в потери",
  close_without_accounting: "Закрыть без учёта"
};

export const movementTypeLabel: Record<string, string> = {
  opening: "Стартовый остаток",
  receipt: "Приёмка",
  transfer_in: "Перемещение (приход)",
  transfer_out: "Перемещение (расход)",
  sale: "Продажа",
  return: "Возврат",
  adjustment: "Корректировка",
  correction: "Исправление"
};

export const periodStatusLabel: Record<string, string> = {
  open: "Открыт",
  closed: "Закрыт"
};

export const eventStatusLabel: Record<string, string> = {
  new: "Новое",
  ready_for_processing: "Готово к обработке",
  awaiting_sale: "Ждёт продажу",
  processed: "Обработано",
  needs_mapping: "Нужно сопоставить",
  needs_attention: "Нужно внимание",
  ignored: "Игнор",
  failed: "Ошибка"
};

export const observedLocationStatusLabel: Record<string, string> = {
  mapped: "Привязана локация",
  needs_location: "Нужна точка продаж"
};

export const eventKindLabel: Record<string, string> = {
  commission: "Комиссия",
  logistics: "Логистика",
  penalty: "Штраф",
  compensation: "Компенсация"
};

export const userStatusLabel: Record<string, string> = {
  invited: "Приглашён",
  active: "Активен",
  disabled: "Отключён",
  revoked: "Отозван"
};

export const taxModeLabel: Record<string, string> = {
  usn_income: "УСН доходы",
  usn_income_expense: "УСН доходы минус расходы",
  osn: "ОСН",
  patent: "Патент",
  unknown: "Не указан"
};

export const legalFormLabel: Record<string, string> = {
  ip: "ИП",
  ooo: "ООО",
  self_employed: "Самозанятый",
  other: "Другое"
};

export function tr(map: Record<string, string>, key: string | undefined | null): string {
  if (!key) return "—";
  return map[key] ?? key;
}
