<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAnalyticsStore, type UeItem } from '@/stores/analytics'
import { formatMoney } from '@/utils/format'

const store = useAnalyticsStore()

/* ============================================================ */
/* Helpers                                                      */
/* ============================================================ */

function calcRoi(item: Record<string, any>): number | null {
  const absCogs = Math.abs(Number(item.cogs || 0))
  return absCogs > 0 ? Math.round((Number(item.profit || 0) / absCogs) * 100) : null
}

function marginClass(pct: number): string {
  if (pct > 20) return 'margin-good'
  if (pct >= 0) return 'margin-warn'
  return 'margin-bad'
}

interface StockLot {
  order_id?: string
  order_number?: string
  received_at?: string | null
  initial_qty?: number
  qty: number
  unit_cost: number
}

interface ComputedRow {
  sku: string
  product_name: string | null
  purchased: number
  stockQty: number
  roi: number | null
  stockCost: number
  potential: number
  lots: StockLot[]
}

/* ============================================================ */
/* FIFO logic (ported from renderStockValuation)                */
/* ============================================================ */

function fifoRemaining(lots: StockLot[], consumed: number): StockLot[] {
  const rem: StockLot[] = []
  let left = consumed
  for (const lot of lots) {
    const qty = lot.initial_qty || lot.qty || 0
    if (left >= qty) { left -= qty; continue }
    const r = left > 0 ? qty - left : qty
    left = 0
    rem.push({ ...lot, qty: r })
  }
  return rem
}

/* ============================================================ */
/* Computed rows                                                */
/* ============================================================ */

const rows = computed<ComputedRow[]>(() => {
  const sv = store.stockValData
  if (!sv?.items?.length) return []

  // Build UE lookup by SKU
  const ueBySku: Record<string, UeItem> = {}
  for (const u of (store.ueData?.items || [])) {
    if (u.sku) ueBySku[u.sku] = u
  }

  const result: ComputedRow[] = []
  for (const item of sv.items) {
    const ue: any = ueBySku[item.sku] || {}
    const purchased = (Number(ue.orders_qty) || 0) - (Number(ue.returns_qty) || 0)
    const roi = calcRoi(ue)
    const lots = item.lots || []
    const remaining = fifoRemaining(lots, purchased)
    const stockQty = remaining.reduce((s, l) => s + l.qty, 0)
    const stockCost = remaining.reduce((s, l) => s + l.qty * (l.unit_cost || 0), 0)
    const potential = roi !== null && stockCost > 0 ? stockCost * roi / 100 : 0

    result.push({
      sku: item.sku,
      product_name: item.product_name,
      purchased,
      stockQty,
      roi,
      stockCost: Math.round(stockCost * 100) / 100,
      potential: Math.round(potential * 100) / 100,
      lots: remaining,
    })
  }
  return result
})

const totalPurchased = computed(() => rows.value.reduce((s, r) => s + r.purchased, 0))
const totalStock = computed(() => rows.value.reduce((s, r) => s + r.stockQty, 0))
const totalStockCost = computed(() => rows.value.reduce((s, r) => s + r.stockCost, 0))
const totalPotential = computed(() => rows.value.reduce((s, r) => s + r.potential, 0))

const potColor = computed(() =>
  totalPotential.value >= 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-500 dark:text-red-400',
)

/* ============================================================ */
/* Lot popover                                                  */
/* ============================================================ */

const popoverLots = ref<StockLot[]>([])
const popoverVisible = ref(false)
const popoverStyle = ref<Record<string, string>>({})

function showLots(event: MouseEvent, lots: StockLot[]) {
  if (!lots.length) return
  popoverLots.value = lots
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  popoverStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    left: `${Math.max(8, rect.right - 280)}px`,
    zIndex: '9999',
  }
  popoverVisible.value = true
}

function hideLots() {
  popoverVisible.value = false
}

function formatLotDate(lot: StockLot): string {
  if (!lot.received_at) return '\u2014'
  return new Date(lot.received_at).toLocaleDateString('ru-RU')
}
</script>

<template>
  <div class="space-y-4">
    <!-- Empty state -->
    <div
      v-if="rows.length === 0"
      class="p-6 text-center text-sm text-slate-400"
    >
      Нет данных по складу за выбранный период
    </div>

    <template v-else>
      <!-- Summary cards -->
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-center">
          <div class="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Себестоимость остатка</div>
          <div class="text-lg font-bold text-slate-900 dark:text-white">{{ formatMoney(totalStockCost) }}</div>
        </div>
        <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-center">
          <div class="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Потенциальная прибыль</div>
          <div class="text-lg font-bold" :class="potColor">{{ formatMoney(totalPotential) }}</div>
          <div class="text-[10px] text-slate-400 mt-0.5">ROI x себестоимость остатка</div>
        </div>
      </div>

      <!-- Table -->
      <div class="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-slate-50 dark:bg-slate-800/50">
              <th class="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">SKU</th>
              <th class="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Товар</th>
              <th class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Выкуплено</th>
              <th class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Остаток</th>
              <th class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">ROI</th>
              <th class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">С/с остатка</th>
              <th class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Потенц. прибыль</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in rows"
              :key="r.sku"
              class="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
            >
              <td class="px-2 py-1.5" style="font-size: 12px">{{ r.sku }}</td>
              <td
                class="px-2 py-1.5"
                style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                :title="r.product_name || ''"
              >{{ r.product_name || '\u2014' }}</td>
              <td class="px-2 py-1.5 text-right">{{ r.purchased }}</td>
              <td class="px-2 py-1.5 text-right font-semibold">{{ r.stockQty }}</td>
              <td
                class="px-2 py-1.5 text-right"
                :class="r.roi !== null ? marginClass(r.roi) : ''"
                style="font-weight: 600"
              >{{ r.roi !== null ? r.roi + '%' : '\u2014' }}</td>
              <td
                class="px-2 py-1.5 text-right"
                :class="{ 'cursor-pointer hover:text-sky-500 dark:hover:text-sky-400 transition-colors': r.lots.length > 0 }"
                :style="r.lots.length > 0 ? 'text-decoration: underline dotted; text-underline-offset: 3px' : ''"
                @click="r.lots.length > 0 && showLots($event, r.lots)"
              >{{ formatMoney(r.stockCost) }}</td>
              <td
                class="px-2 py-1.5 text-right"
                :class="r.potential >= 0 ? 'margin-good' : 'margin-bad'"
                style="font-weight: 600"
              >{{ formatMoney(r.potential) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="border-t-2 border-slate-200 dark:border-slate-700" style="font-weight: 600">
              <td class="px-2 py-2" colspan="2">ИТОГО</td>
              <td class="px-2 py-2 text-right">{{ totalPurchased }}</td>
              <td class="px-2 py-2 text-right">{{ totalStock }}</td>
              <td class="px-2 py-2"></td>
              <td class="px-2 py-2 text-right">{{ formatMoney(totalStockCost) }}</td>
              <td
                class="px-2 py-2 text-right"
                :class="totalPotential >= 0 ? 'margin-good' : 'margin-bad'"
              >{{ formatMoney(totalPotential) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </template>

    <!-- Lot popover -->
    <Teleport to="body">
      <div
        v-if="popoverVisible"
        class="fixed inset-0 z-[9998]"
        @click="hideLots"
      />
      <div
        v-if="popoverVisible"
        :style="popoverStyle"
        class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg min-w-[280px] text-xs"
        style="z-index: 9999"
      >
        <div class="px-3 py-2 font-semibold text-[11px] uppercase tracking-wider text-slate-400">
          Остатки по лотам (FIFO)
        </div>
        <div
          v-for="(lot, i) in popoverLots"
          :key="i"
          class="px-3 py-1.5 flex gap-2 items-center border-t border-slate-100 dark:border-slate-700"
        >
          <span class="flex-1">
            <span
              :class="lot.order_id ? 'text-sky-500 cursor-pointer underline' : ''"
            >{{ lot.order_number || '\u2014' }}</span>
            <span class="text-slate-400 ml-1">{{ formatLotDate(lot) }}</span>
          </span>
          <span class="font-semibold whitespace-nowrap">{{ lot.qty }} шт</span>
          <span class="whitespace-nowrap">{{ formatMoney(lot.unit_cost) }}/шт</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>
