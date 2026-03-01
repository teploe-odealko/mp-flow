<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useOrdersStore } from '@/stores/orders'
import { useUiStore } from '@/stores/ui'
import { formatMoney } from '@/utils/format'

const props = defineProps<{
  open: boolean
  orderId: string | null
}>()

const emit = defineEmits<{
  close: []
  received: []
}>()

const ordersStore = useOrdersStore()
const ui = useUiStore()

/* ============================================================ */
/* State                                                        */
/* ============================================================ */

interface ReceiveItemRow {
  item_id: string
  title: string
  ordered_qty: number
  individual_cost_rub: number
  purchase_price_rub: number
  recv_qty: number
}

const items = ref<ReceiveItemRow[]>([])
const subtitle = ref('')
const confirming = ref(false)

/* ============================================================ */
/* Load order items on open                                     */
/* ============================================================ */

watch(() => props.open, async (isOpen) => {
  if (!isOpen || !props.orderId) return
  items.value = []
  subtitle.value = 'Загрузка...'
  try {
    const data = await ordersStore.loadOrderDetail(props.orderId)
    const orderItems = data.items || []
    items.value = orderItems.map((it) => ({
      item_id: it.id,
      title: it.title || it.master_card_title || '\u2014',
      ordered_qty: Number(it.quantity || 0),
      individual_cost_rub: Number(it.individual_cost_rub || 0),
      purchase_price_rub: Number(it.purchase_price_rub || 0),
      recv_qty: Number(it.quantity || 0),
    }))
    subtitle.value = `Заказ #${data.order?.order_number || props.orderId} \u2014 ${data.order?.supplier_name || ''}`
  } catch (err: any) {
    subtitle.value = `Ошибка: ${err.message}`
  }
})

/* ============================================================ */
/* Computed totals                                              */
/* ============================================================ */

function unitCost(item: ReceiveItemRow): number {
  const lineTotal = item.individual_cost_rub + item.purchase_price_rub
  return item.recv_qty > 0 ? lineTotal / item.recv_qty : 0
}

function rowTotal(item: ReceiveItemRow): number {
  return item.recv_qty > 0 ? item.individual_cost_rub + item.purchase_price_rub : 0
}

const grandTotal = computed(() =>
  items.value.reduce((sum, it) => sum + rowTotal(it), 0),
)

/* ============================================================ */
/* Confirm receive                                              */
/* ============================================================ */

async function onConfirm() {
  if (!props.orderId) return
  confirming.value = true
  try {
    const receiveItems = items.value.map((it) => ({
      item_id: it.item_id,
      received_qty: it.recv_qty,
    }))
    await ordersStore.receiveOrder(props.orderId, receiveItems)
    emit('received')
  } catch (err: any) {
    ui.addToast(`Ошибка приёмки: ${err.message}`, 'error')
  } finally {
    confirming.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @mousedown.self="emit('close')">
      <div class="modal-content max-w-2xl" @mousedown.stop>
        <!-- Header -->
        <div class="flex justify-between items-center mb-4">
          <div>
            <h3 class="text-lg font-semibold text-slate-900 dark:text-white">Приёмка заказа</h3>
            <p class="text-sm text-slate-500 dark:text-slate-400">{{ subtitle }}</p>
          </div>
          <button
            class="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            @click="emit('close')"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Items table -->
        <div v-if="items.length" class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-slate-50 dark:bg-slate-800/50">
                <th class="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Товар</th>
                <th class="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Заказано</th>
                <th class="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Принять</th>
                <th class="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Себест./шт</th>
                <th class="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Итого</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="it in items"
                :key="it.item_id"
                class="border-t border-slate-100 dark:border-slate-800"
              >
                <td class="px-4 py-2">{{ it.title }}</td>
                <td class="px-4 py-2 text-right tabular-nums">{{ it.ordered_qty }}</td>
                <td class="px-4 py-2 text-right">
                  <input
                    v-model.number="it.recv_qty"
                    type="number"
                    min="0"
                    step="1"
                    class="form-input w-20 text-right text-sm py-1"
                  />
                </td>
                <td class="px-4 py-2 text-right tabular-nums">{{ formatMoney(unitCost(it)) }}</td>
                <td class="px-4 py-2 text-right tabular-nums">{{ formatMoney(rowTotal(it)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Footer -->
        <div class="mt-4 flex items-center justify-between">
          <span class="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Итого расход: {{ formatMoney(grandTotal) }}
          </span>
          <div class="flex items-center gap-3">
            <button class="ghost-btn" @click="emit('close')">Отмена</button>
            <button
              class="px-5 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50"
              :disabled="confirming"
              @click="onConfirm"
            >
              Подтвердить приёмку
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
