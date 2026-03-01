import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiRequest } from '@/composables/useApi'
import type { MasterCard } from './catalog'

export interface CardDetail {
  item: MasterCard
  lots: CardLot[]
  sales: CardSale[]
}

export interface CardLot {
  id: string
  received_at: string | null
  initial_qty: number
  remaining_qty: number
  unit_cost_rub: number
  purchase_price_rub: number
  packaging_cost_rub: number
  logistics_cost_rub: number
  customs_cost_rub: number
  extra_cost_rub: number
  allocations: Array<{ name: string; allocated_rub: number }>
  _computed_remaining?: number
}

export interface CardSale {
  id: string
  sold_at: string | null
  external_order_id: string | null
  quantity: number
  unit_sale_price_rub: number
  cogs_rub: number
  status: string
  ue_total: number | null
  ue_revenue: number | null
  ue_commission: number | null
  ue_last_mile: number | null
  ue_pipeline: number | null
  ue_fulfillment: number | null
  ue_dropoff: number | null
  ue_acquiring: number | null
  ue_marketing: number | null
  ue_return_logistics: number | null
  ue_return_processing: number | null
  ue_other_services: number | null
  _computed_cogs?: number
}

function getCardAttributes(card: MasterCard | null): Record<string, any> {
  const raw = card?.attributes
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw }
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw)
      if (p && typeof p === 'object') return p
    } catch (_) { /* ignore */ }
  }
  return {}
}

export const useCardDetailStore = defineStore('card-detail', () => {
  const cardPageId = ref<string | null>(null)
  const selectedCardDetail = ref<CardDetail | null>(null)
  const isLoading = ref(false)

  async function loadCardPage(cardId: string) {
    if (cardPageId.value === cardId && selectedCardDetail.value) {
      return
    }
    isLoading.value = true
    try {
      const data = await apiRequest<CardDetail>(`/master-cards/${cardId}`)
      cardPageId.value = cardId
      selectedCardDetail.value = data
    } finally {
      isLoading.value = false
    }
  }

  async function updateCard(
    cardId: string,
    payload: {
      sku?: string | null
      title?: string
      brand?: string | null
      status?: string
      ozon_product_id?: string | null
      ozon_offer_id?: string | null
      description?: string | null
      attributes?: Record<string, any>
    },
  ) {
    await apiRequest(`/master-cards/${cardId}`, {
      method: 'PATCH',
      body: payload,
    })
  }

  async function attachSource1688(
    cardId: string,
    sourceData: {
      url: string
      overwrite_title?: boolean
      selected_sku_id?: string
      selected_sku_price?: number
    },
  ) {
    await apiRequest(`/master-cards/${cardId}/sources/1688/import`, {
      method: 'POST',
      body: sourceData,
    })
  }

  async function preview1688(url: string) {
    return apiRequest<{
      title: string
      skus: Array<{ sku_id: string; name: string; price: number; image: string }>
    }>('/master-cards/sources/1688/preview', {
      method: 'POST',
      body: { url },
    })
  }

  async function attachManualSource(
    cardId: string,
    provider: string,
    kind: string,
    externalRef: string,
    note: string,
  ) {
    const detail = selectedCardDetail.value
    if (!detail?.item) return
    const attrs = getCardAttributes(detail.item)
    const sources =
      attrs.sources && typeof attrs.sources === 'object' ? { ...attrs.sources } : {}
    sources[`${provider}:${Date.now()}`] = {
      kind,
      provider,
      external_ref: externalRef,
      updated_at: new Date().toISOString(),
      data: { note },
    }
    attrs.sources = sources
    await apiRequest(`/master-cards/${cardId}`, {
      method: 'PATCH',
      body: { attributes: attrs },
    })
  }

  async function removeSource(cardId: string, sourceKey: string) {
    const detail = selectedCardDetail.value
    if (!detail?.item) return
    const attrs = getCardAttributes(detail.item)
    const sources =
      attrs.sources && typeof attrs.sources === 'object' ? { ...attrs.sources } : {}
    delete sources[sourceKey]
    attrs.sources = sources
    await apiRequest(`/master-cards/${cardId}`, {
      method: 'PATCH',
      body: { attributes: attrs },
    })
  }

  function clearDetail() {
    cardPageId.value = null
    selectedCardDetail.value = null
  }

  return {
    cardPageId,
    selectedCardDetail,
    isLoading,
    loadCardPage,
    updateCard,
    attachSource1688,
    preview1688,
    attachManualSource,
    removeSource,
    clearDetail,
  }
})
