import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { apiRequest } from '@/composables/useApi'

export interface MasterCard {
  id: string
  sku: string | null
  title: string | null
  brand: string | null
  status: string
  ozon_product_id: string | null
  ozon_offer_id: string | null
  ozon_main_image: string | null
  description: string | null
  attributes: Record<string, any> | null
  updated_at: string | null
  created_at: string | null
}

export const useCatalogStore = defineStore('catalog', () => {
  const cards = ref<MasterCard[]>([])
  const searchQuery = ref('')
  const cardSort = reactive<{ field: string; dir: 'asc' | 'desc' }>({
    field: 'updated_at',
    dir: 'desc',
  })
  const showArchived = ref(false)

  async function loadCards() {
    const params = new URLSearchParams({ limit: '200' })
    if (showArchived.value) params.set('include_archived', 'true')
    if (searchQuery.value) params.set('q', searchQuery.value)
    params.set('sort', `${cardSort.field}:${cardSort.dir}`)
    const data = await apiRequest<{ items: MasterCard[] }>(`/master-cards?${params}`)
    cards.value = data.items || []
  }

  async function createCard(payload: {
    title: string
    sku?: string | null
    ozon_offer_id?: string | null
    brand?: string | null
    description?: string | null
  }) {
    await apiRequest('/master-cards', { method: 'POST', body: payload })
    await loadCards()
  }

  async function archiveCard(cardId: string, currentStatus: string) {
    const newStatus = currentStatus === 'archived' ? 'active' : 'archived'
    await apiRequest(`/master-cards/${cardId}`, {
      method: 'PATCH',
      body: { status: newStatus },
    })
    await loadCards()
  }

  function toggleSort(field: string) {
    if (cardSort.field === field) {
      cardSort.dir = cardSort.dir === 'asc' ? 'desc' : 'asc'
    } else {
      cardSort.field = field
      cardSort.dir = 'asc'
    }
  }

  return {
    cards,
    searchQuery,
    cardSort,
    showArchived,
    loadCards,
    createCard,
    archiveCard,
    toggleSort,
  }
})
