<script setup lang="ts">
import { computed } from 'vue'
import { useAnalyticsStore, type UeItem, type UeTotals, type PnlData } from '@/stores/analytics'
import { formatMoney } from '@/utils/format'
import { FINANCE_CATEGORIES } from '@/utils/constants'

const store = useAnalyticsStore()

/* ============================================================ */
/* Constants (ported from OZON_COST_COLS / OPS_COLS in app.js)  */
/* ============================================================ */

const OZON_COST_COLS = [
  'commission', 'last_mile', 'pipeline', 'fulfillment',
  'dropoff', 'acquiring', 'return_logistics', 'return_processing',
  'marketing', 'installment', 'other_services',
] as const

const OZON_COL_LABELS: Record<string, string> = {
  commission: 'Комис.', last_mile: 'Посл.м.', pipeline: 'Тр.расх', fulfillment: 'Фулф.',
  dropoff: 'Прим.', acquiring: 'Экв.', return_logistics: 'Возв.л', return_processing: 'Возв.о',
  marketing: 'Реклама', installment: 'Расср.', other_services: 'Прочее',
}

const OPS_COLS = ['orders_qty', 'returns_qty', 'services_ops', 'other_ops'] as const
const OPS_COL_LABELS: Record<string, string> = {
  orders_qty: 'Заказы', returns_qty: 'Возвр.', services_ops: 'Услуги', other_ops: 'Прочее',
}

const PNL_EXPENSE_LABELS: Record<string, string> = {
  commission: 'Комиссия Ozon',
  logistics: 'Логистика',
  fbo: 'Услуги FBO',
  acquiring: 'Эквайринг',
  marketing: 'Реклама',
  returns: 'Возвраты',
  other: 'Прочее',
}

/* ============================================================ */
/* Helper functions                                             */
/* ============================================================ */

function ozonCostSum(item: Record<string, any>): number {
  return OZON_COST_COLS.reduce((s, c) => s + Number(item[c] || 0), 0)
}

function marginClass(pct: number): string {
  if (pct > 20) return 'margin-good'
  if (pct >= 0) return 'margin-warn'
  return 'margin-bad'
}

function calcRoi(item: Record<string, any>): number | null {
  const absCogs = Math.abs(Number(item.cogs || 0))
  return absCogs > 0 ? Math.round((Number(item.profit || 0) / absCogs) * 100) : null
}

function opsColVal(item: UeItem, col: string): string {
  const v = Number((item as any)[col] || 0)
  if (col === 'returns_qty') return v > 0 ? `-${v}` : '\u2014'
  if (col === 'orders_qty') return v > 0 ? `${v}` : '0'
  return v ? String(v) : '\u2014'
}

function opsColColor(col: string, item: UeItem): string {
  const v = Number((item as any)[col] || 0)
  if (col === 'returns_qty' && v > 0) return 'color: #ef4444'
  if (col === 'orders_qty' && v > 0) return 'color: #22c55e'
  return ''
}

function financeCategoryLabel(value: string): string {
  for (const cats of Object.values(FINANCE_CATEGORIES)) {
    const found = (cats as readonly { value: string; label: string }[]).find((c) => c.value === value)
    if (found) return found.label
  }
  return value || '\u2014'
}

/* ============================================================ */
/* Computed data                                                */
/* ============================================================ */

const items = computed<UeItem[]>(() => store.ueData?.items || [])
const totals = computed<UeTotals>(() => store.ueData?.totals || {} as UeTotals)
const expanded = computed(() => store.ueExpanded)
const opsExpanded = computed(() => store.ueOpsExpanded)
const pnlData = computed<PnlData | null>(() => store.pnlData)

const totalCols = computed(() => {
  const opsCols = opsExpanded.value ? OPS_COLS.length + 1 : 1
  const ozonCols = expanded.value ? OZON_COST_COLS.length + 1 : 1
  return 2 + opsCols + 1 + ozonCols + 4
})

const footColspan = computed(() => {
  const opsCols = opsExpanded.value ? OPS_COLS.length + 1 : 1
  return 2 + opsCols
})

/* ============================================================ */
/* P&L helpers                                                  */
/* ============================================================ */

function pnlPct(value: number): string {
  const netIncome = Number(pnlData.value?.income?.net_income || 0)
  if (!netIncome) return ''
  return `(${(Math.abs(value) / netIncome * 100).toFixed(1)}%)`
}

function retHint(salesVal: number | undefined, retVal: number | undefined): string {
  const s = Number(salesVal || 0)
  const r = Number(retVal || 0)
  if (!r) return ''
  return `${formatMoney(s)} \u2212 ${formatMoney(Math.abs(r))} \u0432\u043E\u0437\u0432\u0440.`
}

const pnlNetRevenue = computed(() => {
  if (!pnlData.value) return 0
  return Number(pnlData.value.income?.revenue || 0) + Number(pnlData.value.income?.returns_revenue || 0)
})

const pnlNetPoints = computed(() => {
  if (!pnlData.value) return 0
  return Number(pnlData.value.income?.points_for_discounts || 0) + Number(pnlData.value.income?.returns_points || 0)
})

const pnlNetPartner = computed(() => {
  if (!pnlData.value) return 0
  return Number(pnlData.value.income?.partner_programs || 0) + Number(pnlData.value.income?.returns_partner || 0)
})

const pnlTotalExpenses = computed(() => {
  if (!pnlData.value) return 0
  return Math.abs(Number(pnlData.value.ozon_expenses?.total || 0))
    + Number(pnlData.value.cogs || 0)
    + Number(pnlData.value.manual_expense || 0)
    + Number(pnlData.value.tax_usn || 0)
})

const pnlSvcByGroup = computed(() => {
  const detail = pnlData.value?.services_detail || []
  const groups: Record<string, Array<{ name: string; amount: number }>> = {}
  for (const s of detail) {
    if (!groups[s.group]) groups[s.group] = []
    groups[s.group].push(s)
  }
  return groups
})

const pnlMarginCls = computed(() => {
  if (!pnlData.value) return ''
  return pnlData.value.margin_pct > 20 ? 'margin-good' : pnlData.value.margin_pct >= 0 ? 'margin-warn' : 'margin-bad'
})
</script>

<template>
  <div class="space-y-6">
    <!-- UE Table -->
    <div class="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table class="w-full text-sm">
        <!-- Head -->
        <thead>
          <tr class="bg-slate-50 dark:bg-slate-800/50">
            <th class="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">SKU</th>
            <th class="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Товар</th>

            <!-- Operations columns -->
            <template v-if="opsExpanded">
              <th
                v-for="c in OPS_COLS"
                :key="c"
                class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ue-ops-col"
              >{{ OPS_COL_LABELS[c] }}</th>
              <th
                class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 cursor-pointer select-none hover:text-sky-500 dark:hover:text-sky-400 transition-colors ue-ops-col"
                title="Свернуть"
                @click="store.toggleOpsExpanded()"
              >&#x25C0;</th>
            </template>
            <th
              v-else
              class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 cursor-pointer select-none hover:text-sky-500 dark:hover:text-sky-400 transition-colors"
              title="Нажмите для детализации"
              @click="store.toggleOpsExpanded()"
            >Опер. &#x25B6;</th>

            <th class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Выручка</th>

            <!-- Ozon cost columns -->
            <template v-if="expanded">
              <th
                v-for="c in OZON_COST_COLS"
                :key="c"
                class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ue-detail-col"
              >{{ OZON_COL_LABELS[c] }}</th>
            </template>
            <th
              v-else
              class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 cursor-pointer select-none hover:text-sky-500 dark:hover:text-sky-400 transition-colors"
              title="Нажмите для детализации"
              @click="store.toggleUeExpanded()"
            >Расх. Ozon &#x25B6;</th>

            <th class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Себест.</th>
            <th class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Прибыль</th>
            <th class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Маржа</th>
            <th class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">ROI</th>

            <th
              v-if="expanded"
              class="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 cursor-pointer select-none hover:text-sky-500 dark:hover:text-sky-400 transition-colors"
              title="Свернуть"
              @click="store.toggleUeExpanded()"
            >&#x25C0;</th>
          </tr>
        </thead>

        <!-- Body -->
        <tbody>
          <template v-if="items.length === 0">
            <tr>
              <td :colspan="totalCols" class="muted px-3 py-4">
                Нет данных. Нажмите &laquo;Обновить&raquo; для загрузки.
              </td>
            </tr>
          </template>

          <tr
            v-for="item in items"
            :key="item.sku"
            class="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
            :class="{ 'cursor-pointer': item.master_card_id }"
          >
            <td class="px-2 py-1.5" style="font-size: 12px">{{ item.sku }}</td>
            <td
              class="px-2 py-1.5"
              style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
              :title="item.product_name || ''"
            >{{ item.product_name || '\u2014' }}</td>

            <!-- Operations -->
            <template v-if="opsExpanded">
              <td
                v-for="c in OPS_COLS"
                :key="c"
                class="px-2 py-1.5 text-right ue-ops-col"
                :style="opsColColor(c, item)"
              >{{ opsColVal(item, c) }}</td>
              <td class="ue-ops-col"></td>
            </template>
            <td v-else class="px-2 py-1.5 text-right">{{ item.operations_count }}</td>

            <td class="px-2 py-1.5 text-right">{{ formatMoney(item.revenue) }}</td>

            <!-- Ozon costs -->
            <template v-if="expanded">
              <td
                v-for="c in OZON_COST_COLS"
                :key="c"
                class="px-2 py-1.5 text-right ue-detail-col"
              >{{ formatMoney((item as any)[c]) }}</td>
              <td></td>
            </template>
            <td v-else class="px-2 py-1.5 text-right">{{ formatMoney(ozonCostSum(item)) }}</td>

            <td class="px-2 py-1.5 text-right">{{ formatMoney(item.cogs) }}</td>
            <td class="px-2 py-1.5 text-right">{{ formatMoney(item.profit) }}</td>
            <td
              class="px-2 py-1.5 text-right"
              :class="marginClass(item.margin_pct)"
              style="font-weight: 600"
            >{{ item.margin_pct }}%</td>
            <td
              class="px-2 py-1.5 text-right"
              :class="calcRoi(item) !== null ? marginClass(calcRoi(item)!) : ''"
              style="font-weight: 600"
            >{{ calcRoi(item) !== null ? calcRoi(item) + '%' : '\u2014' }}</td>
          </tr>
        </tbody>

        <!-- Footer -->
        <tfoot v-if="items.length > 0">
          <tr class="border-t-2 border-slate-200 dark:border-slate-700" style="font-weight: 600">
            <td class="px-2 py-2" :colspan="footColspan">ИТОГО</td>
            <td class="px-2 py-2 text-right">{{ formatMoney(totals.revenue) }}</td>

            <template v-if="expanded">
              <td
                v-for="c in OZON_COST_COLS"
                :key="c"
                class="px-2 py-2 text-right"
              >{{ formatMoney((totals as any)[c]) }}</td>
              <td></td>
            </template>
            <td v-else class="px-2 py-2 text-right">{{ formatMoney(ozonCostSum(totals)) }}</td>

            <td class="px-2 py-2 text-right">{{ formatMoney(totals.cogs) }}</td>
            <td class="px-2 py-2 text-right">{{ formatMoney(totals.profit) }}</td>
            <td
              class="px-2 py-2 text-right"
              :class="marginClass(totals.margin_pct || 0)"
            >{{ totals.margin_pct || 0 }}%</td>
            <td
              class="px-2 py-2 text-right"
              :class="calcRoi(totals) !== null ? marginClass(calcRoi(totals)!) : ''"
            >{{ calcRoi(totals) !== null ? calcRoi(totals) + '%' : '\u2014' }}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- P&L Report Card -->
    <div
      v-if="pnlData"
      class="rounded-xl border border-slate-200 dark:border-slate-700 p-5"
    >
      <h3 class="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
        P&amp;L отчёт
      </h3>

      <template v-if="pnlData.error">
        <p class="text-sm text-red-400">{{ pnlData.error }}</p>
      </template>

      <template v-else>
        <div class="text-sm space-y-1">
          <!-- INCOME -->
          <details class="group bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg px-3 py-1">
            <summary class="flex items-center gap-1.5 cursor-pointer select-none py-1.5">
              <svg class="w-3.5 h-3.5 text-slate-400 transition-transform group-open:rotate-90 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
              <span class="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex-1">Доходы</span>
              <span class="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{{ formatMoney(pnlData.income?.net_income) }}</span>
            </summary>
            <div class="pl-5 space-y-0.5 pb-1">
              <!-- Revenue -->
              <div class="flex justify-between py-1">
                <span class="text-slate-600 dark:text-slate-400">Выручка</span>
                <span class="font-medium tabular-nums">
                  {{ formatMoney(pnlNetRevenue) }}
                  <span v-if="retHint(pnlData.income?.revenue, pnlData.income?.returns_revenue)" class="text-slate-400 text-[10px] ml-1">{{ retHint(pnlData.income?.revenue, pnlData.income?.returns_revenue) }}</span>
                </span>
              </div>
              <!-- Points -->
              <div class="flex justify-between py-1">
                <span class="text-slate-600 dark:text-slate-400">Баллы за скидки</span>
                <span class="font-medium tabular-nums">
                  {{ formatMoney(pnlNetPoints) }}
                  <span v-if="retHint(pnlData.income?.points_for_discounts, pnlData.income?.returns_points)" class="text-slate-400 text-[10px] ml-1">{{ retHint(pnlData.income?.points_for_discounts, pnlData.income?.returns_points) }}</span>
                </span>
              </div>
              <!-- Partner -->
              <div v-if="pnlNetPartner" class="flex justify-between py-1">
                <span class="text-slate-600 dark:text-slate-400">Программы партнёров</span>
                <span class="font-medium tabular-nums">{{ formatMoney(pnlNetPartner) }}</span>
              </div>
              <!-- Manual income -->
              <template v-if="pnlData.manual_income">
                <template v-if="(pnlData.manual_income_detail || []).length > 1">
                  <details class="group/sub">
                    <summary class="flex items-center gap-1.5 cursor-pointer select-none py-1">
                      <svg class="w-3 h-3 text-slate-400 transition-transform group-open/sub:rotate-90 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                      <span class="text-slate-600 dark:text-slate-400 flex-1">Ручные доходы</span>
                      <span class="font-medium tabular-nums">{{ formatMoney(pnlData.manual_income) }}</span>
                    </summary>
                    <div class="pl-5 text-xs space-y-0.5">
                      <div v-for="d in pnlData.manual_income_detail" :key="d.category" class="flex justify-between py-1">
                        <span class="text-slate-600 dark:text-slate-400">{{ financeCategoryLabel(d.category) }}</span>
                        <span class="font-medium tabular-nums">{{ formatMoney(d.amount) }}</span>
                      </div>
                    </div>
                  </details>
                </template>
                <div v-else class="flex justify-between py-1">
                  <span class="text-slate-600 dark:text-slate-400">
                    Ручные доходы{{ (pnlData.manual_income_detail || []).length === 1 ? ` (${financeCategoryLabel(pnlData.manual_income_detail[0].category)})` : '' }}
                  </span>
                  <span class="font-medium tabular-nums">{{ formatMoney(pnlData.manual_income) }}</span>
                </div>
              </template>
            </div>
          </details>

          <!-- EXPENSES -->
          <details class="group bg-red-50/50 dark:bg-red-950/20 rounded-lg px-3 py-1">
            <summary class="flex items-center gap-1.5 cursor-pointer select-none py-1.5">
              <svg class="w-3.5 h-3.5 text-slate-400 transition-transform group-open:rotate-90 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
              <span class="text-xs font-semibold uppercase tracking-wider text-red-500 dark:text-red-400 flex-1">Расходы</span>
              <span class="font-semibold tabular-nums text-red-500">{{ formatMoney(-pnlTotalExpenses) }}</span>
            </summary>
            <div class="pl-5 space-y-0.5 pb-1">
              <!-- Ozon expenses sub-group -->
              <details class="group/sub">
                <summary class="flex items-center gap-1.5 cursor-pointer select-none py-1">
                  <svg class="w-3 h-3 text-slate-400 transition-transform group-open/sub:rotate-90 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                  <span class="text-slate-600 dark:text-slate-400 flex-1">Расходы Ozon</span>
                  <span class="font-medium tabular-nums text-red-500">
                    {{ formatMoney(pnlData.ozon_expenses?.total) }}
                    <span class="text-slate-400 text-[10px] ml-1">{{ pnlPct(Math.abs(Number(pnlData.ozon_expenses?.total || 0))) }}</span>
                  </span>
                </summary>
                <div class="pl-5 space-y-0.5">
                  <template v-for="(label, key) in PNL_EXPENSE_LABELS" :key="key">
                    <template v-if="Number((pnlData.ozon_expenses as any)?.[key] || 0)">
                      <!-- If multiple service details for this group, make it expandable -->
                      <template v-if="(pnlSvcByGroup[key] || []).length > 1">
                        <details class="group/sub">
                          <summary class="flex items-center gap-1.5 cursor-pointer select-none py-1">
                            <svg class="w-3 h-3 text-slate-400 transition-transform group-open/sub:rotate-90 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                            <span class="text-slate-600 dark:text-slate-400 flex-1">{{ label }}</span>
                            <span class="font-medium tabular-nums text-red-500">
                              {{ formatMoney((pnlData.ozon_expenses as any)[key]) }}
                              <span class="text-slate-400 text-[10px] ml-1">{{ pnlPct(Number((pnlData.ozon_expenses as any)[key])) }}</span>
                            </span>
                          </summary>
                          <div class="pl-5 text-xs space-y-0.5">
                            <div v-for="s in pnlSvcByGroup[key]" :key="s.name" class="flex justify-between py-1">
                              <span class="text-slate-600 dark:text-slate-400">{{ s.name }}</span>
                              <span class="font-medium tabular-nums">{{ formatMoney(s.amount) }}</span>
                            </div>
                          </div>
                        </details>
                      </template>
                      <div v-else class="flex justify-between py-1">
                        <span class="text-slate-600 dark:text-slate-400">{{ label }}</span>
                        <span class="font-medium tabular-nums">
                          {{ formatMoney((pnlData.ozon_expenses as any)[key]) }}
                          <span class="text-slate-400 text-[10px] ml-1">{{ pnlPct(Number((pnlData.ozon_expenses as any)[key])) }}</span>
                        </span>
                      </div>
                    </template>
                  </template>
                </div>
              </details>

              <!-- COGS -->
              <div class="flex justify-between py-1">
                <span class="text-slate-600 dark:text-slate-400">Себестоимость (FIFO)</span>
                <span class="font-medium tabular-nums" :class="{ 'text-red-500': pnlData.cogs > 0 }">
                  {{ formatMoney(-pnlData.cogs) }}
                  <span class="text-slate-400 text-[10px] ml-1">{{ pnlPct(pnlData.cogs) }}</span>
                </span>
              </div>

              <!-- Manual expenses -->
              <template v-if="pnlData.manual_expense">
                <template v-if="(pnlData.manual_expense_detail || []).length > 1">
                  <details class="group/sub">
                    <summary class="flex items-center gap-1.5 cursor-pointer select-none py-1">
                      <svg class="w-3 h-3 text-slate-400 transition-transform group-open/sub:rotate-90 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                      <span class="text-slate-600 dark:text-slate-400 flex-1">Ручные расходы</span>
                      <span class="font-medium tabular-nums text-red-500">
                        {{ formatMoney(-pnlData.manual_expense) }}
                        <span class="text-slate-400 text-[10px] ml-1">{{ pnlPct(pnlData.manual_expense) }}</span>
                      </span>
                    </summary>
                    <div class="pl-5 text-xs space-y-0.5">
                      <div v-for="d in pnlData.manual_expense_detail" :key="d.category" class="flex justify-between py-1">
                        <span class="text-slate-600 dark:text-slate-400">{{ financeCategoryLabel(d.category) }}</span>
                        <span class="font-medium tabular-nums">{{ formatMoney(-d.amount) }}</span>
                      </div>
                    </div>
                  </details>
                </template>
                <div v-else class="flex justify-between py-1">
                  <span class="text-slate-600 dark:text-slate-400">
                    Ручные расходы{{ (pnlData.manual_expense_detail || []).length === 1 ? ` (${financeCategoryLabel(pnlData.manual_expense_detail[0].category)})` : '' }}
                  </span>
                  <span class="font-medium tabular-nums text-red-500">
                    {{ formatMoney(-pnlData.manual_expense) }}
                    <span class="text-slate-400 text-[10px] ml-1">{{ pnlPct(pnlData.manual_expense) }}</span>
                  </span>
                </div>
              </template>

              <!-- Tax -->
              <div class="flex justify-between py-1">
                <span class="text-slate-600 dark:text-slate-400">Налог УСН {{ pnlData.usn_rate || 7 }}%</span>
                <span class="font-medium tabular-nums">{{ formatMoney(-pnlData.tax_usn) }}</span>
              </div>
              <div class="text-[10px] text-slate-400 pl-4 -mt-1 pb-1">
                {{ pnlData.usn_rate || 7 }}% x {{ formatMoney(pnlData.taxable_revenue != null ? pnlData.taxable_revenue : pnlData.income?.revenue) }}
              </div>
            </div>
          </details>

          <!-- Double divider -->
          <div class="border-t-2 border-slate-300 dark:border-slate-600 my-3"></div>

          <!-- Net profit -->
          <div class="flex justify-between py-1.5">
            <span class="font-semibold text-slate-800 dark:text-slate-200">Чистая прибыль</span>
            <span
              class="font-bold tabular-nums"
              :class="Number(pnlData.net_profit) < 0 ? 'text-red-500' : 'text-green-600'"
            >{{ formatMoney(pnlData.net_profit) }}</span>
          </div>
          <div class="flex justify-between py-0.5">
            <span class="text-slate-500 text-xs">Маржа</span>
            <span class="font-semibold text-xs" :class="pnlMarginCls">{{ pnlData.margin_pct }}%</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
