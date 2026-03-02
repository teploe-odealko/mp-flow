// ── Column Documentation Types ──

export interface ColumnDocEntry {
  key: string
  label: string
  description: string
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
      },
      {
        key: "received_qty",
        label: "Получено",
        description: "Общее количество единиц, поступивших от поставщиков через документы поступлений (оприходования или заказы поставщикам).",
      },
      {
        key: "stock_total",
        label: "На складах",
        description: "Текущий расчётный остаток товара на всех складах. При наведении показывает разбивку по складам/источникам.",
      },
      {
        key: "sold_total",
        label: "Продано",
        description: "Количество доставленных единиц, которые не вернули на данный момент. При наведении — разбивка по каналам продаж.",
      },
      {
        key: "delivering_total",
        label: "В доставке",
        description: "Количество единиц в процессе доставки покупателю.",
      },
      {
        key: "written_off_qty",
        label: "Списано",
        description: "Количество единиц, списанных вручную (потери, брак, расхождения при инвентаризации).",
      },
      {
        key: "discrepancy",
        label: "Расхождение",
        description: "Разница между расчётным локальным остатком и нулём. Положительное значение (жёлтый) — излишек, отрицательное (красный) — недостача. Часто возникает при подключении маркетплейсов, когда часть товара уже на складе МП.",
      },
      {
        key: "avg_cost",
        label: "Себестоимость",
        description: "Средняя себестоимость единицы товара в рублях. Если «нет» (красный) — ни одно поступление не имеет указанной цены.",
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
      },
      {
        key: "sku",
        label: "SKU",
        description: "Внутренний артикул товара.",
      },
      {
        key: "status",
        label: "Статус",
        description: "Статус товара: active (активен), draft (черновик).",
      },
      {
        key: "stock",
        label: "Склад",
        description: "Количество товара на складе (из расчёта инвентаризации).",
      },
      {
        key: "avg_cost",
        label: "Ср. себестоимость",
        description: "Средняя себестоимость единицы товара в рублях.",
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
      },
      {
        key: "order_number",
        label: "Заказ",
        description: "Номер заказа на маркетплейсе или внутренний идентификатор.",
      },
      {
        key: "channel",
        label: "Канал",
        description: "Канал продажи: Ozon, WB, ручные, списания и т.д.",
      },
      {
        key: "status",
        label: "Статус",
        description: "Статус заказа: «В доставке» (active), «Доставлено» (delivered), «Возврат» (returned).",
      },
      {
        key: "quantity",
        label: "Кол-во",
        description: "Количество единиц товара в заказе.",
      },
      {
        key: "price",
        label: "Цена",
        description: "Цена за единицу товара в рублях.",
      },
      {
        key: "revenue",
        label: "Выручка",
        description: "Общая выручка по заказу (цена × кол-во).",
      },
      {
        key: "expenses",
        label: "Расходы",
        description: "Сумма комиссий и расходов маркетплейса. Клик по строке раскрывает детализацию по типам расходов.",
      },
      {
        key: "date",
        label: "Дата",
        description: "Дата продажи (заказа).",
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
      },
      {
        key: "quantity",
        label: "Кол-во",
        description: "Суммарное количество проданных единиц за период.",
      },
      {
        key: "revenue",
        label: "Выручка",
        description: "Суммарная выручка по товару за период.",
      },
      {
        key: "mp_fees",
        label: "Расходы МП",
        description: "Суммарные комиссии и расходы маркетплейса. Кнопка ► раскрывает колонки с детализацией по типам.",
      },
      {
        key: "cogs",
        label: "Себестоимость",
        description: "Суммарная себестоимость проданных товаров.",
      },
      {
        key: "profit",
        label: "Прибыль",
        description: "Операционная прибыль по товару: выручка минус все расходы.",
      },
      {
        key: "margin",
        label: "Маржа",
        description: "Маржинальность в процентах. Зелёный > 20%, жёлтый 0–20%, красный < 0%.",
      },
      {
        key: "roi",
        label: "ROI",
        description: "Рентабельность инвестиций: отношение прибыли к себестоимости.",
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
      },
      {
        key: "quantity",
        label: "Остаток",
        description: "Текущий остаток на складе.",
      },
      {
        key: "avg_cost",
        label: "Ср. с/с",
        description: "Средняя себестоимость единицы.",
      },
      {
        key: "total_cost",
        label: "Стоимость",
        description: "Общая стоимость запасов данного товара.",
      },
    ],
  },
]
