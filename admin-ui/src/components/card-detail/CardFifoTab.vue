<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCardDetailStore, type CardLot, type CardSale } from '@/stores/card-detail'
import { formatMoney, formatDateTime } from '@/utils/format'

const props = defineProps<{
  cardId: string
}>()

const cardDetailStore = useCardDetailStore()

const detail = computed(() => cardDetailStore.selectedCardDetail)
const lots = computed<CardLot[]>(() => detail.value?.lots || [])
const sales = computed<CardSale[]>(() => detail.value?.sales || [])

// Logistics summary — from matrixData if available
// In Vue migration, this would come from a logistics store. For now, placeholder.
const matrixRow = computed<Record<string, any> | null>(() => {
  // Backward compat: check if global state has matrixData
  const globalState = (window as any).state
  if (globalState?.matrixData) {
    return globalState.matrixData.find((r: any) => r.master_card_id === props.cardId) || null
  }
  return null
})

const logisticsMetrics = computed(() => {
  if (!matrixRow.value) return null
  return [
    { label: 'На складе', value: matrixRow.value.warehouse_stock },
    { label: 'На Ozon', value: matrixRow.value.ozon_stock },
    { label: 'В доставке', value: matrixRow.value.delivering_qty },
    { label: 'Выкуплено', value: matrixRow.value.purchased_qty },
    { label: 'Едет на склад', value: matrixRow.value.returns_in_transit },
  ]
})

// Lots table computations
function lotRemaining(lot: CardLot): number {
  return lot._computed_remaining != null ? lot._computed_remaining : Number(lot.remaining_qty || 0)
}

function lotSold(lot: CardLot): number {
  const initial = Number(lot.initial_qty || 0)
  return Math.max(0, initial - lotRemaining(lot))
}

function lotValue(lot: CardLot): number {
  return lotRemaining(lot) * Number(lot.unit_cost_rub || 0)
}

function hasBreakdown(lot: CardLot): boolean {
  return (
    Number(lot.purchase_price_rub || 0) > 0 ||
    Number(lot.logistics_cost_rub || 0) > 0
  )
}

const lotTotals = computed(() => {
  let totalInitial = 0
  let totalSold = 0
  let totalRemaining = 0
  let totalValue = 0
  for (const lot of lots.value) {
    const initial = Number(lot.initial_qty || 0)
    const rem = lotRemaining(lot)
    const sold = Math.max(0, initial - rem)
    totalInitial += initial
    totalSold += sold
    totalRemaining += rem
    totalValue += rem * Number(lot.unit_cost_rub || 0)
  }
  return { totalInitial, totalSold, totalRemaining, totalValue }
})

// Cost breakdown popover
const breakdownPopover = ref<{
  visible: boolean
  items: Array<{ label: string; value: number; pct: string }>
  total: number
  top: number
  left: number
}>({
  visible: false,
  items: [],
  total: 0,
  top: 0,
  left: 0,
})

function showCostBreakdown(event: MouseEvent, lot: CardLot) {
  const cost = Number(lot.unit_cost_rub || 0)
  if (!cost) return
  const qty = Number(lot.initial_qty || 1)
  const items: Array<{ label: string; value: number }> = []

  if (Array.isArray(lot.allocations) && lot.allocations.length) {
    for (const a of lot.allocations) {
      if (a.allocated_rub) {
        items.push({ label: a.name || 'Распред.', value: Number(a.allocated_rub) / qty })
      }
    }
  } else {
    items.push(
      { label: 'Закупка', value: Number(lot.purchase_price_rub || 0) / qty },
      { label: 'Упаковка', value: Number(lot.packaging_cost_rub || 0) / qty },
      { label: 'Доставка', value: Number(lot.logistics_cost_rub || 0) / qty },
      { label: 'Таможня', value: Number(lot.customs_cost_rub || 0) / qty },
      { label: 'Прочее', value: Number(lot.extra_cost_rub || 0) / qty },
    )
  }

  const nonZero = items.filter((i) => i.value > 0)
  if (!nonZero.length) return

  const anchor = event.currentTarget as HTMLElement
  const rect = anchor.getBoundingClientRect()

  breakdownPopover.value = {
    visible: true,
    items: nonZero.map((i) => ({
      ...i,
      pct: ((i.value / cost) * 100).toFixed(0),
    })),
    total: cost,
    top: rect.bottom + 4,
    left: Math.max(8, rect.right - 240),
  }
}

function hideCostBreakdown() {
  setTimeout(() => {
    breakdownPopover.value.visible = false
  }, 150)
}

// Sales computations
interface SaleComputed {
  sale: CardSale
  qty: number
  cogs: number
  costPerUnit: number
  salePrice: number
  isCancelled: boolean
  ueTotal: number | null
  ueRevenue: number
  isReturn: boolean
  isSale: boolean
  hasUE: boolean
  profitPerUnit: number
  profitCls: string
  // Tooltip data
  ueRev: number
  ueCom: number
  logistics: number
  ueAcq: number
  returns: number
  ueMkt: number
  ueOth: number
}

const salesComputed = computed<SaleComputed[]>(() => {
  return sales.value.map((sale) => {
    const qty = Number(sale.quantity || 0)
    const cogs = Number(sale._computed_cogs || sale.cogs_rub || 0)
    const costPerUnit = qty > 0 && cogs > 0 ? cogs / qty : 0
    const salePrice = Number(sale.unit_sale_price_rub || 0)
    const isCancelled = (sale.status || '').toLowerCase() === 'cancelled'

    const ueTotal = sale.ue_total != null ? Number(sale.ue_total) : null
    const ueRevenue = sale.ue_revenue != null ? Number(sale.ue_revenue) : 0
    const ueRetL = Number(sale.ue_return_logistics || 0)
    const ueRetP = Number(sale.ue_return_processing || 0)
    const isReturn = ueRevenue <= 0 && (ueRetL !== 0 || ueRetP !== 0)
    const isSale = ueRevenue > 0
    const hasUE = ueTotal !== null && (isSale || isReturn)

    let profitPerUnit = 0
    if (isSale) {
      profitPerUnit = costPerUnit > 0 ? ueTotal! - costPerUnit : ueTotal!
    } else if (isReturn) {
      profitPerUnit = ueTotal!
    }

    const profitCls =
      profitPerUnit > 0 ? 'text-green-600' : profitPerUnit < 0 ? 'text-red-500' : ''

    const ueRev = Number(sale.ue_revenue || 0)
    const ueCom = Number(sale.ue_commission || 0)
    const ueLM = Number(sale.ue_last_mile || 0)
    const uePipe = Number(sale.ue_pipeline || 0)
    const ueFull = Number(sale.ue_fulfillment || 0)
    const ueDrop = Number(sale.ue_dropoff || 0)
    const ueAcq = Number(sale.ue_acquiring || 0)
    const ueMkt = Number(sale.ue_marketing || 0)
    const ueOth = Number(sale.ue_other_services || 0)
    const logistics = ueLM + uePipe + ueFull + ueDrop
    const returns = ueRetL + ueRetP

    return {
      sale,
      qty,
      cogs,
      costPerUnit,
      salePrice,
      isCancelled,
      ueTotal,
      ueRevenue,
      isReturn,
      isSale,
      hasUE,
      profitPerUnit,
      profitCls,
      ueRev,
      ueCom,
      logistics,
      ueAcq,
      returns,
      ueMkt,
      ueOth,
    }
  })
})

// Profit tooltip
const profitTooltip = ref<{
  visible: boolean
  html: string
  top: number
  left: number
}>({
  visible: false,
  html: '',
  top: 0,
  left: 0,
})

function showProfitTooltip(event: MouseEvent, sc: SaleComputed) {
  if (!sc.hasUE) return

  const fmtLine = (label: string, val: number): string => {
    if (Math.abs(val) < 0.005) return ''
    return `<div class="flex justify-between gap-4"><span class="text-slate-400">${label}</span><span>${formatMoney(val)}</span></div>`
  }

  let lines = ''
  if (sc.isReturn) {
    lines += '<div class="text-yellow-400 text-xs mb-1 font-medium">Возврат / отмена</div>'
  }
  lines += fmtLine('Выручка Ozon', sc.ueRev)
  lines += fmtLine('Комиссия', sc.ueCom)
  if (Math.abs(sc.logistics) >= 0.005) lines += fmtLine('Логистика', sc.logistics)
  if (Math.abs(sc.ueAcq) >= 0.005) lines += fmtLine('Эквайринг', sc.ueAcq)
  if (Math.abs(sc.returns) >= 0.005) lines += fmtLine('Возвр. логистика', sc.returns)
  if (Math.abs(sc.ueMkt) >= 0.005) lines += fmtLine('Маркетинг', sc.ueMkt)
  if (Math.abs(sc.ueOth) >= 0.005) lines += fmtLine('Прочее', sc.ueOth)
  lines += `<div class="border-t border-slate-600 mt-1 pt-1 flex justify-between gap-4"><span class="text-slate-300">= Итого Ozon</span><span class="font-medium">${formatMoney(sc.ueTotal!)}</span></div>`
  if (sc.isSale && sc.costPerUnit > 0) {
    lines += fmtLine('Себестоимость', -sc.costPerUnit)
    lines += `<div class="border-t border-slate-600 mt-1 pt-1 flex justify-between gap-4 font-semibold"><span class="text-white">Прибыль</span><span class="${sc.profitCls}">${formatMoney(sc.profitPerUnit)}</span></div>`
  } else if (sc.isReturn) {
    lines += `<div class="border-t border-slate-600 mt-1 pt-1 flex justify-between gap-4 font-semibold"><span class="text-white">Убыток</span><span class="text-red-500">${formatMoney(sc.profitPerUnit)}</span></div>`
  }

  const td = event.currentTarget as HTMLElement
  const rect = td.getBoundingClientRect()

  profitTooltip.value = {
    visible: true,
    html: lines,
    top: rect.top,
    left: Math.max(0, rect.left - 230),
  }
}

function hideProfitTooltip() {
  profitTooltip.value.visible = false
}
</script>

<template>
  <div class="space-y-6 py-4">
    <!-- Logistics summary -->
    <div v-if="logisticsMetrics" class="grid grid-cols-2 md:grid-cols-5 gap-3">
      <div
        v-for="m in logisticsMetrics"
        :key="m.label"
        class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm"
      >
        <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{{ m.label }}</div>
        <div class="text-2xl font-bold text-slate-900 dark:text-white">
          {{ Number(m.value || 0).toLocaleString('ru-RU') }}
        </div>
      </div>
    </div>
    <div v-else class="text-sm text-slate-400">
      Нет данных логистики. Синхронизируйте данные в разделе Логистика.
    </div>

    <!-- FIFO Lots table -->
    <div>
      <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Партии (FIFO)</h3>
      <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table class="w-full text-left">
          <thead>
            <tr class="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
              <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Дата приёмки</th>
              <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Кол-во</th>
              <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Продано</th>
              <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Остаток</th>
              <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Себест./шт</th>
              <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Стоимость</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="lot in lots"
              :key="lot.id"
              class="border-b border-slate-100 dark:border-slate-800/50"
            >
              <td class="px-4 py-2.5 text-sm">{{ formatDateTime(lot.received_at) }}</td>
              <td class="text-right px-4 py-2.5 text-sm">{{ Number(lot.initial_qty || 0).toLocaleString('ru-RU') }}</td>
              <td class="text-right px-4 py-2.5 text-sm text-slate-500">
                {{ lotSold(lot) > 0 ? lotSold(lot).toLocaleString('ru-RU') : '\u2014' }}
              </td>
              <td class="text-right px-4 py-2.5 text-sm font-medium">{{ lotRemaining(lot).toLocaleString('ru-RU') }}</td>
              <td class="text-right px-4 py-2.5 text-sm">
                <span
                  class="cost-cell"
                  :style="hasBreakdown(lot) ? 'text-decoration:underline dotted;text-underline-offset:3px;cursor:help' : ''"
                  @mouseenter="hasBreakdown(lot) && showCostBreakdown($event, lot)"
                  @mouseleave="hideCostBreakdown"
                >
                  {{ formatMoney(Number(lot.unit_cost_rub || 0)) }}
                </span>
              </td>
              <td class="text-right px-4 py-2.5 text-sm">{{ formatMoney(lotValue(lot)) }}</td>
            </tr>
            <tr v-if="!lots.length">
              <td colspan="6" class="muted">Партии не найдены</td>
            </tr>
          </tbody>
          <tfoot v-if="lots.length">
            <tr class="font-bold text-sm border-t border-slate-200 dark:border-slate-700">
              <td class="px-4 py-2.5">Итого ({{ lots.length }})</td>
              <td class="text-right px-4 py-2.5">{{ lotTotals.totalInitial.toLocaleString('ru-RU') }}</td>
              <td class="text-right px-4 py-2.5 text-slate-500">
                {{ lotTotals.totalSold > 0 ? lotTotals.totalSold.toLocaleString('ru-RU') : '' }}
              </td>
              <td class="text-right px-4 py-2.5">{{ lotTotals.totalRemaining.toLocaleString('ru-RU') }}</td>
              <td class="text-right px-4 py-2.5"></td>
              <td class="text-right px-4 py-2.5">{{ formatMoney(lotTotals.totalValue) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- Sales table -->
    <div>
      <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Продажи</h3>
      <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table class="w-full text-left">
          <thead>
            <tr class="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
              <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Дата</th>
              <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Заказ</th>
              <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Кол-во</th>
              <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Себест./шт</th>
              <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Цена продажи</th>
              <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Прибыль</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="sc in salesComputed"
              :key="sc.sale.id"
              class="border-b border-slate-100 dark:border-slate-800/50"
              :class="{ 'opacity-40 line-through': sc.isCancelled && !sc.hasUE }"
            >
              <td class="px-4 py-2.5 text-sm">{{ formatDateTime(sc.sale.sold_at) }}</td>
              <td class="px-4 py-2.5 text-sm">{{ sc.sale.external_order_id || '\u2014' }}</td>
              <td class="text-right px-4 py-2.5 text-sm">
                {{ sc.qty > 0 ? sc.qty.toLocaleString('ru-RU') : '\u2014' }}
              </td>
              <td class="text-right px-4 py-2.5 text-sm">
                {{ sc.costPerUnit > 0 ? formatMoney(sc.costPerUnit) : '\u2014' }}
              </td>
              <td class="text-right px-4 py-2.5 text-sm">
                {{ sc.salePrice > 0 ? formatMoney(sc.salePrice) : '\u2014' }}
              </td>
              <td
                class="text-right px-4 py-2.5 text-sm relative"
                :class="[sc.profitCls, sc.hasUE ? 'sale-profit-cell cursor-help' : '']"
                @mouseenter="showProfitTooltip($event, sc)"
                @mouseleave="hideProfitTooltip"
              >
                {{ sc.hasUE ? formatMoney(sc.profitPerUnit) : '\u2014' }}
              </td>
            </tr>
            <tr v-if="!sales.length">
              <td colspan="6" class="muted">Продаж пока нет</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Cost breakdown popover -->
    <Teleport to="body">
      <div
        v-if="breakdownPopover.visible"
        class="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl min-w-[220px] text-xs"
        :style="{ top: breakdownPopover.top + 'px', left: breakdownPopover.left + 'px' }"
      >
        <div class="px-3 py-2 font-semibold text-[11px] uppercase tracking-wider text-slate-400">
          Разбивка себестоимости
        </div>
        <div
          v-for="(bi, idx) in breakdownPopover.items"
          :key="idx"
          class="px-3 py-1.5 flex gap-1.5 items-center border-t border-slate-100 dark:border-slate-700"
        >
          <span class="flex-1 text-slate-500 dark:text-slate-300">{{ bi.label }}</span>
          <span class="font-semibold whitespace-nowrap min-w-[70px] text-right">{{ formatMoney(bi.value) }}</span>
          <span class="text-slate-400 whitespace-nowrap min-w-[32px] text-right">{{ bi.pct }}%</span>
        </div>
        <div class="px-3 py-1.5 flex gap-1.5 items-center border-t-2 border-slate-300 dark:border-slate-600 font-bold">
          <span class="flex-1">Итого</span>
          <span class="whitespace-nowrap min-w-[70px] text-right">{{ formatMoney(breakdownPopover.total) }}</span>
          <span class="text-slate-400 whitespace-nowrap min-w-[32px] text-right">100%</span>
        </div>
      </div>
    </Teleport>

    <!-- Profit tooltip -->
    <Teleport to="body">
      <div
        v-if="profitTooltip.visible"
        class="fixed z-50 bg-slate-800 text-white text-xs rounded-lg shadow-xl px-4 py-3 border border-slate-700 min-w-[220px]"
        :style="{ top: profitTooltip.top + 'px', left: profitTooltip.left + 'px' }"
        v-html="profitTooltip.html"
      />
    </Teleport>
  </div>
</template>
