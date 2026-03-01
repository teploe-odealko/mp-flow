<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import BaseDrawer from '@/components/shared/BaseDrawer.vue'
import ProductCombobox from './ProductCombobox.vue'
import { useOrdersStore } from '@/stores/orders'
import { useCatalogStore, type MasterCard } from '@/stores/catalog'
import { useUiStore } from '@/stores/ui'
import { formatMoney } from '@/utils/format'

const props = defineProps<{
  open: boolean
  editingOrderId: string | null
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const ordersStore = useOrdersStore()
const catalogStore = useCatalogStore()
const ui = useUiStore()

/* ============================================================ */
/* Form state                                                   */
/* ============================================================ */

const supplierName = ref('')
const orderDate = ref('')
const orderNotes = ref('')
const saving = ref(false)

type Currency = 'CNY' | 'RUB' | 'USD'

interface OrderItemRow {
  id: number
  master_card_id: string
  quantity: number
  price: number
  currency: Currency
  overhead_rub: number
}

interface SharedCostRow {
  id: number
  name: string
  total_rub: number
  method: 'by_cny_price' | 'by_volume' | 'by_weight' | 'equal'
}

const orderItems = ref<OrderItemRow[]>([])
const sharedCosts = ref<SharedCostRow[]>([])
let itemCounter = 0
let costCounter = 0

const allocationPreviewOpen = ref(false)

/* ============================================================ */
/* Mass editing                                                 */
/* ============================================================ */

const massEditColumn = ref<string | null>(null)
const massEditValue = ref<string | number>('')

function startMassEdit(column: string) {
  if (massEditColumn.value === column) {
    massEditColumn.value = null
    return
  }
  massEditColumn.value = column
  if (column === 'currency') massEditValue.value = 'CNY'
  else massEditValue.value = ''
}

function applyMassEdit() {
  const col = massEditColumn.value
  if (!col) return
  const filledItems = orderItems.value.filter((r) => r.master_card_id)
  if (col === 'currency') {
    filledItems.forEach((r) => (r.currency = massEditValue.value as Currency))
  } else if (col === 'overhead_rub') {
    const total = Number(massEditValue.value) || 0
    const perItem = Math.round((total / (filledItems.length || 1)) * 100) / 100
    filledItems.forEach((r) => (r.overhead_rub = perItem))
  }
  massEditColumn.value = null
  massEditValue.value = ''
}

/* ============================================================ */
/* Card helpers                                                 */
/* ============================================================ */

function getCardAttributes(card: MasterCard | null): Record<string, any> {
  const raw = card?.attributes
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw }
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw)
      if (p && typeof p === 'object') return p
    } catch { /* ignore */ }
  }
  return {}
}

function getCardCnyPrice(card: MasterCard): number {
  const attrs = getCardAttributes(card)
  const sources = attrs.sources || {}
  for (const [key, src] of Object.entries(sources) as [string, any][]) {
    if (key.startsWith('1688:') && src?.data) {
      const p = Number(src.data.price_min)
      if (Number.isFinite(p) && p > 0) return p
    }
  }
  return 0
}

function getDimensions(attributes: Record<string, any>): Record<string, any> {
  const d = attributes?.dimensions
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {}
}

function getCardVolume(card: MasterCard): number {
  const dims = getDimensions(getCardAttributes(card))
  const l = Number(dims.package_length_cm || dims.length_cm || 0)
  const w = Number(dims.package_width_cm || dims.width_cm || 0)
  const h = Number(dims.package_height_cm || dims.height_cm || 0)
  return l > 0 && w > 0 && h > 0 ? l * w * h : 0
}

function getCardWeight(card: MasterCard): number {
  const dims = getDimensions(getCardAttributes(card))
  return Number(dims.package_weight_kg || dims.weight_kg || 0)
}

/* ============================================================ */
/* Item & shared cost row management                            */
/* ============================================================ */

function addItemRow(): OrderItemRow {
  const row: OrderItemRow = {
    id: ++itemCounter,
    master_card_id: '',
    quantity: 1,
    price: 0,
    currency: 'CNY',
    overhead_rub: 0,
  }
  orderItems.value.push(row)
  return row
}

function removeItemRow(rowId: number) {
  const idx = orderItems.value.findIndex((r) => r.id === rowId)
  if (idx !== -1) orderItems.value.splice(idx, 1)
  // Always keep at least one empty row
  if (!orderItems.value.length) addItemRow()
}

function onCardSelected(row: OrderItemRow, card: MasterCard) {
  const cny = getCardCnyPrice(card)
  if (cny > 0) {
    row.price = cny
    row.currency = 'CNY'
  }
  // Auto-add empty row if this was the last one
  ensureEmptyRow()
}

function ensureEmptyRow() {
  const last = orderItems.value[orderItems.value.length - 1]
  if (!last || last.master_card_id) {
    addItemRow()
  }
}

function addSharedCostRow(): SharedCostRow {
  const row: SharedCostRow = {
    id: ++costCounter,
    name: '',
    total_rub: 0,
    method: 'by_cny_price',
  }
  sharedCosts.value.push(row)
  return row
}

function removeSharedCostRow(rowId: number) {
  const idx = sharedCosts.value.findIndex((r) => r.id === rowId)
  if (idx !== -1) sharedCosts.value.splice(idx, 1)
}

/* ============================================================ */
/* Allocation logic (ported from allocateSharedCosts)            */
/* ============================================================ */

interface AllocationMap {
  [costName: string]: number
}

function computeAllocations(): AllocationMap[] {
  const items = orderItems.value.filter((r) => r.master_card_id)
  const costs = sharedCosts.value.filter((sc) => sc.name && sc.total_rub > 0)
  const allocations: AllocationMap[] = items.map(() => ({}))

  for (const sc of costs) {
    const weights = items.map((item) => {
      if (sc.method === 'by_cny_price') {
        const cnyPrice = item.currency === 'CNY' ? item.price : 0
        return cnyPrice * item.quantity
      }
      if (sc.method === 'by_volume') {
        const card = catalogStore.cards.find((c) => c.id === item.master_card_id)
        return card ? getCardVolume(card) * item.quantity : 0
      }
      if (sc.method === 'by_weight') {
        const card = catalogStore.cards.find((c) => c.id === item.master_card_id)
        return card ? getCardWeight(card) * item.quantity : 0
      }
      return item.quantity
    })
    const totalWeight = weights.reduce((a, b) => a + b, 0)
    const useEqual = totalWeight === 0
    items.forEach((_, i) => {
      const share = useEqual
        ? sc.total_rub / items.length
        : (weights[i] / totalWeight) * sc.total_rub
      allocations[i][sc.name] = Math.round(share * 100) / 100
    })
  }

  return allocations
}

/* ============================================================ */
/* Computed: totals & allocation preview                        */
/* ============================================================ */

const filledItems = computed(() =>
  orderItems.value.filter((r) => r.master_card_id),
)

const allocations = computed(() => computeAllocations())

const grandTotal = computed(() => {
  let total = 0
  filledItems.value.forEach((item, i) => {
    const alloc = allocations.value[i] || {}
    const allocated = Object.values(alloc).reduce((a, b) => a + b, 0)
    total += allocated + item.overhead_rub
  })
  return total
})

const validSharedCosts = computed(() =>
  sharedCosts.value.filter((sc) => sc.name && sc.total_rub > 0),
)

const hasPreviewData = computed(() =>
  filledItems.value.length > 0 && validSharedCosts.value.length > 0,
)

function previewItemName(item: OrderItemRow): string {
  const card = catalogStore.cards.find((c) => c.id === item.master_card_id)
  return card ? (card.sku || card.title || '\u2014') : '\u2014'
}

function previewItemAllocTotal(idx: number): number {
  const alloc = allocations.value[idx] || {}
  return Object.values(alloc).reduce((a, b) => a + b, 0) + filledItems.value[idx].overhead_rub
}

function previewItemPerUnit(idx: number): number {
  const item = filledItems.value[idx]
  const total = previewItemAllocTotal(idx)
  return item.quantity > 0 ? total / item.quantity : 0
}

/* ============================================================ */
/* Form reset & populate                                        */
/* ============================================================ */

function resetForm() {
  supplierName.value = ''
  orderDate.value = ''
  orderNotes.value = ''
  orderItems.value = []
  sharedCosts.value = []
  itemCounter = 0
  costCounter = 0
  allocationPreviewOpen.value = false
  massEditColumn.value = null
  addItemRow()
}

async function populateForEdit(orderId: string) {
  const data = await ordersStore.loadOrderDetail(orderId)
  const order = data.order
  const items = data.items || []

  supplierName.value = order.supplier_name || ''
  orderDate.value = order.order_date || ''
  orderNotes.value = order.notes || ''

  // Populate items
  orderItems.value = []
  itemCounter = 0
  for (const item of items) {
    const row = addItemRow()
    if (item.master_card_id) row.master_card_id = item.master_card_id
    row.quantity = item.quantity || 1
    // Map back from API format
    if (item.cny_price_per_unit && item.cny_price_per_unit > 0) {
      row.price = item.cny_price_per_unit
      row.currency = 'CNY'
    } else if (item.purchase_price_rub && item.purchase_price_rub > 0) {
      row.price = item.purchase_price_rub
      row.currency = 'RUB'
    }
    row.overhead_rub = item.individual_cost_rub || item.extra_cost_rub || 0
  }
  // Always have an empty row at the end
  ensureEmptyRow()

  // Populate shared costs
  sharedCosts.value = []
  costCounter = 0
  const rawSc = typeof order.shared_costs === 'string'
    ? JSON.parse(order.shared_costs)
    : order.shared_costs || []
  for (const sc of rawSc) {
    const row = addSharedCostRow()
    row.name = sc.name || ''
    row.total_rub = sc.total_rub || 0
    row.method = sc.method || 'equal'
  }
}

/* ============================================================ */
/* Watch open prop                                              */
/* ============================================================ */

watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    if (props.editingOrderId) {
      await populateForEdit(props.editingOrderId)
    } else {
      resetForm()
    }
  }
})

/* ============================================================ */
/* Submit                                                       */
/* ============================================================ */

async function onSubmit() {
  const items = filledItems.value
  if (!items.length) {
    ui.addToast('Добавьте хотя бы одну позицию', 'error')
    return
  }

  const costs = sharedCosts.value.filter((sc) => sc.name && sc.total_rub > 0)
  const allocs = computeAllocations()

  const apiItems = items.map((item, i) => {
    const alloc = allocs[i] || {}
    const allocated = Object.values(alloc).reduce((a, b) => a + b, 0)
    const allocationList = Object.entries(alloc).map(([name, val]) => ({
      name,
      allocated_rub: val,
    }))
    return {
      master_card_id: item.master_card_id,
      quantity: item.quantity,
      cny_price_per_unit: item.currency === 'CNY' ? item.price : 0,
      purchase_price_rub: item.currency === 'RUB' ? item.price : allocated,
      individual_cost_rub: item.overhead_rub,
      extra_cost_rub: item.overhead_rub,
      allocations: allocationList,
    }
  })

  const payload = {
    supplier_name: supplierName.value.trim(),
    order_date: orderDate.value || null,
    notes: orderNotes.value.trim() || null,
    shared_costs: costs.map((sc) => ({
      name: sc.name,
      total_rub: sc.total_rub,
      method: sc.method,
    })),
    items: apiItems,
  }

  saving.value = true
  try {
    if (props.editingOrderId) {
      await ordersStore.updateOrder(props.editingOrderId, payload)
      ui.addToast('Заказ обновлён', 'success')
    } else {
      await ordersStore.createOrder(payload)
      ui.addToast('Заказ создан', 'success')
    }
    emit('saved')
  } catch (err: any) {
    ui.addToast(`Ошибка: ${err.message}`, 'error')
  } finally {
    saving.value = false
  }
}

const drawerTitle = computed(() =>
  props.editingOrderId ? 'Редактирование заказа' : 'Новый заказ',
)
</script>

<template>
  <BaseDrawer :open="open" width="70vw" @close="emit('close')">
    <template #header>
      <h2 class="text-lg font-semibold text-slate-900 dark:text-white">{{ drawerTitle }}</h2>
    </template>

    <!-- Body (default slot — rendered inside scrollable area) -->
    <div class="space-y-5">
      <!-- Order meta fields -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label class="field-label">
          <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Поставщик</span>
          <input v-model="supplierName" class="form-input" placeholder="Имя поставщика" />
        </label>
        <label class="field-label">
          <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Дата заказа</span>
          <input v-model="orderDate" type="date" class="form-input" />
        </label>
        <label class="field-label">
          <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Заметки</span>
          <input v-model="orderNotes" class="form-input" placeholder="Комментарий" />
        </label>
      </div>

      <!-- Order items — TABLE -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-semibold text-slate-700 dark:text-slate-300">Позиции</span>
          <button type="button" class="ghost-btn" @click="addItemRow()">+ Добавить</button>
        </div>

        <div class="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table class="w-full text-xs">
            <thead>
              <tr class="bg-slate-50 dark:bg-slate-800/50">
                <th class="text-left px-2 py-2 text-[10px] font-semibold uppercase text-slate-500 w-[40%]">
                  Товар
                </th>
                <th class="text-center px-2 py-2 text-[10px] font-semibold uppercase text-slate-500 w-[10%]">
                  Кол-во
                </th>
                <th class="text-center px-2 py-2 text-[10px] font-semibold uppercase text-slate-500 w-[15%]">
                  Цена закупки
                </th>
                <th
                  class="text-center px-2 py-2 text-[10px] font-semibold uppercase cursor-pointer select-none w-[12%] group"
                  :class="massEditColumn === 'currency' ? 'text-sky-500' : 'text-slate-500'"
                  @click="startMassEdit('currency')"
                  title="Клик — массовое редактирование"
                >
                  <span class="inline-flex items-center gap-1">
                    Валюта
                    <svg class="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" viewBox="0 0 16 16" fill="currentColor"><path d="M12.15 4.85a.5.5 0 0 1 .01.7l-4.5 4.5a.5.5 0 0 1-.72-.01L4.84 7.84a.5.5 0 0 1 .72-.68l1.74 1.84 4.14-4.14a.5.5 0 0 1 .71-.01z"/></svg>
                  </span>
                </th>
                <th
                  class="text-center px-2 py-2 text-[10px] font-semibold uppercase cursor-pointer select-none w-[15%] group"
                  :class="massEditColumn === 'overhead_rub' ? 'text-sky-500' : 'text-slate-500'"
                  @click="startMassEdit('overhead_rub')"
                  title="Клик — распределить общую сумму поровну"
                >
                  <span class="inline-flex items-center gap-1">
                    Накладные &#x20BD;
                    <svg class="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" viewBox="0 0 16 16" fill="currentColor"><path d="M12.15 4.85a.5.5 0 0 1 .01.7l-4.5 4.5a.5.5 0 0 1-.72-.01L4.84 7.84a.5.5 0 0 1 .72-.68l1.74 1.84 4.14-4.14a.5.5 0 0 1 .71-.01z"/></svg>
                  </span>
                </th>
                <th class="w-8"></th>
              </tr>
              <!-- Mass edit row -->
              <tr v-if="massEditColumn" class="bg-sky-50 dark:bg-sky-900/20 border-b border-sky-100 dark:border-sky-800">
                <td :colspan="6" class="px-2 py-2">
                  <div class="flex items-center gap-2 text-xs">
                    <span class="text-slate-600 dark:text-slate-300">
                      {{ massEditColumn === 'currency' ? 'Установить валюту для всех:' : 'Общая сумма накладных (распределить поровну):' }}
                    </span>
                    <select
                      v-if="massEditColumn === 'currency'"
                      v-model="massEditValue"
                      class="form-input !mt-0 w-24 !py-1 !text-xs"
                    >
                      <option value="CNY">CNY</option>
                      <option value="RUB">RUB</option>
                      <option value="USD">USD</option>
                    </select>
                    <input
                      v-else
                      v-model.number="massEditValue"
                      type="number"
                      step="0.01"
                      min="0"
                      class="form-input !mt-0 w-28 !py-1 !text-xs"
                      placeholder="Сумма"
                    />
                    <button type="button" class="ghost-btn" @click="applyMassEdit">Применить</button>
                    <button type="button" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" @click="massEditColumn = null">&times;</button>
                  </div>
                </td>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in orderItems"
                :key="item.id"
                class="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
              >
                <!-- Product combobox -->
                <td class="px-2 py-1.5">
                  <ProductCombobox
                    v-model="item.master_card_id"
                    @select="(card: MasterCard) => onCardSelected(item, card)"
                  />
                </td>
                <!-- Quantity -->
                <td class="px-2 py-1.5">
                  <input
                    v-model.number="item.quantity"
                    type="number"
                    step="1"
                    min="1"
                    class="form-input !mt-0 w-full text-center !py-1 !text-xs tabular-nums"
                  />
                </td>
                <!-- Price -->
                <td class="px-2 py-1.5">
                  <input
                    v-model.number="item.price"
                    type="number"
                    step="0.01"
                    min="0"
                    class="form-input !mt-0 w-full text-right !py-1 !text-xs tabular-nums"
                  />
                </td>
                <!-- Currency -->
                <td class="px-2 py-1.5">
                  <select v-model="item.currency" class="form-input !mt-0 w-full !py-1 !text-xs text-center">
                    <option value="CNY">CNY</option>
                    <option value="RUB">RUB</option>
                    <option value="USD">USD</option>
                  </select>
                </td>
                <!-- Overhead -->
                <td class="px-2 py-1.5">
                  <input
                    v-model.number="item.overhead_rub"
                    type="number"
                    step="0.01"
                    min="0"
                    class="form-input !mt-0 w-full text-right !py-1 !text-xs tabular-nums"
                  />
                </td>
                <!-- Remove -->
                <td class="px-1 py-1.5 text-center">
                  <button
                    type="button"
                    class="text-slate-300 hover:text-red-400 transition-colors text-base leading-none"
                    @click="removeItemRow(item.id)"
                  >&times;</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Shared costs -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-semibold text-slate-700 dark:text-slate-300">Общие расходы</span>
          <button type="button" class="ghost-btn" @click="addSharedCostRow()">+ Добавить</button>
        </div>
        <div class="space-y-2">
          <div v-for="sc in sharedCosts" :key="sc.id" class="shared-cost-row">
            <label class="field-label">
              <span class="text-[10px] text-slate-400">Название</span>
              <input v-model="sc.name" class="form-input" placeholder="Закупка товара" />
            </label>
            <label class="field-label">
              <span class="text-[10px] text-slate-400">Сумма &#x20BD;</span>
              <input v-model.number="sc.total_rub" type="number" step="0.01" min="0" class="form-input" />
            </label>
            <label class="field-label">
              <span class="text-[10px] text-slate-400">Распределить по</span>
              <select v-model="sc.method" class="form-input">
                <option value="by_cny_price">Цена CNY</option>
                <option value="by_volume">Объём</option>
                <option value="by_weight">Вес</option>
                <option value="equal">Равномерно</option>
              </select>
            </label>
            <button type="button" class="remove-row-btn" @click="removeSharedCostRow(sc.id)">&times;</button>
          </div>
        </div>
      </div>

      <!-- Allocation preview (collapsible) -->
      <div v-if="hasPreviewData">
        <button
          type="button"
          class="text-sm font-medium text-sky-500 hover:text-sky-600 transition-colors flex items-center gap-1"
          @click="allocationPreviewOpen = !allocationPreviewOpen"
        >
          <span :class="allocationPreviewOpen ? 'rotate-90' : ''" class="inline-block transition-transform">&#x25B6;</span>
          Распределение расходов
        </button>
        <div v-if="allocationPreviewOpen" class="mt-2 overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="bg-slate-50 dark:bg-slate-800/50">
                <th class="text-left px-2 py-1.5 text-[10px] font-semibold uppercase text-slate-500">Товар</th>
                <th v-for="sc in validSharedCosts" :key="sc.name" class="text-right px-2 py-1.5 text-[10px] font-semibold uppercase text-slate-500">{{ sc.name }}</th>
                <th class="text-right px-2 py-1.5 text-[10px] font-semibold uppercase text-slate-500">Накл.</th>
                <th class="text-right px-2 py-1.5 text-[10px] font-semibold uppercase text-slate-500">Итого</th>
                <th class="text-right px-2 py-1.5 text-[10px] font-semibold uppercase text-slate-500">Итого/шт</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, idx) in filledItems" :key="item.id" class="border-t border-slate-100 dark:border-slate-800">
                <td class="px-2 py-1.5">{{ previewItemName(item) }}</td>
                <td v-for="sc in validSharedCosts" :key="sc.name" class="px-2 py-1.5 text-right tabular-nums">
                  {{ formatMoney((allocations[idx] || {})[sc.name] || 0) }}
                </td>
                <td class="px-2 py-1.5 text-right tabular-nums">{{ formatMoney(item.overhead_rub) }}</td>
                <td class="px-2 py-1.5 text-right tabular-nums font-medium">{{ formatMoney(previewItemAllocTotal(idx)) }}</td>
                <td class="px-2 py-1.5 text-right tabular-nums">{{ formatMoney(previewItemPerUnit(idx)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="px-5 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <span class="text-sm font-semibold text-slate-700 dark:text-slate-300">
          Итого: {{ formatMoney(grandTotal) }}
        </span>
        <div class="flex items-center gap-3">
          <button v-if="editingOrderId" class="ghost-btn" @click="emit('close')">Отмена</button>
          <button
            class="px-5 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50"
            :disabled="saving"
            @click="onSubmit"
          >
            {{ editingOrderId ? 'Сохранить изменения' : 'Создать заказ' }}
          </button>
        </div>
      </div>
    </template>
  </BaseDrawer>
</template>
