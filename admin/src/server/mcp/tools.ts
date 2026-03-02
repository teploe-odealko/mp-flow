export interface ApiToolParam {
  type: "string" | "number" | "boolean" | "object"
  description: string
  required?: boolean
  enum?: string[]
  in: "query" | "path" | "body"
}

export interface ApiTool {
  name: string
  description: string
  method: "GET" | "POST" | "PUT" | "DELETE"
  path: string
  params?: Record<string, ApiToolParam>
}

export const CORE_TOOLS: ApiTool[] = [
  // ── Каталог ──
  {
    name: "list_products",
    description: "Получить список товаров из каталога с поиском и фильтрацией",
    method: "GET",
    path: "/api/catalog",
    params: {
      q: { type: "string", description: "Поиск по названию", in: "query" },
      status: { type: "string", description: "Фильтр по статусу", enum: ["active", "draft", "archived"], in: "query" },
      limit: { type: "number", description: "Лимит записей (default 50)", in: "query" },
      offset: { type: "number", description: "Смещение", in: "query" },
    },
  },
  {
    name: "get_product",
    description: "Получить детали товара по ID: складские остатки, себестоимость, история поставок",
    method: "GET",
    path: "/api/catalog/:id",
    params: {
      id: { type: "string", description: "ID товара", required: true, in: "path" },
    },
  },
  {
    name: "create_product",
    description: "Создать новый товар в каталоге",
    method: "POST",
    path: "/api/catalog",
    params: {
      title: { type: "string", description: "Название товара", required: true, in: "body" },
      description: { type: "string", description: "Описание", in: "body" },
      status: { type: "string", description: "Статус", enum: ["active", "draft", "archived"], in: "body" },
    },
  },
  {
    name: "update_product",
    description: "Обновить данные товара",
    method: "PUT",
    path: "/api/catalog/:id",
    params: {
      id: { type: "string", description: "ID товара", required: true, in: "path" },
      title: { type: "string", description: "Новое название", in: "body" },
      description: { type: "string", description: "Новое описание", in: "body" },
      status: { type: "string", description: "Новый статус", enum: ["active", "draft", "archived"], in: "body" },
    },
  },
  {
    name: "delete_product",
    description: "Удалить товар (soft delete)",
    method: "DELETE",
    path: "/api/catalog/:id",
    params: {
      id: { type: "string", description: "ID товара", required: true, in: "path" },
    },
  },

  // ── Склад ──
  {
    name: "list_inventory",
    description: "Состояние склада: остатки, поступления, продажи, списания по каждому товару",
    method: "GET",
    path: "/api/inventory",
    params: {
      q: { type: "string", description: "Поиск по названию", in: "query" },
      limit: { type: "number", description: "Лимит", in: "query" },
      offset: { type: "number", description: "Смещение", in: "query" },
    },
  },
  {
    name: "get_inventory_detail",
    description: "Детальная карточка товара на складе: поступления, продажи, финансовые движения",
    method: "GET",
    path: "/api/inventory/sku/:cardId",
    params: {
      cardId: { type: "string", description: "ID мастер-карточки товара", required: true, in: "path" },
    },
  },

  // ── Закупки (прогноз) ──
  {
    name: "get_procurement_forecast",
    description: "Прогноз закупок: скорость продаж, остатки, рекомендуемое количество для заказа",
    method: "GET",
    path: "/api/procurement",
    params: {
      q: { type: "string", description: "Поиск по названию", in: "query" },
      lookback_days: { type: "number", description: "Период анализа продаж (дни)", in: "query" },
      lead_time_days: { type: "number", description: "Время доставки (дни)", in: "query" },
      coverage_days: { type: "number", description: "Запас на (дни)", in: "query" },
    },
  },
  {
    name: "create_procurement_order",
    description: "Создать заказ поставщику из прогноза закупок",
    method: "POST",
    path: "/api/procurement",
    params: {
      action: { type: "string", description: "Действие (create-order)", required: true, in: "body" },
      supplier_name: { type: "string", description: "Название поставщика", required: true, in: "body" },
      items: { type: "object", description: "Массив [{card_id, order_qty}]", required: true, in: "body" },
    },
  },

  // ── Поступления ──
  {
    name: "list_supplier_orders",
    description: "Список заказов поставщикам",
    method: "GET",
    path: "/api/suppliers",
    params: {
      status: { type: "string", description: "Фильтр по статусу", enum: ["draft", "ordered", "shipped", "received", "cancelled"], in: "query" },
      q: { type: "string", description: "Поиск по имени поставщика или номеру заказа", in: "query" },
    },
  },
  {
    name: "get_supplier_order",
    description: "Детали заказа поставщику: позиции, суммы, статус",
    method: "GET",
    path: "/api/suppliers/:id",
    params: {
      id: { type: "string", description: "ID заказа", required: true, in: "path" },
    },
  },
  {
    name: "create_supplier_order",
    description: "Создать заказ поставщику с позициями товаров",
    method: "POST",
    path: "/api/suppliers",
    params: {
      supplier_name: { type: "string", description: "Название поставщика", required: true, in: "body" },
      order_number: { type: "string", description: "Номер заказа", in: "body" },
      notes: { type: "string", description: "Заметки", in: "body" },
      items: { type: "object", description: "Массив [{master_card_id, ordered_qty, purchase_price, purchase_currency}]", required: true, in: "body" },
      shared_costs: { type: "object", description: "Накладные расходы [{name, total_rub, method}]", in: "body" },
    },
  },

  // ── Продажи ──
  {
    name: "list_sales",
    description: "Список продаж с фильтрами по статусу, каналу и дате",
    method: "GET",
    path: "/api/sales",
    params: {
      status: { type: "string", description: "Фильтр по статусу", enum: ["active", "delivered", "returned"], in: "query" },
      channel: { type: "string", description: "Фильтр по каналу (ozon, manual, etc.)", in: "query" },
      from: { type: "string", description: "Дата от (YYYY-MM-DD)", in: "query" },
      to: { type: "string", description: "Дата до (YYYY-MM-DD)", in: "query" },
      limit: { type: "number", description: "Лимит", in: "query" },
      offset: { type: "number", description: "Смещение", in: "query" },
    },
  },

  // ── Финансы ──
  {
    name: "get_finance_summary",
    description: "Финансовый P&L отчёт: выручка, расходы, себестоимость, прибыль",
    method: "GET",
    path: "/api/finance",
    params: {
      from: { type: "string", description: "Дата от (YYYY-MM-DD)", in: "query" },
      to: { type: "string", description: "Дата до (YYYY-MM-DD)", in: "query" },
    },
  },
  {
    name: "list_transactions",
    description: "Список финансовых транзакций (ДДС)",
    method: "GET",
    path: "/api/finance/transactions",
    params: {
      type: { type: "string", description: "Тип транзакции", in: "query" },
      limit: { type: "number", description: "Лимит", in: "query" },
      offset: { type: "number", description: "Смещение", in: "query" },
    },
  },

  // ── Аналитика ──
  {
    name: "get_analytics",
    description: "Аналитика: unit economics по товарам или стоимость остатков",
    method: "GET",
    path: "/api/analytics",
    params: {
      report: { type: "string", description: "Тип отчёта", enum: ["unit-economics", "stock-valuation"], required: true, in: "query" },
      from: { type: "string", description: "Дата от (YYYY-MM-DD)", in: "query" },
      to: { type: "string", description: "Дата до (YYYY-MM-DD)", in: "query" },
    },
  },

  // ── Реестр поставщиков ──
  {
    name: "list_suppliers_registry",
    description: "Список зарегистрированных поставщиков",
    method: "GET",
    path: "/api/suppliers-registry",
  },
]
