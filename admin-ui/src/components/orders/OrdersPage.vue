<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useOrdersStore } from '@/stores/orders'
import { useCatalogStore } from '@/stores/catalog'
import { useUiStore } from '@/stores/ui'
import { formatMoney } from '@/utils/format'
import OrderDrawer from './OrderDrawer.vue'
import OrderDetailExpand from './OrderDetailExpand.vue'
import ReceiveModal from '@/components/logistics/ReceiveModal.vue'

const ordersStore = useOrdersStore()
const catalogStore = useCatalogStore()
const ui = useUiStore()

const expandedOrderId = ref<string | null>(null)
const expandedOrderDetail = ref<any>(null)

const drawerOpen = ref(false)
const editingOrderId = ref<string | null>(null)

const receiveModalOpen = ref(false)
const receiveOrderId = ref<string | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  await ordersStore.loadOrders()
  if (!catalogStore.cards.length) {
    await catalogStore.loadCards()
  }
})

function onSearchInput(e: Event) {
  const value = (e.target as HTMLInputElement).value.trim()
  ordersStore.orderSearchQuery = value
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => ordersStore.loadOrders(), 300)
}

function onSortClick(field: string) {
  ordersStore.toggleSort(field)
  ordersStore.loadOrders()
}

function sortArrow(field: string): string {
  if (ordersStore.orderSort.field !== field) return ''
  return ordersStore.orderSort.dir === 'asc' ? ' \u2191' : ' \u2193'
}

async function toggleExpand(orderId: string) {
  if (expandedOrderId.value === orderId) {
    expandedOrderId.value = null
    expandedOrderDetail.value = null
    return
  }
  try {
    const data = await ordersStore.loadOrderDetail(orderId)
    expandedOrderDetail.value = data
    expandedOrderId.value = orderId
  } catch (err: any) {
    console.error('Failed to load order detail:', err)
  }
}

function openCreateDrawer() {
  editingOrderId.value = null
  drawerOpen.value = true
}

function openEditDrawer(orderId: string) {
  editingOrderId.value = orderId
  drawerOpen.value = true
}

function onDrawerClose() {
  drawerOpen.value = false
  editingOrderId.value = null
}

async function onDrawerSaved() {
  drawerOpen.value = false
  editingOrderId.value = null
  await ordersStore.loadOrders()
}

function openReceive(orderId: string) {
  receiveOrderId.value = orderId
  receiveModalOpen.value = true
}

async function onReceived() {
  receiveModalOpen.value = false
  receiveOrderId.value = null
  await Promise.all([ordersStore.loadOrders(), catalogStore.loadCards()])
}

async function deleteOrder(orderId: string, orderNumber: string) {
  if (!confirm(`Удалить заказ ${orderNumber}?`)) return
  try {
    await ordersStore.deleteOrder(orderId)
  } catch (err: any) {
    alert(`Ошибка: ${err.message}`)
  }
}

async function unreceiveOrder(orderId: string) {
  if (!confirm('Отменить приёмку? Партии будут удалены, заказ вернётся в черновик.')) return
  try {
    await ordersStore.unreceiveOrder(orderId)
    await catalogStore.loadCards()
  } catch (err: any) {
    alert(`Ошибка: ${err.message}`)
  }
}
</script>

<template>
  <div>
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <input
        type="text"
        class="form-input w-64"
        placeholder="Поиск заказов..."
        :value="ordersStore.orderSearchQuery"
        @input="onSearchInput"
      />
      <button
        class="ghost-btn"
        @click="ordersStore.loadOrders()"
      >
        Обновить
      </button>
      <div class="ml-auto">
        <button
          class="px-4 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors"
          @click="openCreateDrawer"
        >
          + Новый заказ
        </button>
      </div>
    </div>

    <!-- Orders table -->
    <div class="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-slate-50 dark:bg-slate-800/50">
            <th class="px-2 py-2 w-10"></th>
            <th
              class="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 cursor-pointer select-none hover:text-sky-500 transition-colors"
              @click="onSortClick('order_number')"
            >
              Номер{{ sortArrow('order_number') }}
            </th>
            <th
              class="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 cursor-pointer select-none hover:text-sky-500 transition-colors"
              @click="onSortClick('supplier_name')"
            >
              Поставщик{{ sortArrow('supplier_name') }}
            </th>
            <th
              class="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 cursor-pointer select-none hover:text-sky-500 transition-colors"
              @click="onSortClick('status')"
            >
              Статус{{ sortArrow('status') }}
            </th>
            <th
              class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 cursor-pointer select-none hover:text-sky-500 transition-colors"
              @click="onSortClick('total_amount_rub')"
            >
              Сумма{{ sortArrow('total_amount_rub') }}
            </th>
            <th class="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-if="ordersStore.orders.length === 0">
            <tr>
              <td colspan="6" class="muted text-center py-4">Заказов пока нет</td>
            </tr>
          </template>
          <template v-for="order in ordersStore.orders" :key="order.id">
            <tr class="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
              <td class="px-2 py-1.5">
                <button
                  class="order-expand-toggle"
                  :class="{ expanded: expandedOrderId === order.id }"
                  @click="toggleExpand(order.id)"
                >
                  &#x25B6;
                </button>
              </td>
              <td class="px-2 py-1.5">{{ order.order_number }}</td>
              <td class="px-2 py-1.5">{{ order.supplier_name }}</td>
              <td class="px-2 py-1.5">
                <span
                  class="badge text-[10px]"
                  :class="order.status === 'draft' ? 'status-draft' : 'status-received'"
                >
                  {{ order.status }}
                </span>
              </td>
              <td class="px-2 py-1.5 text-right tabular-nums">{{ formatMoney(order.total_amount_rub) }}</td>
              <td class="px-2 py-1.5">
                <template v-if="order.status === 'draft'">
                  <button class="ghost-btn" @click="openReceive(order.id)">Принять</button>
                  <button class="ghost-btn" @click="openEditDrawer(order.id)">Ред.</button>
                  <button
                    class="ghost-btn danger-text"
                    @click="deleteOrder(order.id, order.order_number)"
                  >
                    Удал.
                  </button>
                </template>
                <template v-else>
                  <button
                    class="ghost-btn danger-text"
                    @click="unreceiveOrder(order.id)"
                  >
                    Отменить приёмку
                  </button>
                </template>
              </td>
            </tr>
            <!-- Expanded detail row -->
            <tr v-if="expandedOrderId === order.id && expandedOrderDetail" class="order-detail-row">
              <td colspan="6">
                <OrderDetailExpand :order="expandedOrderDetail" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Order Drawer -->
    <OrderDrawer
      :open="drawerOpen"
      :editing-order-id="editingOrderId"
      @close="onDrawerClose"
      @saved="onDrawerSaved"
    />

    <!-- Receive Modal -->
    <ReceiveModal
      :open="receiveModalOpen"
      :order-id="receiveOrderId"
      @close="receiveModalOpen = false; receiveOrderId = null"
      @received="onReceived"
    />
  </div>
</template>
