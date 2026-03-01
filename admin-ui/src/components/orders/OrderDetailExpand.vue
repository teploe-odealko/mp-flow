<script setup lang="ts">
import { computed } from 'vue'
import { formatMoney, formatDateTime } from '@/utils/format'
import type { OrderDetail, OrderItem, SharedCost } from '@/stores/orders'

const props = defineProps<{
  order: OrderDetail
}>()

const METHOD_NAMES: Record<string, string> = {
  by_cny_price: 'По цене CNY',
  by_volume: 'По объёму',
  by_weight: 'По весу',
  equal: 'Равномерно',
}

const isReceived = computed(() => props.order.order?.status === 'received')

const items = computed<OrderItem[]>(() => props.order.items || [])

const sharedCosts = computed<SharedCost[]>(() => {
  const raw = props.order.order?.shared_costs
  if (!raw) return []
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return raw as SharedCost[]
})

function itemTitle(item: OrderItem): string {
  return item.title || item.master_card_title || '\u2014'
}

function itemTotal(item: OrderItem): string {
  if (isReceived.value) {
    const recvQty = Number(item.received_qty ?? item.quantity ?? 0)
    return (Number(item.unit_cost_rub || 0) * recvQty).toFixed(2)
  }
  return (Number(item.unit_cost_rub || 0) * Number(item.quantity || 0)).toFixed(2)
}
</script>

<template>
  <div class="order-detail-inner">
    <!-- Items table: received version -->
    <template v-if="isReceived">
      <strong>Позиции</strong>
      <table>
        <thead>
          <tr>
            <th>Товар</th>
            <th>Заказано</th>
            <th>Принято</th>
            <th>Себест.</th>
            <th>Итого</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td>{{ itemTitle(item) }}</td>
            <td>{{ Number(item.quantity || 0).toFixed(3) }}</td>
            <td style="font-weight: 600">
              {{ Number(item.received_qty ?? item.quantity ?? 0).toFixed(3) }}
            </td>
            <td>{{ formatMoney(item.unit_cost_rub || 0) }}</td>
            <td>{{ formatMoney(itemTotal(item)) }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- Items table: draft version -->
    <template v-else>
      <strong>Позиции</strong>
      <table>
        <thead>
          <tr>
            <th>Товар</th>
            <th>Кол-во</th>
            <th>Себест.</th>
            <th>Итого</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td>{{ itemTitle(item) }}</td>
            <td>{{ Number(item.quantity || 0).toFixed(3) }}</td>
            <td>{{ formatMoney(item.unit_cost_rub || 0) }}</td>
            <td>{{ formatMoney(itemTotal(item)) }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- Shared costs -->
    <template v-if="sharedCosts.length">
      <strong style="display: block; margin-top: 8px">Общие расходы</strong>
      <table>
        <thead>
          <tr>
            <th>Название</th>
            <th>Сумма</th>
            <th>Метод</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(sc, idx) in sharedCosts" :key="idx">
            <td>{{ sc.name }}</td>
            <td>{{ formatMoney(sc.total_rub) }}</td>
            <td>{{ METHOD_NAMES[sc.method] || sc.method }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- Received date -->
    <div
      v-if="order.order?.received_at"
      class="muted"
      style="margin-top: 8px"
    >
      Принят: {{ formatDateTime(order.order.received_at) }}
    </div>
  </div>
</template>
