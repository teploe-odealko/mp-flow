<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useLogisticsStore, type MatrixRow } from '@/stores/logistics'
import { useUiStore } from '@/stores/ui'
import { formatMoney } from '@/utils/format'
import SkuLogisticsDrawer from '@/components/logistics/SkuLogisticsDrawer.vue'
import DiscrepancyModal from '@/components/logistics/DiscrepancyModal.vue'

const router = useRouter()
const logisticsStore = useLogisticsStore()
const ui = useUiStore()

const drawerOpen = ref(false)
const drawerCardId = ref<string | null>(null)
const discrepancyOpen = ref(false)
const discrepancyRow = ref<{ cardId: string; disc: number; title: string } | null>(null)

const grpBorder = 'border-l border-slate-200 dark:border-slate-700'

function fq(v: number): string {
  return v > 0 ? Number(v).toLocaleString('ru-RU') : '\u2014'
}

function fd(v: number): string {
  return v !== 0 ? Number(v).toLocaleString('ru-RU') : '\u2014'
}

function cc(v: number): string {
  return v > 0 ? '' : 'text-slate-400'
}

function cd(v: number): string {
  if (v > 0) return 'text-amber-500 dark:text-amber-400'
  if (v < 0) return 'text-red-500'
  return 'text-slate-400'
}

function discrepancy(r: MatrixRow): number {
  return Number(r.shipped_to_ozon || 0) - (
    Number(r.ozon_stock || 0) +
    Number(r.delivering_qty || 0) +
    Number(r.purchased_qty || 0) +
    Number(r.returns_in_transit || 0)
  )
}

const totals = computed(() => {
  let tOrd = 0, tRcv = 0, tWh = 0, tShipped = 0, tOzon = 0, tDlvr = 0, tDlvd = 0, tRet = 0, tDisc = 0
  for (const r of logisticsStore.matrixData) {
    tOrd += Number(r.ordered_qty || 0)
    tRcv += Number(r.received_qty || 0)
    tWh += Number(r.warehouse_stock || 0)
    tShipped += Number(r.shipped_to_ozon || 0)
    tOzon += Number(r.ozon_stock || 0)
    tDlvr += Number(r.delivering_qty || 0)
    tDlvd += Number(r.purchased_qty || 0)
    tRet += Number(r.returns_in_transit || 0)
    tDisc += discrepancy(r)
  }
  return { tOrd, tRcv, tWh, tShipped, tOzon, tDlvr, tDlvd, tRet, tDisc }
})

function fl(v: number): string {
  return v > 0 ? v.toLocaleString('ru-RU') : '\u2014'
}

function onRowClick(masterCardId: string) {
  router.push(`/card/${masterCardId}`)
}

function onWriteOffClick(e: Event, r: MatrixRow) {
  e.stopPropagation()
  const disc = discrepancy(r)
  discrepancyRow.value = {
    cardId: r.master_card_id,
    disc,
    title: r.title || '',
  }
  discrepancyOpen.value = true
}

async function onDiscrepancySaved() {
  discrepancyOpen.value = false
  await logisticsStore.loadMatrix()
}

function openSkuDrawer(masterCardId: string) {
  drawerCardId.value = masterCardId
  drawerOpen.value = true
}
</script>

<template>
  <div class="space-y-4">
    <!-- Needs balance banner -->
    <div
      v-if="logisticsStore.matrixNeedsBalance"
      class="p-3 rounded-lg text-sm bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300"
    >
      Оприходуйте остатки, чтобы увидеть матрицу
    </div>

    <!-- Summary bar -->
    <div
      v-if="logisticsStore.matrixData.length"
      class="flex flex-wrap items-center gap-4 text-sm text-slate-600 dark:text-slate-400"
    >
      <span>Отгружено: <b>{{ fl(totals.tShipped) }}</b></span>
      <span>На Ozon: <b>{{ fl(totals.tOzon) }}</b></span>
      <span>В пути: <b>{{ fl(totals.tDlvr) }}</b></span>
      <span>Выкуплено: <b>{{ fl(totals.tDlvd) }}</b></span>
      <span :class="cd(totals.tDisc)">Расхожд.: <b>{{ fd(totals.tDisc) }}</b></span>
    </div>

    <!-- Table -->
    <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table class="w-full text-left">
        <thead>
          <tr class="bg-slate-50 dark:bg-slate-800/50">
            <th rowspan="2" class="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 sticky left-0 bg-slate-50 dark:bg-slate-800/50 z-10 border-b border-slate-200 dark:border-slate-700">
              SKU / Товар
            </th>
            <th colspan="2" :class="'text-center px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 ' + grpBorder">
              Поставщик
            </th>
            <th colspan="2" :class="'text-center px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 ' + grpBorder">
              Склад
            </th>
            <th colspan="4" :class="'text-center px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 ' + grpBorder">
              Озон
            </th>
            <th rowspan="2" :class="'text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-help ' + grpBorder" title="Отгружено - (На складе + В пути + Выкуплено + Едет на склад). Показывает неучтённые единицы.">
              Расхожд.
            </th>
          </tr>
          <tr class="bg-slate-50 dark:bg-slate-800/50">
            <th :class="'text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-help ' + grpBorder" title="Заказано у поставщика (из закупок)">Заказ</th>
            <th class="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-help" title="Получено от поставщика на ваш склад">Получ.</th>
            <th :class="'text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-help ' + grpBorder" title="Текущий остаток на вашем складе">В наличии</th>
            <th class="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-help" title="Отгружено на склады Ozon (все поставки кроме отменённых)">Отгружено</th>
            <th :class="'text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-help ' + grpBorder" title="Остаток на складах Ozon (FBO + FBS)">На складе</th>
            <th class="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-help" title="В доставке покупателям (ещё не доставлено и не отменено)">В пути</th>
            <th class="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-help" title="Доставлено покупателям минус возвраты (чистые выкупы)">Выкуплено</th>
            <th class="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-help" title="Товар в пути обратно на склад (отмены + возвраты, ещё не финализированы)">Едет на склад</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in logisticsStore.matrixData"
            :key="r.master_card_id"
            class="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            @click="onRowClick(r.master_card_id)"
          >
            <td class="px-4 py-2.5 sticky left-0 bg-white dark:bg-slate-900 z-10">
              <div class="font-medium text-sm">{{ r.sku || '\u2014' }}</div>
              <div class="text-xs text-slate-500 truncate max-w-[220px]">{{ r.title || '' }}</div>
            </td>
            <td :class="'text-right px-3 py-2.5 text-sm ' + grpBorder + ' ' + cc(r.ordered_qty)">{{ fq(r.ordered_qty) }}</td>
            <td :class="'text-right px-3 py-2.5 text-sm ' + cc(r.received_qty)">{{ fq(r.received_qty) }}</td>
            <td :class="'text-right px-3 py-2.5 text-sm ' + grpBorder + ' ' + cc(r.warehouse_stock)">{{ fq(r.warehouse_stock) }}</td>
            <td :class="'text-right px-3 py-2.5 text-sm ' + cc(r.shipped_to_ozon)">{{ fq(r.shipped_to_ozon) }}</td>
            <td :class="'text-right px-3 py-2.5 text-sm font-semibold ' + grpBorder + ' ' + cc(r.ozon_stock)">{{ fq(r.ozon_stock) }}</td>
            <td :class="'text-right px-3 py-2.5 text-sm ' + cc(r.delivering_qty)">{{ fq(r.delivering_qty) }}</td>
            <td :class="'text-right px-3 py-2.5 text-sm ' + cc(r.purchased_qty)">{{ fq(r.purchased_qty) }}</td>
            <td :class="'text-right px-3 py-2.5 text-sm ' + cc(r.returns_in_transit)">{{ fq(r.returns_in_transit) }}</td>
            <td :class="'text-right px-3 py-2.5 text-sm font-medium ' + grpBorder + ' ' + cd(discrepancy(r))">
              {{ fd(discrepancy(r)) }}
              <button
                v-if="discrepancy(r) > 0"
                class="ml-1 text-xs text-red-400 hover:text-red-300 underline"
                @click.stop="onWriteOffClick($event, r)"
              >
                Списать
              </button>
            </td>
          </tr>
          <tr v-if="!logisticsStore.matrixData.length">
            <td colspan="10" class="px-4 py-8 text-center text-sm text-slate-400">
              {{ logisticsStore.matrixNeedsBalance ? 'Оприходуйте остатки, чтобы увидеть матрицу' : 'Нет данных. Нажмите "Синхронизировать" для загрузки.' }}
            </td>
          </tr>
        </tbody>
        <tfoot v-if="logisticsStore.matrixData.length">
          <tr class="font-bold text-sm">
            <td class="px-4 py-2.5 sticky left-0 bg-white dark:bg-slate-900 z-10">Итого ({{ logisticsStore.matrixData.length }} SKU)</td>
            <td :class="'text-right px-3 py-2.5 ' + grpBorder">{{ fl(totals.tOrd) }}</td>
            <td class="text-right px-3 py-2.5">{{ fl(totals.tRcv) }}</td>
            <td :class="'text-right px-3 py-2.5 ' + grpBorder">{{ fl(totals.tWh) }}</td>
            <td class="text-right px-3 py-2.5">{{ fl(totals.tShipped) }}</td>
            <td :class="'text-right px-3 py-2.5 ' + grpBorder">{{ fl(totals.tOzon) }}</td>
            <td class="text-right px-3 py-2.5">{{ fl(totals.tDlvr) }}</td>
            <td class="text-right px-3 py-2.5">{{ fl(totals.tDlvd) }}</td>
            <td class="text-right px-3 py-2.5">{{ fl(totals.tRet) }}</td>
            <td :class="'text-right px-3 py-2.5 ' + grpBorder + ' ' + cd(totals.tDisc)">{{ fd(totals.tDisc) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- SKU Logistics Drawer -->
    <SkuLogisticsDrawer
      :open="drawerOpen"
      :master-card-id="drawerCardId"
      @close="drawerOpen = false"
    />

    <!-- Discrepancy Modal -->
    <DiscrepancyModal
      :open="discrepancyOpen"
      :card-id="discrepancyRow?.cardId ?? ''"
      :quantity="discrepancyRow?.disc ?? 0"
      :product-name="discrepancyRow?.title ?? ''"
      @close="discrepancyOpen = false"
      @saved="onDiscrepancySaved"
    />
  </div>
</template>
