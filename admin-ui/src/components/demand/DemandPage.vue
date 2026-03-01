<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useDemandStore, type DemandItem, type ClusterBreakdown } from '@/stores/demand'
import { useUiStore } from '@/stores/ui'

const demandStore = useDemandStore()
const ui = useUiStore()

const leadTime = ref(45)
const bufferDays = ref(60)
const generating = ref(false)
const confirming = ref(false)

const TURNOVER_BADGE: Record<string, { cls: string; label: string }> = {
  DEFICIT: { cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'Дефицит' },
  POPULAR: { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', label: 'Популярный' },
  ACTUAL: { cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', label: 'В норме' },
  SURPLUS: { cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: 'Излишек' },
  NO_SALES: { cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500', label: 'Нет продаж' },
  DEAD_STOCK: { cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500', label: 'Мёртвый сток' },
  COLLECTING_DATA: { cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500', label: 'Сбор данных' },
  WAS_DEFICIT: { cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', label: 'Был дефицит' },
}

onMounted(() => {
  demandStore.loadDemandClusterStock()
})

const totalHorizon = computed(() => leadTime.value + bufferDays.value)
const ltPct = computed(() => ((leadTime.value / totalHorizon.value) * 100).toFixed(1))
const bufPct = computed(() => ((bufferDays.value / totalHorizon.value) * 100).toFixed(1))

const items = computed(() => demandStore.demandPlan?.items || [])

const planLeadTime = computed(() => demandStore.demandPlan?.lead_time_days || leadTime.value)

const summaryCards = computed(() => {
  const lt = planLeadTime.value
  const urgent = items.value.filter(i => i.idc_global != null && i.idc_global < 20 && i.recommended_qty > 0)
  const soon = items.value.filter(i => i.idc_global != null && i.idc_global >= 20 && i.idc_global < lt && i.recommended_qty > 0)
  const normal = items.value.filter(i => i.recommended_qty <= 0 || i.idc_global == null || i.idc_global >= lt)
  return {
    urgentCount: urgent.length,
    urgentQty: urgent.reduce((s, i) => s + i.recommended_qty, 0),
    soonCount: soon.length,
    soonQty: soon.reduce((s, i) => s + i.recommended_qty, 0),
    normalCount: normal.length,
  }
})

const totalItems = computed(() => items.value.filter(i => i.recommended_qty > 0).length)
const totalQty = computed(() => items.value.reduce((s, i) => s + (i.recommended_qty || 0), 0))

const freshnessBanner = computed(() => {
  if (!demandStore.demandSyncedAt) return null
  const syncDate = new Date(demandStore.demandSyncedAt)
  const hoursAgo = Math.round((Date.now() - syncDate.getTime()) / 3600000)
  const dateStr = syncDate.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return { hoursAgo, dateStr, stale: hoursAgo > 24 }
})

function idcColor(idc: number | null, target: number): string {
  if (idc == null) return 'text-slate-400'
  if (idc < target * 0.44) return 'text-red-600 dark:text-red-400'
  if (idc < target) return 'text-amber-600 dark:text-amber-400'
  return 'text-green-600 dark:text-green-400'
}

function idcBarPct(idc: number | null, target: number): number {
  if (idc == null) return 0
  return Math.min(100, Math.round((idc / target) * 100))
}

function idcBarColor(idc: number | null, target: number): string {
  if (idc == null) return 'bg-slate-300'
  if (idc < target * 0.44) return 'bg-red-500'
  if (idc < target) return 'bg-amber-500'
  return 'bg-green-500'
}

function turnoverBadge(grade: string | null) {
  return TURNOVER_BADGE[grade || 'COLLECTING_DATA'] || TURNOVER_BADGE.COLLECTING_DATA
}

function sourceBadge(source: string): string {
  if (source === 'ozon') return 'oz'
  if (source === 'manual') return '\u2699'
  return ''
}

function sourceBadgeClass(source: string): string {
  if (source === 'ozon') return 'text-[10px] text-blue-500 font-medium align-super'
  if (source === 'manual') return 'text-[10px] text-orange-500 font-medium align-super'
  return ''
}

async function generatePlan() {
  generating.value = true
  try {
    const plan = await demandStore.generatePlan({
      lead_time_days: leadTime.value,
      buffer_days: bufferDays.value,
    })
    ui.addToast(`План сгенерирован: ${plan.total_items} товаров, ${plan.total_qty} шт`, 'success')
  } catch (err: any) {
    ui.addToast('Ошибка генерации: ' + (err.message || ''), 'error')
  } finally {
    generating.value = false
  }
}

async function confirmPlan() {
  if (!demandStore.demandPlan) return
  confirming.value = true
  try {
    await demandStore.confirmPlan(demandStore.demandPlan.plan_id)
    ui.addToast('План подтверждён', 'success')
  } catch (err: any) {
    ui.addToast('Ошибка: ' + (err.message || ''), 'error')
  } finally {
    confirming.value = false
  }
}

function toggleRow(cardId: string) {
  demandStore.toggleExpandedRow(cardId)
}

function isExpanded(cardId: string): boolean {
  return demandStore.demandExpandedRows.has(cardId)
}

function clusterCurrentStock(c: ClusterBreakdown): number {
  return c.available + (c.in_transit || 0)
}

function clusterStockAtArrival(c: ClusterBreakdown, lt: number): number {
  return c.stock_at_arrival ?? Math.max(0, clusterCurrentStock(c) - Math.ceil(lt * (c.ads || 0)))
}
</script>

<template>
  <div class="space-y-4">
    <!-- Freshness banner -->
    <div
      v-if="freshnessBanner"
      :class="[
        'p-3 rounded-lg text-sm flex items-center gap-2',
        freshnessBanner.stale
          ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
          : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
      ]"
    >
      <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path v-if="freshnessBanner.stale" stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        <path v-else stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <template v-if="freshnessBanner.stale">
        Данные устарели ({{ freshnessBanner.dateStr }}, {{ freshnessBanner.hoursAgo }}ч назад). Рекомендуем обновить.
      </template>
      <template v-else>
        Данные Ozon: {{ freshnessBanner.dateStr }} ({{ freshnessBanner.hoursAgo }}ч назад)
      </template>
    </div>

    <!-- Controls -->
    <div class="flex flex-wrap items-end gap-4">
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Срок доставки (дн.)</label>
        <input v-model.number="leadTime" type="number" min="1" class="w-24 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Запас (дн.)</label>
        <input v-model.number="bufferDays" type="number" min="1" class="w-24 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
      </div>
      <div class="text-sm text-slate-500">Горизонт: <b>{{ totalHorizon }}</b> дн.</div>
    </div>

    <!-- Visual timeline -->
    <div class="relative h-6 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
      <div class="absolute left-0 top-0 h-full bg-sky-400 dark:bg-sky-600 rounded-l-full" :style="{ width: ltPct + '%' }" />
      <div class="absolute top-0 h-full bg-emerald-400 dark:bg-emerald-600" :style="{ left: ltPct + '%', width: bufPct + '%' }" />
      <div class="absolute top-full mt-0.5 text-[10px] text-slate-500 -translate-x-1/2" :style="{ left: ltPct + '%' }">
        Приход (д.{{ leadTime }})
      </div>
    </div>

    <!-- Generate button -->
    <div class="flex gap-3">
      <button :disabled="generating" class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-500 rounded-lg hover:bg-sky-600 disabled:opacity-50 transition-colors" @click="generatePlan">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        {{ generating ? 'Генерация...' : 'Сгенерировать план' }}
      </button>
    </div>

    <!-- Summary cards -->
    <div v-if="items.length" class="grid grid-cols-3 gap-3">
      <div class="p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
        <div class="text-2xl font-bold text-red-600 dark:text-red-400">{{ summaryCards.urgentCount }}</div>
        <div class="text-xs text-red-600 dark:text-red-400 mt-1">Срочно &mdash; IDC &lt; 20д ({{ summaryCards.urgentQty.toLocaleString() }} шт)</div>
      </div>
      <div class="p-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
        <div class="text-2xl font-bold text-amber-600 dark:text-amber-400">{{ summaryCards.soonCount }}</div>
        <div class="text-xs text-amber-600 dark:text-amber-400 mt-1">Скоро &mdash; IDC &lt; {{ planLeadTime }}д ({{ summaryCards.soonQty.toLocaleString() }} шт)</div>
      </div>
      <div class="p-4 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
        <div class="text-2xl font-bold text-green-600 dark:text-green-400">{{ summaryCards.normalCount }}</div>
        <div class="text-xs text-green-600 dark:text-green-400 mt-1">В норме</div>
      </div>
    </div>

    <!-- Demand table -->
    <div v-if="items.length" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table class="w-full text-left">
        <thead>
          <tr class="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
            <th class="px-3 py-3 w-8"></th>
            <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Товар</th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Прод/д</th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-center">IDC</th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">На Ozon</th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Склад</th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Gap</th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">К заказу</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="item in items" :key="item.master_card_id">
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" @click="toggleRow(item.master_card_id)">
              <td class="px-3 py-3 text-slate-400">
                <svg v-if="item.cluster_breakdown?.length" class="w-4 h-4 transition-transform" :class="{ 'rotate-90': isExpanded(item.master_card_id) }" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
              </td>
              <td class="px-4 py-3">
                <div class="text-sm font-medium text-slate-900 dark:text-white truncate max-w-[220px]">{{ item.title || item.sku || '\u2014' }}</div>
                <div class="text-xs text-slate-400">{{ item.sku || '' }}</div>
              </td>
              <td class="px-3 py-3 text-right text-sm tabular-nums">{{ item.ads_global != null ? item.ads_global.toFixed(1) : '\u2014' }}</td>
              <td class="px-3 py-3 text-center">
                <template v-if="item.idc_global != null">
                  <div class="flex items-center gap-1.5" :title="`${item.idc_global} дн. из ${planLeadTime}`">
                    <div class="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div :class="idcBarColor(item.idc_global, planLeadTime) + ' h-full rounded-full'" :style="{ width: idcBarPct(item.idc_global, planLeadTime) + '%' }" />
                    </div>
                    <span :class="'text-xs font-medium ' + idcColor(item.idc_global, planLeadTime)">{{ item.idc_global }}д</span>
                  </div>
                </template>
                <span v-else class="text-xs text-slate-400">\u2014</span>
              </td>
              <td class="px-3 py-3 text-right text-sm tabular-nums">{{ item.stock_on_ozon ?? '\u2014' }}</td>
              <td class="px-3 py-3 text-right text-sm tabular-nums">{{ item.stock_at_home ?? 0 }}</td>
              <td :class="'px-3 py-3 text-right text-sm tabular-nums font-medium ' + (item.total_gap > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500')">{{ item.total_gap > 0 ? item.total_gap.toLocaleString() : '\u2014' }}</td>
              <td class="px-3 py-3 text-right">
                <span :class="'inline-block px-2 py-1 text-sm font-bold rounded ' + (item.recommended_qty > 0 ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' : 'text-slate-400')">{{ item.recommended_qty > 0 ? item.recommended_qty.toLocaleString() : '0' }}</span>
              </td>
            </tr>
            <!-- Cluster breakdown -->
            <tr v-if="isExpanded(item.master_card_id) && item.cluster_breakdown?.length">
              <td colspan="8" class="p-0">
                <div class="px-8 py-2 bg-slate-50 dark:bg-slate-800/30">
                  <table class="w-full text-xs">
                    <thead>
                      <tr class="text-slate-400">
                        <th class="text-left py-1 px-2 font-medium">Кластер</th>
                        <th class="text-right py-1 px-2 font-medium">Прод/д</th>
                        <th class="text-center py-1 px-2 font-medium">IDC</th>
                        <th class="text-center py-1 px-2 font-medium">Статус</th>
                        <th class="text-right py-1 px-2 font-medium">Сейчас</th>
                        <th class="text-right py-1 px-2 font-medium" :title="`Прогноз остатка к приходу (через ${planLeadTime} дн.)`">К приходу</th>
                        <th class="text-right py-1 px-2 font-medium" :title="`Нужно на ${bufferDays} дн. после прихода`">Нужно ({{ bufferDays }}д)</th>
                        <th class="text-right py-1 px-2 font-medium">Gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="c in item.cluster_breakdown" :key="c.cluster_id" class="border-t border-slate-200 dark:border-slate-700">
                        <td class="py-1.5 px-2 font-medium text-slate-700 dark:text-slate-300">
                          {{ c.cluster_name || `#${c.cluster_id}` }}
                          <span v-if="sourceBadge(c.source)" :class="sourceBadgeClass(c.source)">{{ sourceBadge(c.source) }}</span>
                        </td>
                        <td class="py-1.5 px-2 text-right tabular-nums">{{ c.ads ? c.ads.toFixed(1) : '\u2014' }}</td>
                        <td class="py-1.5 px-2 text-center">
                          <span v-if="c.idc != null" :class="idcColor(c.idc, planLeadTime)">{{ c.idc }}д</span>
                          <span v-else>\u2014</span>
                        </td>
                        <td class="py-1.5 px-2 text-center">
                          <span v-if="c.turnover" :class="'inline-block px-1.5 py-0.5 text-[10px] font-medium rounded ' + turnoverBadge(c.turnover).cls">{{ turnoverBadge(c.turnover).label }}</span>
                          <span v-else>\u2014</span>
                        </td>
                        <td class="py-1.5 px-2 text-right tabular-nums">{{ clusterCurrentStock(c) }}</td>
                        <td :class="'py-1.5 px-2 text-right tabular-nums ' + (clusterStockAtArrival(c, planLeadTime) <= 0 ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-700 dark:text-slate-300')">{{ clusterStockAtArrival(c, planLeadTime) }}</td>
                        <td class="py-1.5 px-2 text-right tabular-nums">{{ c.need || 0 }}</td>
                        <td :class="'py-1.5 px-2 text-right tabular-nums font-medium ' + (c.gap > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400')">{{ c.gap > 0 ? c.gap : '0' }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div class="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 space-y-0.5">
                    <div class="font-medium text-slate-600 dark:text-slate-400 mb-1">Расчёт заказа (горизонт: {{ planLeadTime }} + {{ bufferDays }} = {{ planLeadTime + bufferDays }} дн.)</div>
                    <div>1. Остаток на Ozon к приходу (через {{ planLeadTime }}д): <b>Сейчас - {{ planLeadTime }}д x продажи/д</b></div>
                    <div>2. Нужно после прихода на {{ bufferDays }}д: <b>{{ bufferDays }}д x продажи/д</b></div>
                    <div>3. Gap = Нужно - К приходу (если &gt; 0)</div>
                    <div class="pt-1 border-t border-slate-200 dark:border-slate-700"></div>
                    <div>Сумма gap по кластерам: <b>{{ item.cluster_breakdown.reduce((s: number, c: ClusterBreakdown) => s + (c.gap || 0), 0).toLocaleString() }}</b></div>
                    <div>- На нашем складе: <b>{{ item.stock_at_home || 0 }}</b></div>
                    <div>- Заказано поставщику: <b>{{ item.pipeline_supplier || 0 }}</b></div>
                    <div class="text-sm font-semibold text-slate-700 dark:text-slate-300">= К заказу: <b class="text-sky-500 dark:text-sky-400">{{ item.recommended_qty.toLocaleString() }}</b></div>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
        <tfoot>
          <tr class="bg-slate-50 dark:bg-slate-800/50">
            <td colspan="7" class="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Итого: {{ totalItems }} товаров к заказу</td>
            <td class="px-3 py-3 text-right text-sm font-bold text-sky-500 dark:text-sky-400">{{ totalQty.toLocaleString() }} шт</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div v-else-if="!generating" class="text-center text-sm text-slate-400 py-8">Нет данных для генерации плана. Сначала обновите данные Ozon.</div>

    <!-- Plan footer -->
    <div v-if="demandStore.demandPlan && totalItems > 0" class="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800">
      <span class="text-sm text-slate-600 dark:text-slate-400">
        План #{{ demandStore.demandPlan.plan_id }} &middot; {{ totalItems }} товаров &middot; {{ totalQty.toLocaleString() }} шт &middot;
        Горизонт {{ demandStore.demandPlan.lead_time_days }}+{{ demandStore.demandPlan.buffer_days }}={{ (demandStore.demandPlan.lead_time_days || 0) + (demandStore.demandPlan.buffer_days || 0) }}д
      </span>
      <button
        :disabled="confirming || demandStore.demandPlan.status === 'confirmed'"
        :class="['px-4 py-2 text-sm font-medium rounded-lg transition-colors', demandStore.demandPlan.status === 'confirmed' ? 'bg-slate-400 text-white cursor-default' : 'bg-green-600 text-white hover:bg-green-700']"
        @click="confirmPlan"
      >
        {{ demandStore.demandPlan.status === 'confirmed' ? 'Подтверждён' : (confirming ? 'Подтверждение...' : 'Подтвердить план') }}
      </button>
    </div>
  </div>
</template>
