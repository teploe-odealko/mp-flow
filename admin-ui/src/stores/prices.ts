import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { apiRequest } from '@/composables/useApi'

export interface CommissionTier {
  price_min: number
  price_max: number | null
  rate: number
}

export interface PriceProduct {
  id: string
  sku: string | null
  title: string
  ozon_offer_id: string | null
  ozon_product_id: string | null
  ozon_category_name: string | null
  ozon_product_type_name: string | null
  cogs: number
  ozon_price: number | null
  ozon_min_price: number | null
  commission_tiers: CommissionTier[]
  tariffs: {
    acquiring_rub: number
    pipeline_min_rub: number
    pipeline_max_rub: number
  } | null
}

export interface PriceDefaults {
  [key: string]: any
}

export interface BreakevenResult {
  sale_price_rub?: number
  breakeven_price_rub?: number
  target_margin_pct?: number
  actual_margin_pct?: number
  profit_rub?: number
  breakdown?: BreakevenBreakdown
  margin_results?: Array<{
    target_margin_pct: number
    sale_price_rub: number
    profit_rub: number
    error?: string
    breakdown?: BreakevenBreakdown
  }>
  error?: string
}

export interface BreakevenBreakdown {
  cogs_rub: number
  commission_rub: number
  commission_pct: number
  acquiring_rub: number
  last_mile_rub: number
  storage_rub: number
  return_cost_rub: number
  tax_rub: number
  total_costs: number
}

function findCommRate(price: number, tiers: CommissionTier[]): number {
  if (!tiers || !tiers.length) return 0
  for (const t of tiers) {
    if (price >= t.price_min && (t.price_max == null || price < t.price_max))
      return t.rate
  }
  return tiers[tiers.length - 1].rate
}

function pricingParams(product: PriceProduct | null) {
  const t = product?.tariffs || ({} as any)
  return {
    acquiring_rub: t.acquiring_rub || 0,
    pipelineMin: t.pipeline_min_rub || 0,
    pipelineMax: t.pipeline_max_rub || 0,
  }
}

export interface CalcPriceResult {
  price: number
  commRate: number
  profit: number
  netRevenue: number
  fixed: number
  target: number
}

export function calcPriceFromROI(
  cogs: number,
  roi: number,
  tiers: CommissionTier[],
  product: PriceProduct | null,
): CalcPriceResult | null {
  if (!cogs || cogs <= 0 || !tiers || !tiers.length) return null
  const pp = pricingParams(product)
  const target = cogs * (1 + roi / 100)
  const fixed = target + pp.pipelineMin

  let best: CalcPriceResult | null = null
  for (const tier of tiers) {
    const denom = 1 - tier.rate
    if (denom <= 0.01) continue
    const rawPrice = (fixed + pp.acquiring_rub) / denom
    const price = Math.ceil(rawPrice)
    const inRange =
      price >= tier.price_min &&
      (tier.price_max == null || price < tier.price_max)
    if (inRange && (!best || price < best.price)) {
      const commAmt = price * tier.rate
      const netRevenue = price - commAmt - pp.acquiring_rub
      const profit = netRevenue - cogs - pp.pipelineMin
      best = { price, commRate: tier.rate, profit, netRevenue, fixed, target }
    }
  }
  return best
}

export function calcROIFromPrice(
  cogs: number,
  price: number,
  tiers: CommissionTier[],
  product: PriceProduct | null,
): { roi: number; commRate: number; profit: number; netRevenue: number } | null {
  if (!cogs || cogs <= 0 || !price || price <= 0) return null
  const pp = pricingParams(product)
  const commRate = findCommRate(price, tiers)
  const commAmt = price * commRate
  const netRevenue = price - commAmt - pp.acquiring_rub
  const profit = netRevenue - cogs - pp.pipelineMin
  const roi = (profit / cogs) * 100
  return { roi: Math.round(roi * 10) / 10, commRate, profit, netRevenue }
}

export const usePricesStore = defineStore('prices', () => {
  const pricesLoaded = ref(false)
  const priceProducts = ref<PriceProduct[]>([])
  const priceDefaults = ref<PriceDefaults>({})
  const priceSearchQuery = ref('')
  const priceSort = reactive<{ field: string; dir: 'asc' | 'desc' }>({
    field: 'title',
    dir: 'asc',
  })
  const priceGlobalRoi = ref(20)
  const priceRowRoi = ref<Record<string, number>>({})
  const priceRowPrice = ref<Record<string, number>>({})
  const activeTab = ref<'priceProductsView' | 'priceCalcView'>(
    'priceProductsView',
  )

  // Calculator state
  const calcCategories = ref<string[]>([])
  const calcTypes = ref<string[]>([])

  async function loadPriceProducts() {
    pricesLoaded.value = true
    const params = new URLSearchParams()
    if (priceSearchQuery.value) params.set('q', priceSearchQuery.value)
    if (priceSort.field)
      params.set('sort', priceSort.field + ':' + priceSort.dir)
    const qs = params.toString()
    const data = await apiRequest<{
      items: PriceProduct[]
      defaults: PriceDefaults
    }>('/pricing/products' + (qs ? '?' + qs : ''))
    priceProducts.value = data.items || []
    priceDefaults.value = data.defaults || {}
  }

  function setGlobalRoi(roi: number) {
    priceGlobalRoi.value = roi
    priceRowRoi.value = {}
    priceRowPrice.value = {}
  }

  function setRowRoi(cardId: string, roi: number) {
    if (roi === priceGlobalRoi.value) {
      delete priceRowRoi.value[cardId]
    } else {
      priceRowRoi.value[cardId] = roi
    }
    // Clear price override when ROI drives the calc
    delete priceRowPrice.value[cardId]
  }

  function setRowPrice(cardId: string, price: number) {
    if (price > 0) {
      priceRowPrice.value[cardId] = price
      // Compute ROI from price for display
      const p = priceProducts.value.find((x) => x.id === cardId)
      if (p && p.cogs > 0 && p.commission_tiers?.length) {
        const result = calcROIFromPrice(
          p.cogs,
          price,
          p.commission_tiers,
          p,
        )
        if (result) {
          priceRowRoi.value[cardId] = Math.round(result.roi)
        }
      }
    } else {
      delete priceRowPrice.value[cardId]
    }
  }

  function getRowRoi(cardId: string): number {
    return priceRowRoi.value[cardId] != null
      ? priceRowRoi.value[cardId]
      : priceGlobalRoi.value
  }

  function getRowPrice(cardId: string): number | null {
    const p = priceProducts.value.find((x) => x.id === cardId)
    if (!p) return null
    if (priceRowPrice.value[cardId] != null) return priceRowPrice.value[cardId]
    const hasTiers = p.commission_tiers && p.commission_tiers.length > 0
    if (p.cogs > 0 && hasTiers) {
      const result = calcPriceFromROI(
        p.cogs,
        getRowRoi(cardId),
        p.commission_tiers,
        p,
      )
      return result ? result.price : null
    }
    return null
  }

  async function applyPrices(
    updates: Array<{
      offer_id: string
      price?: number
      min_price?: number
    }>,
  ) {
    if (!updates.length) return
    const result = await apiRequest<{
      updated: number
      succeeded: string[]
      errors: Array<{ offer_id: string; errors: string[] }>
    }>('/pricing/set-prices', { method: 'POST', body: { updates } })

    // Update local state only for succeeded items
    const ok = new Set(result.succeeded || [])
    for (const u of updates) {
      if (!ok.has(u.offer_id)) continue
      const p = priceProducts.value.find(
        (x) => x.ozon_offer_id === u.offer_id,
      )
      if (p) {
        if (u.price != null) p.ozon_price = u.price
        if (u.min_price != null) p.ozon_min_price = u.min_price
      }
    }

    return result
  }

  async function loadCalcCategories() {
    const data = await apiRequest<{ categories: string[] }>(
      '/pricing/categories',
    )
    calcCategories.value = data.categories || []
  }

  async function loadCalcTypes(category: string) {
    const data = await apiRequest<{ types: string[] }>(
      `/pricing/categories/${encodeURIComponent(category)}/types`,
    )
    calcTypes.value = data.types || []
  }

  async function calculateBreakeven(params: {
    cogs_rub: number
    category: string
    product_type: string
    scheme?: string
    last_mile_rub?: number
    usn_rate_pct?: number
    return_rate_pct?: number
    return_logistics_rub?: number
    margin_targets?: number[]
    target_margin_pct?: number
    sale_price_rub?: number
  }): Promise<BreakevenResult> {
    return apiRequest<BreakevenResult>('/pricing/breakeven', {
      method: 'POST',
      body: params,
    })
  }

  function toggleSort(field: string) {
    if (priceSort.field === field) {
      priceSort.dir = priceSort.dir === 'asc' ? 'desc' : 'asc'
    } else {
      priceSort.field = field
      priceSort.dir = 'asc'
    }
  }

  return {
    pricesLoaded,
    priceProducts,
    priceDefaults,
    priceSearchQuery,
    priceSort,
    priceGlobalRoi,
    priceRowRoi,
    priceRowPrice,
    activeTab,
    calcCategories,
    calcTypes,
    loadPriceProducts,
    setGlobalRoi,
    setRowRoi,
    setRowPrice,
    getRowRoi,
    getRowPrice,
    applyPrices,
    loadCalcCategories,
    loadCalcTypes,
    calculateBreakeven,
    toggleSort,
    // Expose utility functions for components
    calcPriceFromROI,
    calcROIFromPrice,
  }
})
