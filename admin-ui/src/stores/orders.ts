import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { apiRequest } from '@/composables/useApi'

export interface SupplierOrder {
  id: string
  order_number: string
  supplier_name: string
  status: string
  total_amount_rub: number
  order_date: string | null
  notes: string | null
  shared_costs: SharedCost[] | string
  received_at: string | null
  created_at: string | null
}

export interface OrderItem {
  id: string
  master_card_id: string
  master_card_title?: string
  title?: string
  quantity: number
  received_qty?: number
  cny_price_per_unit: number
  individual_cost_rub: number
  purchase_price_rub: number
  unit_cost_rub: number
  extra_cost_rub: number
  allocations?: Array<{ name: string; allocated_rub: number }>
}

export interface SharedCost {
  name: string
  total_rub: number
  method: 'by_cny_price' | 'by_volume' | 'by_weight' | 'equal'
}

export interface OrderDetail {
  order: SupplierOrder
  items: OrderItem[]
}

export interface ReceiveItem {
  item_id: string
  received_qty: number
}

export const useOrdersStore = defineStore('orders', () => {
  const orders = ref<SupplierOrder[]>([])
  const editingOrderId = ref<string | null>(null)
  const orderSearchQuery = ref('')
  const orderSort = reactive<{ field: string; dir: 'asc' | 'desc' }>({
    field: 'created_at',
    dir: 'desc',
  })

  async function loadOrders() {
    const params = new URLSearchParams({ limit: '200' })
    if (orderSearchQuery.value) params.set('q', orderSearchQuery.value)
    params.set('sort', `${orderSort.field}:${orderSort.dir}`)
    const data = await apiRequest<{ items: SupplierOrder[] }>(
      `/supplier-orders?${params}`,
    )
    orders.value = data.items || []
  }

  async function loadOrderDetail(orderId: string): Promise<OrderDetail> {
    return apiRequest<OrderDetail>(`/supplier-orders/${orderId}`)
  }

  async function createOrder(payload: {
    supplier_name: string
    order_date?: string | null
    notes?: string | null
    shared_costs: SharedCost[]
    items: Array<{
      master_card_id: string
      quantity: number
      cny_price_per_unit: number
      individual_cost_rub: number
      purchase_price_rub: number
      extra_cost_rub: number
      allocations: Array<{ name: string; allocated_rub: number }>
    }>
  }) {
    await apiRequest('/supplier-orders', { method: 'POST', body: payload })
    await loadOrders()
  }

  async function updateOrder(
    orderId: string,
    payload: {
      supplier_name: string
      order_date?: string | null
      notes?: string | null
      shared_costs: SharedCost[]
      items: Array<{
        master_card_id: string
        quantity: number
        cny_price_per_unit: number
        individual_cost_rub: number
        purchase_price_rub: number
        extra_cost_rub: number
        allocations: Array<{ name: string; allocated_rub: number }>
      }>
    },
  ) {
    await apiRequest(`/supplier-orders/${orderId}`, {
      method: 'PUT',
      body: payload,
    })
    await loadOrders()
  }

  async function deleteOrder(orderId: string) {
    await apiRequest(`/supplier-orders/${orderId}`, { method: 'DELETE' })
    await loadOrders()
  }

  async function receiveOrder(
    orderId: string,
    items: ReceiveItem[],
  ) {
    await apiRequest(`/supplier-orders/${orderId}/receive`, {
      method: 'POST',
      body: { items },
    })
    await loadOrders()
  }

  async function unreceiveOrder(orderId: string) {
    await apiRequest(`/supplier-orders/${orderId}/unreceive`, {
      method: 'POST',
    })
    await loadOrders()
  }

  function toggleSort(field: string) {
    if (orderSort.field === field) {
      orderSort.dir = orderSort.dir === 'asc' ? 'desc' : 'asc'
    } else {
      orderSort.field = field
      orderSort.dir = 'asc'
    }
  }

  return {
    orders,
    editingOrderId,
    orderSearchQuery,
    orderSort,
    loadOrders,
    loadOrderDetail,
    createOrder,
    updateOrder,
    deleteOrder,
    receiveOrder,
    unreceiveOrder,
    toggleSort,
  }
})
