<script setup lang="ts">
import { ref, watch } from 'vue'
import { useLogisticsStore, type SkuDetail } from '@/stores/logistics'
import { useUiStore } from '@/stores/ui'
import { formatMoney, formatDateTime } from '@/utils/format'
import BaseDrawer from '@/components/shared/BaseDrawer.vue'

const props = defineProps<{
  open: boolean
  masterCardId: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

const logisticsStore = useLogisticsStore()
const ui = useUiStore()
const loading = ref(false)
const data = ref<SkuDetail | null>(null)

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen && props.masterCardId) {
      loading.value = true
      try {
        data.value = await logisticsStore.loadSkuDetail(props.masterCardId)
      } catch (err: any) {
        ui.addToast('Ошибка загрузки: ' + (err.message || ''), 'error')
      } finally {
        loading.value = false
      }
    }
  },
)

const editingItemId = ref<string | null>(null)
const editingValue = ref('')

function startEditAcceptance(itemId: string, planned: number, currentAccepted: number | null) {
  editingItemId.value = itemId
  editingValue.value = currentAccepted != null ? String(currentAccepted) : ''
}

async function finishEditAcceptance(itemId: string, planned: number, save: boolean) {
  if (!save) {
    editingItemId.value = null
    return
  }
  const val = parseInt(editingValue.value, 10)
  if (isNaN(val) || val < 0 || val > planned) {
    ui.addToast('Некорректное значение', 'error')
    editingItemId.value = null
    return
  }
  try {
    await logisticsStore.updateAcceptance({
      item_id: itemId,
      quantity_accepted: val,
    })
    const rejected = planned - val
    ui.addToast(`Принято: ${val}, отклонено: ${rejected}`)
    // Refresh data
    if (props.masterCardId) {
      data.value = await logisticsStore.loadSkuDetail(props.masterCardId)
    }
  } catch (err: any) {
    ui.addToast('Ошибка: ' + (err.message || ''), 'error')
  }
  editingItemId.value = null
}

function onEditKeydown(e: KeyboardEvent, itemId: string, planned: number) {
  if (e.key === 'Enter') finishEditAcceptance(itemId, planned, true)
  if (e.key === 'Escape') finishEditAcceptance(itemId, planned, false)
}

function isCancelled(status: string | null): boolean {
  return (status || '').includes('CANCEL')
}
</script>

<template>
  <BaseDrawer :open="open" width="640px" @close="emit('close')">
    <div class="h-full flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-white truncate">
          {{ data?.card?.sku || '\u2014' }} &mdash; {{ data?.card?.title || '' }}
        </h2>
        <button
          class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          @click="emit('close')"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-4 space-y-6">
        <div v-if="loading" class="text-center py-8 text-sm text-slate-400">Загрузка...</div>

        <template v-else-if="data">
          <!-- Supplier Orders -->
          <section>
            <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Закупки у поставщиков</h3>
            <div class="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table class="w-full text-sm">
                <thead>
                  <tr class="bg-slate-50 dark:bg-slate-800/50">
                    <th class="text-left px-3 py-2 text-xs font-semibold text-slate-500">Заказ</th>
                    <th class="text-left px-3 py-2 text-xs font-semibold text-slate-500">Дата</th>
                    <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Заказано</th>
                    <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Получено</th>
                    <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Себест.</th>
                    <th class="text-left px-3 py-2 text-xs font-semibold text-slate-500">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="o in data.supplier_orders" :key="o.order_number">
                    <td class="px-3 py-2">{{ o.order_number || '\u2014' }}</td>
                    <td class="px-3 py-2">{{ o.order_date || '\u2014' }}</td>
                    <td class="text-right px-3 py-2">{{ Number(o.quantity || 0) }}</td>
                    <td class="text-right px-3 py-2">{{ o.received_qty != null ? Number(o.received_qty) : '\u2014' }}</td>
                    <td class="text-right px-3 py-2">{{ formatMoney(o.unit_cost_rub || 0) }}</td>
                    <td class="px-3 py-2">{{ o.status || '\u2014' }}</td>
                  </tr>
                  <tr v-if="!data.supplier_orders?.length">
                    <td colspan="6" class="px-3 py-2 text-slate-400 text-sm">Нет закупок</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Ozon Supplies -->
          <section>
            <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Поставки на Ozon</h3>
            <div class="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table class="w-full text-sm">
                <thead>
                  <tr class="bg-slate-50 dark:bg-slate-800/50">
                    <th class="text-left px-3 py-2 text-xs font-semibold text-slate-500">Поставка</th>
                    <th class="text-left px-3 py-2 text-xs font-semibold text-slate-500">Склад</th>
                    <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">План</th>
                    <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Принято</th>
                    <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Брак</th>
                    <th class="text-left px-3 py-2 text-xs font-semibold text-slate-500">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in data.ozon_supplies" :key="s.item_id">
                    <td class="px-3 py-2">{{ s.supply_number || '\u2014' }}</td>
                    <td class="px-3 py-2">{{ s.warehouse_name || '\u2014' }}</td>
                    <td class="text-right px-3 py-2">{{ s.quantity_planned }}</td>
                    <td class="text-right px-3 py-2">
                      <template v-if="isCancelled(s.status)">
                        <span class="text-slate-400">\u2014</span>
                      </template>
                      <template v-else-if="editingItemId === s.item_id">
                        <input
                          v-model="editingValue"
                          type="number"
                          :min="0"
                          :max="s.quantity_planned"
                          class="w-16 text-right text-sm bg-white dark:bg-slate-800 border border-blue-400 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          autofocus
                          @keydown="onEditKeydown($event, s.item_id, s.quantity_planned)"
                          @blur="finishEditAcceptance(s.item_id, s.quantity_planned, true)"
                        />
                      </template>
                      <template v-else>
                        <span
                          class="cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 px-1.5 py-0.5 rounded"
                          title="Нажмите для редактирования"
                          @click="startEditAcceptance(s.item_id, s.quantity_planned, s.quantity_accepted)"
                        >
                          {{ s.quantity_accepted || '?' }}
                        </span>
                      </template>
                    </td>
                    <td :class="'text-right px-3 py-2 ' + (isCancelled(s.status) ? 'text-slate-400' : (s.quantity_rejected > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : ''))">
                      {{ isCancelled(s.status) ? '\u2014' : (s.quantity_rejected || '\u2014') }}
                    </td>
                    <td class="px-3 py-2">{{ s.status || '\u2014' }}</td>
                  </tr>
                  <tr v-if="!data.ozon_supplies?.length">
                    <td colspan="6" class="px-3 py-2 text-slate-400 text-sm">Нет поставок на Ozon</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Stock -->
          <section>
            <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Остатки по складам</h3>
            <div class="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table class="w-full text-sm">
                <thead>
                  <tr class="bg-slate-50 dark:bg-slate-800/50">
                    <th class="text-left px-3 py-2 text-xs font-semibold text-slate-500">Склад</th>
                    <th class="text-left px-3 py-2 text-xs font-semibold text-slate-500">Тип</th>
                    <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Всего</th>
                    <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Резерв</th>
                    <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Свободно</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(st, i) in data.stock_snapshots" :key="i">
                    <td class="px-3 py-2">{{ st.warehouse_name || '\u2014' }}</td>
                    <td class="px-3 py-2">{{ st.stock_type }}</td>
                    <td class="text-right px-3 py-2">{{ st.present }}</td>
                    <td class="text-right px-3 py-2">{{ st.reserved }}</td>
                    <td class="text-right px-3 py-2 font-semibold">{{ st.free_to_sell }}</td>
                  </tr>
                  <tr v-if="!data.stock_snapshots?.length">
                    <td colspan="5" class="px-3 py-2 text-slate-400 text-sm">Нет данных об остатках</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- FIFO Lots -->
          <section>
            <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Лоты FIFO</h3>
            <div class="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table class="w-full text-sm">
                <thead>
                  <tr class="bg-slate-50 dark:bg-slate-800/50">
                    <th class="text-left px-3 py-2 text-xs font-semibold text-slate-500">Дата</th>
                    <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Начальное</th>
                    <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Остаток</th>
                    <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Себест.</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(l, i) in data.inventory_lots" :key="i">
                    <td class="px-3 py-2">{{ formatDateTime(l.received_at) }}</td>
                    <td class="text-right px-3 py-2">{{ Number(l.initial_qty) }}</td>
                    <td class="text-right px-3 py-2 font-semibold">{{ Number(l.remaining_qty) }}</td>
                    <td class="text-right px-3 py-2">{{ formatMoney(l.unit_cost_rub) }}</td>
                  </tr>
                  <tr v-if="!data.inventory_lots?.length">
                    <td colspan="4" class="px-3 py-2 text-slate-400 text-sm">Нет лотов</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Losses -->
          <section v-if="data.losses && data.losses.total_qty > 0">
            <h3 class="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">Потери</h3>
            <div class="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 text-sm">
              <p class="font-semibold">
                Всего потерь: {{ data.losses.total_qty }} шт. на {{ formatMoney(data.losses.total_cost_rub) }}
              </p>
              <p
                v-for="(d, i) in data.losses.details"
                :key="i"
                class="text-slate-500"
              >
                - {{ d.source }}: {{ d.qty }} шт. ({{ formatMoney(d.cost_rub) }})
              </p>
            </div>
          </section>
        </template>
      </div>
    </div>
  </BaseDrawer>
</template>
