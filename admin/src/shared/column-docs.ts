// ── Column Documentation Types ──

export interface ColumnDocEntry {
  key: string
  label: string
  description: string
  source: string
  formula?: string
}

export interface PageColumnDocs {
  pageId: string
  pageLabel: string
  columns: ColumnDocEntry[]
}

export interface PluginColumnDocContribution {
  pageId: string
  columnKey: string
  pluginLabel: string
  description: string
}

// Extended entry returned from API (with merged plugin contributions)
export interface ColumnDocWithPlugins extends ColumnDocEntry {
  pluginContributions?: Array<{ pluginLabel: string; description: string }>
}

export interface PageColumnDocsWithPlugins {
  pageId: string
  pageLabel: string
  columns: ColumnDocWithPlugins[]
}

// ── Core Column Descriptions ──

export const CORE_COLUMN_DOCS: PageColumnDocs[] = [
  // ── Склад ──
  {
    pageId: "warehouse",
    pageLabel: "Склад",
    columns: [
      {
        key: "product",
        label: "Товар",
        description: "Название товара из мастер-карточки и его артикул (SKU).",
        source: "Таблица master_card (title, sku).",
      },
      {
        key: "received_qty",
        label: "Получено",
        description: "Общее количество единиц, поступивших от поставщиков через документы поступлений.",
        source: "Сумма received_qty из всех позиций поступлений (supplier_order_item) со статусом «принят».",
        formula: "SUM(supplier_order_items.received_qty)",
      },
      {
        key: "stock_total",
        label: "На складах",
        description: "Текущий расчётный остаток товара на всех складах. При наведении показывает разбивку по складам/источникам.",
        source: "Вычисляется как: Получено − Продано − В доставке − Списано.",
        formula: "received_qty − sold_total − delivering_total − written_off_qty",
      },
      {
        key: "sold_total",
        label: "Продано",
        description: "Количество проданных единиц (доставленные заказы). При наведении — разбивка по каналам продаж.",
        source: "Сумма quantity из таблицы sale со статусом «delivered».",
        formula: "SUM(sales.quantity) WHERE status = 'delivered'",
      },
      {
        key: "delivering_total",
        label: "В доставке",
        description: "Количество единиц в процессе доставки покупателю. Эти товары уже не на складе, но ещё не считаются проданными.",
        source: "Сумма quantity из таблицы sale со статусом «active».",
        formula: "SUM(sales.quantity) WHERE status = 'active'",
      },
      {
        key: "written_off_qty",
        label: "Списано",
        description: "Количество единиц, списанных вручную (потери, брак, расхождения при инвентаризации).",
        source: "Таблица finance_transaction (тип write-off), сумма quantity для данного товара.",
      },
      {
        key: "discrepancy",
        label: "Расхождение",
        description: "Разница между расчётным локальным остатком и нулём. Положительное значение (жёлтый) — излишек, отрицательное (красный) — недостача. Часто возникает при подключении маркетплейсов, когда часть товара уже на складе МП.",
        source: "Вычисляется: received − sold − delivering − written_off − stock_on_marketplaces.",
      },
      {
        key: "avg_cost",
        label: "Себестоимость",
        description: "Средняя себестоимость единицы товара в рублях. Если «нет» (красный) — ни одно поступление не имеет указанной цены.",
        source: "Средневзвешенная цена из supplier_order_item (unit_cost_rub × received_qty).",
        formula: "SUM(unit_cost_rub × received_qty) / SUM(received_qty)",
      },
    ],
  },

  // ── Каталог ──
  {
    pageId: "catalog",
    pageLabel: "Каталог",
    columns: [
      {
        key: "title",
        label: "Название",
        description: "Название товара из мастер-карточки.",
        source: "Поле title таблицы master_card.",
      },
      {
        key: "sku",
        label: "SKU",
        description: "Внутренний артикул товара.",
        source: "Поле sku таблицы master_card.",
      },
      {
        key: "status",
        label: "Статус",
        description: "Статус товара: active (активен), draft (черновик).",
        source: "Поле status таблицы master_card.",
      },
      {
        key: "stock",
        label: "Склад",
        description: "Количество товара на складе (из расчёта инвентаризации).",
        source: "Поле warehouse_stock — расчётный остаток из модуля инвентаризации.",
      },
      {
        key: "avg_cost",
        label: "Ср. себестоимость",
        description: "Средняя себестоимость единицы товара в рублях.",
        source: "Средневзвешенная цена из документов поступлений.",
      },
    ],
  },

  // ── Продажи ──
  {
    pageId: "sales",
    pageLabel: "Продажи",
    columns: [
      {
        key: "product",
        label: "Товар",
        description: "Название товара. Если товар привязан к мастер-карточке — название из карточки, иначе — SKU канала.",
        source: "master_card.title или sale.channel_sku.",
      },
      {
        key: "order_number",
        label: "Заказ",
        description: "Номер заказа на маркетплейсе или внутренний идентификатор.",
        source: "Поле channel_order_id таблицы sale.",
      },
      {
        key: "channel",
        label: "Канал",
        description: "Канал продажи: Ozon, WB, ручные, списания и т.д.",
        source: "Поле channel таблицы sale.",
      },
      {
        key: "status",
        label: "Статус",
        description: "Статус заказа: «В доставке» (active), «Доставлено» (delivered), «Возврат» (returned).",
        source: "Поле status таблицы sale.",
      },
      {
        key: "quantity",
        label: "Кол-во",
        description: "Количество единиц товара в заказе.",
        source: "Поле quantity таблицы sale.",
      },
      {
        key: "price",
        label: "Цена",
        description: "Цена за единицу товара в рублях.",
        source: "Поле price_per_unit таблицы sale.",
      },
      {
        key: "revenue",
        label: "Выручка",
        description: "Общая выручка по заказу (цена × кол-во).",
        source: "Поле revenue таблицы sale.",
        formula: "price_per_unit × quantity",
      },
      {
        key: "expenses",
        label: "Расходы",
        description: "Сумма комиссий и расходов маркетплейса. Клик по строке раскрывает детализацию по типам расходов.",
        source: "Сумма всех fee_details (массив комиссий) из таблицы sale.",
        formula: "SUM(fee_details[].amount)",
      },
      {
        key: "date",
        label: "Дата",
        description: "Дата продажи (заказа).",
        source: "Поле sold_at таблицы sale.",
      },
    ],
  },

  // ── Аналитика: Unit Economics ──
  {
    pageId: "analytics-ue",
    pageLabel: "Аналитика — Unit Economics",
    columns: [
      {
        key: "product",
        label: "Товар",
        description: "Название товара. Данные агрегированы по мастер-карточкам за выбранный период.",
        source: "master_card.title, группировка по master_card_id.",
      },
      {
        key: "quantity",
        label: "Кол-во",
        description: "Суммарное количество проданных единиц за период.",
        source: "SUM(sale.quantity) за период.",
      },
      {
        key: "revenue",
        label: "Выручка",
        description: "Суммарная выручка по товару за период.",
        source: "SUM(sale.revenue) за период.",
      },
      {
        key: "mp_fees",
        label: "Расходы МП",
        description: "Суммарные комиссии и расходы маркетплейса. Кнопка ► раскрывает колонки с детализацией по типам.",
        source: "SUM(fee_details) по всем продажам товара за период.",
      },
      {
        key: "cogs",
        label: "Себестоимость",
        description: "Суммарная себестоимость проданных товаров.",
        source: "sale.total_cogs (ср. с/с × кол-во).",
        formula: "avg_cost × quantity",
      },
      {
        key: "profit",
        label: "Прибыль",
        description: "Операционная прибыль по товару: выручка минус все расходы.",
        source: "Вычисляется на сервере.",
        formula: "revenue − mp_fees − cogs",
      },
      {
        key: "margin",
        label: "Маржа",
        description: "Маржинальность в процентах. Зелёный > 20%, жёлтый 0–20%, красный < 0%.",
        source: "Вычисляется: прибыль / выручка × 100.",
        formula: "(profit / revenue) × 100%",
      },
      {
        key: "roi",
        label: "ROI",
        description: "Рентабельность инвестиций: отношение прибыли к себестоимости.",
        source: "Вычисляется: прибыль / себестоимость × 100.",
        formula: "(profit / cogs) × 100%",
      },
    ],
  },

  // ── Аналитика: Стоимость остатков ──
  {
    pageId: "analytics-sv",
    pageLabel: "Аналитика — Стоимость остатков",
    columns: [
      {
        key: "product",
        label: "Товар",
        description: "Название товара из мастер-карточки.",
        source: "master_card.title.",
      },
      {
        key: "quantity",
        label: "Остаток",
        description: "Текущий остаток на складе.",
        source: "Расчётный остаток из модуля инвентаризации.",
      },
      {
        key: "avg_cost",
        label: "Ср. с/с",
        description: "Средняя себестоимость единицы.",
        source: "Средневзвешенная цена из документов поступлений.",
      },
      {
        key: "total_cost",
        label: "Стоимость",
        description: "Общая стоимость запасов данного товара.",
        source: "Остаток × средняя себестоимость.",
        formula: "quantity × avg_cost",
      },
    ],
  },
]
