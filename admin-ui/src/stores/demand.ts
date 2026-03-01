import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { apiRequest } from '@/composables/useApi'

export interface ClusterBreakdown {
  cluster_id: string
  cluster_name: string
  source: string
  ads: number | null
  idc: number | null
  turnover: string | null
  available: number
  in_transit: number
  stock_at_arrival: number | null
  need: number
  gap: number
}

export interface DemandItem {
  master_card_id: string
  sku: string
  title: string
  ads_global: number | null
  idc_global: number | null
  stock_on_ozon: number | null
  stock_at_home: number
  pipeline_supplier: number
  total_gap: number
  recommended_qty: number
  cluster_breakdown: ClusterBreakdown[]
}

export interface DemandPlan {
  plan_id: string
  status: string
  lead_time_days: number
  buffer_days: number
  total_items: number
  total_qty: number
  data_synced_at: string | null
  items: DemandItem[]
}

export const useDemandStore = defineStore('demand', () => {
  const demandPlan = ref<DemandPlan | null>(null)
  const demandSyncedAt = ref<string | null>(null)
  const demandExpandedRows = reactive(new Set<string>())

  async function loadDemandClusterStock() {
    try {
      const data = await apiRequest<{ synced_at: string | null }>(
        '/demand/cluster-stock',
      )
      demandSyncedAt.value = data.synced_at
    } catch {
      /* ignore */
    }
  }

  async function generatePlan(params: {
    lead_time_days: number
    buffer_days: number
  }): Promise<DemandPlan> {
    const plan = await apiRequest<DemandPlan>('/demand/generate', {
      method: 'POST',
      body: params,
    })
    demandPlan.value = plan
    demandSyncedAt.value = plan.data_synced_at
    return plan
  }

  async function confirmPlan(planId: string) {
    await apiRequest(`/demand/plans/${planId}/confirm`, { method: 'POST' })
    if (demandPlan.value) {
      demandPlan.value.status = 'confirmed'
    }
  }

  function toggleExpandedRow(cardId: string) {
    if (demandExpandedRows.has(cardId)) {
      demandExpandedRows.delete(cardId)
    } else {
      demandExpandedRows.add(cardId)
    }
  }

  return {
    demandPlan,
    demandSyncedAt,
    demandExpandedRows,
    loadDemandClusterStock,
    generatePlan,
    confirmPlan,
    toggleExpandedRow,
  }
})
