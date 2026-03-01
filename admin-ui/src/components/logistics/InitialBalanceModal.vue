<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import BaseModal from '@/components/shared/BaseModal.vue'
import { useOrdersStore } from '@/stores/orders'
import { useUiStore } from '@/stores/ui'
import { apiRequest } from '@/utils/api'
import { formatMoney } from '@/utils/format'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const ordersStore = useOrdersStore()
const ui = useUiStore()

/* ============================================================ */
/* State                                                        */
/* ============================================================ */

interface IBItem {
  master_card_id: string
  title: string
  sku: string
  stock: number
  unit_cost: number
  selected: boolean
}

const items = ref<IBItem[]>([])
const subtitle = ref('')
const contentVisible = ref(false)
const confirming = ref(false)
const selectAll = ref(true)

/* ============================================================ */
/* Load stocks on open                                          */
/* ============================================================ */

watch(() => props.open, async (isOpen) => {
  if (!isOpen) return
  items.value = []
  contentVisible.value = false
  subtitle.value = 'Загрузка остатков с Ozon...'
  try {
    const data = await apiRequest<{ items?: Array<{ master_card_id: string; title?: string; sku?: string; stock_present: number }>; message?: string }>(
      '/ozon/stocks',
      { method: 'POST', body: {} },
    )
    if (!data.items || data.items.length === 0) {
      subtitle.value = data.message || 'Нет товаров с остатками на Ozon. Сначала импортируйте товары.'
      return
    }
    items.value = data.items.map((it) => ({
      master_card_id: it.master_card_id,
      title: it.title || it.sku || '\u2014',
      sku: it.sku || '',
      stock: it.stock_present,
      unit_cost: 0,
      selected: true,
    }))
    subtitle.value = `Найдено ${items.value.length} товаров с остатками. Укажите себестоимость за единицу.`
    contentVisible.value = true
    selectAll.value = true
  } catch (err: any) {
    subtitle.value = `Ошибка: ${err.message}`
  }
})

/* ============================================================ */
/* Computed                                                     */
/* ============================================================ */

const grandTotal = computed(() =>
  items.value.reduce((sum, it) => sum + (it.selected ? it.unit_cost * it.stock : 0), 0),
)

/* ============================================================ */
/* Select all                                                   */
/* ============================================================ */

function onSelectAllChange() {
  items.value.forEach((it) => { it.selected = selectAll.value })
}

/* ============================================================ */
/* Confirm                                                      */
/* ============================================================ */

async function onConfirm() {
  const selected = items.value.filter((it) => it.selected && it.stock > 0)
  if (selected.length === 0) {
    ui.addToast('Выберите хотя бы один товар', 'error')
    return
  }
  const withoutCost = selected.filter((it) => !it.unit_cost || it.unit_cost <= 0)
  if (withoutCost.length > 0 && !confirm(`У ${withoutCost.length} товаров не указана себестоимость. Продолжить с нулевой себестоимостью?`)) return

  confirming.value = true
  try {
    const apiItems = selected.map((it) => ({
      master_card_id: it.master_card_id,
      quantity: it.stock,
      unit_cost_rub: it.unit_cost || 0,
    }))
    const result = await apiRequest<{ items_count: number; purchase_amount_rub: number }>(
      '/inventory/initial-balance',
      { method: 'POST', body: { items: apiItems } },
    )
    ui.addToast(
      `Остатки оприходованы: ${result.items_count} позиций на ${formatMoney(result.purchase_amount_rub)}`,
      'success',
    )
    await ordersStore.loadOrders()
    emit('close')
  } catch (err: any) {
    ui.addToast(`Ошибка: ${err.message}`, 'error')
  } finally {
    confirming.value = false
  }
}
</script>

<template>
  <BaseModal :open="open" @close="emit('close')">
    <h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-1">Начальные остатки</h2>
    <p class="text-sm text-slate-500 dark:text-slate-400 mb-4">{{ subtitle }}</p>

    <div v-if="contentVisible" class="space-y-4">
      <div class="overflow-x-auto max-h-[50vh] overflow-y-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-white dark:bg-slate-900">
            <tr class="bg-slate-50 dark:bg-slate-800/50">
              <th class="px-4 py-2 w-10">
                <input
                  v-model="selectAll"
                  type="checkbox"
                  @change="onSelectAllChange"
                />
              </th>
              <th class="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Товар</th>
              <th class="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Остаток</th>
              <th class="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Себест./шт</th>
              <th class="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Итого</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(it, idx) in items"
              :key="it.master_card_id"
              class="border-t border-slate-100 dark:border-slate-800"
              :class="{ 'opacity-40': !it.selected }"
            >
              <td class="px-4 py-2">
                <input v-model="it.selected" type="checkbox" />
              </td>
              <td class="px-4 py-2 text-sm">
                {{ it.title }}<br />
                <span class="text-xs text-slate-400">{{ it.sku }}</span>
              </td>
              <td class="px-4 py-2 text-right text-sm tabular-nums">{{ it.stock }}</td>
              <td class="px-4 py-2 text-right">
                <input
                  v-model.number="it.unit_cost"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  class="form-input w-24 text-right text-sm py-1"
                />
              </td>
              <td class="px-4 py-2 text-right text-sm tabular-nums">
                {{ formatMoney(it.selected ? it.unit_cost * it.stock : 0) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between">
        <span class="text-sm font-semibold text-slate-700 dark:text-slate-300">
          Итого: {{ formatMoney(grandTotal) }}
        </span>
        <div class="flex items-center gap-3">
          <button class="ghost-btn" @click="emit('close')">Отмена</button>
          <button
            class="px-5 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors disabled:opacity-50"
            :disabled="confirming"
            @click="onConfirm"
          >
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  </BaseModal>
</template>
