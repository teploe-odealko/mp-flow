<script setup lang="ts">
import { ref } from 'vue'
import { useLogisticsStore, type Supply } from '@/stores/logistics'

const logisticsStore = useLogisticsStore()
const expandedSupplies = ref<Set<string>>(new Set())

const SUPPLY_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Черновик', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  CREATED: { label: 'Создана', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  IN_TRANSIT: { label: 'В пути', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
  ACCEPTANCE: { label: 'Приёмка', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  ACCEPTED: { label: 'Принята', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  ACCEPTED_WITH_DISCREPANCY: { label: 'С расхождением', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  CANCELLED: { label: 'Отменена', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
}

function statusInfo(status: string) {
  return SUPPLY_STATUS_MAP[status] || { label: status, cls: 'bg-slate-100 text-slate-600' }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '\u2014'
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function toggleSupply(id: string) {
  if (expandedSupplies.value.has(id)) {
    expandedSupplies.value.delete(id)
  } else {
    expandedSupplies.value.add(id)
  }
}

function isExpanded(id: string): boolean {
  return expandedSupplies.value.has(id)
}

function itemDiff(item: { planned: number; accepted: number }): number {
  return item.accepted > 0 ? item.planned - item.accepted : 0
}

function diffClass(diff: number): string {
  if (diff > 0) return 'text-red-600 dark:text-red-400 font-semibold'
  if (diff < 0) return 'text-blue-600'
  return 'text-slate-400'
}

function diffText(diff: number): string {
  if (diff > 0) return `\u2212${diff}`
  if (diff < 0) return `+${Math.abs(diff)}`
  return '\u2014'
}

function acceptedClass(s: Supply): string {
  if (s.total_accepted <= 0) return 'text-slate-400'
  return s.has_discrepancy
    ? 'text-red-600 dark:text-red-400 font-semibold'
    : 'text-green-600 dark:text-green-400'
}

function acceptedText(s: Supply): string {
  let text = s.total_accepted > 0 ? `Принято: ${s.total_accepted}` : 'Ожидает'
  if (s.total_rejected > 0) text += ` / Брак: ${s.total_rejected}`
  return text
}
</script>

<template>
  <div class="space-y-3">
    <template v-if="logisticsStore.suppliesData && logisticsStore.suppliesData.length">
      <div
        v-for="s in logisticsStore.suppliesData"
        :key="s.id"
        class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm"
      >
        <!-- Header -->
        <div
          class="flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800/50 cursor-pointer select-none"
          @click="toggleSupply(s.id)"
        >
          <svg
            class="w-4 h-4 text-slate-400 transition-transform"
            :class="{ 'rotate-90': isExpanded(s.id) }"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-sm text-slate-900 dark:text-white">
                {{ s.supply_number || `#${s.supply_order_id}` }}
              </span>
              <span :class="'inline-flex px-2 py-0.5 rounded-full text-xs font-medium ' + statusInfo(s.status).cls">
                {{ statusInfo(s.status).label }}
              </span>
              <span
                v-if="s.has_discrepancy"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
              >
                Расхождение
              </span>
            </div>
            <div class="text-xs text-slate-500 mt-0.5">
              {{ s.warehouse_name || 'Склад не указан' }} &middot; {{ formatDate(s.created_at) }}
            </div>
          </div>
          <div class="text-right flex-shrink-0">
            <div class="text-sm font-semibold text-slate-900 dark:text-white">{{ s.total_planned }} шт.</div>
            <div class="text-xs" :class="acceptedClass(s)">
              {{ acceptedText(s) }}
            </div>
          </div>
        </div>

        <!-- Items table -->
        <div v-show="isExpanded(s.id)" class="border-t border-slate-200 dark:border-slate-700">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-slate-50/50 dark:bg-slate-800/30">
                <th class="text-left px-4 py-2 text-xs font-semibold text-slate-500">Товар</th>
                <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">План</th>
                <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Принято</th>
                <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Брак</th>
                <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Расхождение</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              <tr v-for="item in s.items" :key="item.offer_id">
                <td class="px-4 py-2">
                  <span class="text-slate-900 dark:text-white">{{ item.product_name || item.offer_id || '\u2014' }}</span>
                  <span v-if="item.card_sku" class="text-xs text-slate-400 ml-1">({{ item.card_sku }})</span>
                </td>
                <td class="text-right px-3 py-2">{{ item.planned }}</td>
                <td :class="'text-right px-3 py-2 ' + (item.accepted > 0 ? '' : 'text-slate-400')">
                  {{ item.accepted || '\u2014' }}
                </td>
                <td :class="'text-right px-3 py-2 ' + (item.rejected > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-400')">
                  {{ item.rejected || '\u2014' }}
                </td>
                <td :class="'text-right px-3 py-2 ' + diffClass(itemDiff(item))">
                  {{ diffText(itemDiff(item)) }}
                </td>
              </tr>
              <tr v-if="!s.items.length">
                <td colspan="5" class="px-4 py-3 text-center text-slate-400">Нет товаров в поставке</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <div
      v-else-if="logisticsStore.suppliesData !== null && logisticsStore.suppliesData !== undefined && !logisticsStore.suppliesData.length"
      class="text-center text-sm text-slate-400 py-8"
    >
      Нет данных о поставках. Нажмите "Синхронизировать" для загрузки.
    </div>

    <div v-else class="text-center text-sm text-slate-400 py-8">
      Загрузка...
    </div>
  </div>
</template>
