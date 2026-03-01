import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { apiRequest } from '@/composables/useApi'

export interface PromoItem {
  product_id: number
  offer_id: string
  sku: string | null
  title: string
  price: number | null
  min_price: number | null
  color_index: 'SUPER' | 'GREEN' | 'RED' | 'WITHOUT_INDEX'
  timer_enabled: boolean
  timer_expires_at: string | null
  auto_action_enabled: boolean
  auto_add_to_ozon_actions_list_enabled: boolean
  actions_count: number
  actions: Array<{ title: string }>
}

export interface PromoUpdateItem {
  offer_id: string
  price: number
  min_price?: number
  auto_action_enabled?: string
  auto_add_to_ozon_actions_list_enabled?: string
}

export const usePromoStore = defineStore('promo', () => {
  const promoLoaded = ref(false)
  const promoItems = ref<PromoItem[]>([])
  const promoSort = reactive<{ field: string; dir: 'asc' | 'desc' }>({
    field: 'title',
    dir: 'asc',
  })

  async function loadPromoData() {
    const data = await apiRequest<{ items: PromoItem[] }>(
      '/promotions/price-index',
    )
    promoItems.value = data.items || []
    promoLoaded.value = true
  }

  async function updateActions(
    updates: PromoUpdateItem[],
  ): Promise<{ updated: number; errors: Array<{ offer_id: string; errors: string[] }> }> {
    const result = await apiRequest<{
      updated: number
      errors: Array<{ offer_id: string; errors: string[] }>
    }>('/promotions/update-actions', {
      method: 'POST',
      body: { updates },
    })
    return result
  }

  async function bulkToggle(
    field: 'auto_action_enabled' | 'auto_add_to_ozon_actions_list_enabled',
    value: 'ENABLED' | 'DISABLED',
  ) {
    if (!promoItems.value.length) return
    const updates: PromoUpdateItem[] = promoItems.value.map((it) => ({
      offer_id: it.offer_id,
      price: it.price || 0,
      [field]: value,
    }))
    const result = await updateActions(updates)
    // Reload to get fresh state
    promoLoaded.value = false
    await loadPromoData()
    return result
  }

  async function refreshTimers(productIds?: number[]) {
    const ids =
      productIds ||
      promoItems.value.map((it) => it.product_id).filter(Boolean)
    await apiRequest('/promotions/refresh-timers', {
      method: 'POST',
      body: { product_ids: ids },
    })

    if (productIds && productIds.length === 1) {
      // Update single item locally
      const item = promoItems.value.find(
        (i) => i.product_id === productIds[0],
      )
      if (item) {
        item.timer_enabled = true
        item.timer_expires_at = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString()
      }
    } else {
      // Bulk refresh - reload all
      promoLoaded.value = false
      await loadPromoData()
    }
  }

  async function saveMinPrice(
    offerId: string,
    price: number,
    minPrice: number,
  ) {
    const result = await updateActions([
      { offer_id: offerId, price, min_price: minPrice },
    ])
    if (!result.errors?.length) {
      const item = promoItems.value.find((i) => i.offer_id === offerId)
      if (item) item.min_price = minPrice
    }
    return result
  }

  async function togglePromoFlag(
    offerId: string,
    field: 'auto_action_enabled' | 'auto_add_to_ozon_actions_list_enabled',
    enabled: boolean,
    price: number,
  ) {
    const value = enabled ? 'ENABLED' : 'DISABLED'
    const result = await updateActions([
      { offer_id: offerId, price, [field]: value },
    ])
    if (!result.errors?.length) {
      const item = promoItems.value.find((i) => i.offer_id === offerId)
      if (item) {
        if (field === 'auto_action_enabled')
          item.auto_action_enabled = enabled
        else if (field === 'auto_add_to_ozon_actions_list_enabled')
          item.auto_add_to_ozon_actions_list_enabled = enabled
      }
    }
    return result
  }

  function sortItems(field: string) {
    if (promoSort.field === field) {
      promoSort.dir = promoSort.dir === 'asc' ? 'desc' : 'asc'
    } else {
      promoSort.field = field
      promoSort.dir = 'asc'
    }
  }

  return {
    promoLoaded,
    promoItems,
    promoSort,
    loadPromoData,
    updateActions,
    bulkToggle,
    refreshTimers,
    saveMinPrice,
    togglePromoFlag,
    sortItems,
  }
})
