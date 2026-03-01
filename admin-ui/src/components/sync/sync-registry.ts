export interface SyncRegistryItem {
  key: string
  label: string
  desc: string
  endpoint: string
  body: Record<string, unknown>
  group: string
  api: string
  db: string
}

export const SYNC_REGISTRY: SyncRegistryItem[] = [
  { key: 'ozon_product_import', label: 'Импорт товаров', desc: 'Каталог из Ozon', endpoint: '/ozon/import/products', body: { page_size: 100, max_pages: 20, update_existing: true, fill_dimensions_from_ozon: true }, group: 'catalog', api: '/v2/product/list, /v4/product/info/attributes', db: 'master_cards' },
  { key: 'ozon_finance', label: 'Финансы', desc: 'Транзакции из Ozon Finance', endpoint: '/ozon/sync/finance', body: {}, group: 'analytics', api: '/v3/finance/transaction/list', db: 'finance_transactions' },
  { key: 'ozon_unit_economics', label: 'Юнит-экономика', desc: 'Себестоимость по операциям SKU', endpoint: '/ozon/sync/unit-economics', body: { limit: 1000, max_pages: 50 }, group: 'analytics', api: '/v3/finance/transaction/list', db: 'ozon_sku_economics (16 столбцов затрат)' },
  { key: 'ozon_supplies', label: 'Поставки', desc: 'Поставки на склады Ozon', endpoint: '/ozon/sync/supplies', body: {}, group: 'logistics', api: '/v3/supply-order/list, /v3/supply-order/get, /v1/supply-order/bundle', db: 'ozon_supplies, ozon_supply_items, stock_movements' },
  { key: 'ozon_warehouse_stock', label: 'Остатки на складе', desc: 'FBS/rFBS/FBP остатки', endpoint: '/ozon/sync/warehouse-stock', body: {}, group: 'logistics', api: '/v4/product/info/stocks', db: 'ozon_warehouse_stock' },
  { key: 'fbo_postings', label: 'Продажи FBO', desc: 'Полная история FBO + отмены', endpoint: '/ozon/sync/fbo-postings', body: {}, group: 'logistics', api: '/v3/posting/fbo/list', db: 'sales_orders, sales_order_items, fifo_allocations' },
  { key: 'ozon_returns', label: 'Возвраты', desc: 'Возвраты и отмены покупателей', endpoint: '/ozon/sync/returns', body: {}, group: 'logistics', api: '/v1/returns/list', db: 'ozon_returns' },
  { key: 'ozon_cluster_stock', label: 'Кластерные остатки', desc: 'FBO аналитика по кластерам', endpoint: '/ozon/sync/cluster-stock', body: {}, group: 'demand', api: '/v1/analytics/stocks', db: 'ozon_cluster_stock' },
  { key: 'pricing_sync', label: 'Цены и категории', desc: 'Категории, комиссии, тарифы', endpoint: '/pricing/sync', body: {}, group: 'prices', api: '/v3/product/list, /v1/description-category/tree, /v5/product/info/prices', db: 'master_cards (attributes JSONB)' },
]

export const SYNC_GROUPS = [
  { key: 'catalog', label: 'Каталог' },
  { key: 'analytics', label: 'Аналитика' },
  { key: 'logistics', label: 'Логистика' },
  { key: 'demand', label: 'Планирование' },
  { key: 'prices', label: 'Цены' },
] as const

/** Maps route name to the sync freshness keys for the freshness dot indicator */
export const SECTION_SYNC_MAP: Record<string, string[]> = {
  catalog: ['ozon_product_import'],
  analytics: ['ozon_unit_economics'],
  demand: ['ozon_cluster_stock'],
  logistics: ['ozon_supplies', 'ozon_warehouse_stock', 'fbo_postings', 'ozon_returns'],
  finance: ['ozon_finance'],
  prices: ['pricing_sync'],
}
