<script setup lang="ts">
import { computed } from 'vue'
import { usePricesStore, calcPriceFromROI, calcROIFromPrice, type PriceProduct } from '@/stores/prices'
import { useUiStore } from '@/stores/ui'

const pricesStore = usePricesStore()
const ui = useUiStore()

let searchTimer: ReturnType<typeof setTimeout> | null = null

function onSearchInput(e: Event) {
  pricesStore.priceSearchQuery = (e.target as HTMLInputElement).value.trim()
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => pricesStore.loadPriceProducts(), 300)
}

function onSortClick(field: string) {
  pricesStore.toggleSort(field)
  pricesStore.loadPriceProducts()
}

function sortArrow(field: string): string {
  if (pricesStore.priceSort.field !== field) return ''
  return pricesStore.priceSort.dir === 'asc' ? '\u25B2' : '\u25BC'
}

function sortArrowClass(field: string): string {
  return pricesStore.priceSort.field === field ? 'sort-arrow active' : 'sort-arrow'
}

function fmt(v: number | null): string {
  return v ? Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : '\u2014'
}

function findCommRate(price: number, tiers: PriceProduct['commission_tiers']): number {
  if (!tiers || !tiers.length) return 0
  for (const t of tiers) {
    if (price >= t.price_min && (t.price_max == null || price < t.price_max)) return t.rate
  }
  return tiers[tiers.length - 1].rate
}

function commPct(product: PriceProduct): string | null {
  const price = pricesStore.getRowPrice(product.id)
  if (price && product.commission_tiers?.length) {
    return (findCommRate(price, product.commission_tiers) * 100).toFixed(1)
  }
  return null
}

function effectivePrice(product: PriceProduct): number | null {
  return pricesStore.getRowPrice(product.id)
}

function isRoiOverridden(cardId: string): boolean {
  return pricesStore.priceRowRoi[cardId] != null
}

function isPriceOverridden(cardId: string): boolean {
  return pricesStore.priceRowPrice[cardId] != null
}

function onGlobalRoiSlider(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  pricesStore.setGlobalRoi(val)
}

function onGlobalRoiInput(e: Event) {
  const val = Math.max(0, Math.min(500, Number((e.target as HTMLInputElement).value) || 0))
  pricesStore.setGlobalRoi(val)
}

function onRowRoiInput(e: Event, cardId: string) {
  const val = Number((e.target as HTMLInputElement).value)
  pricesStore.setRowRoi(cardId, val)
}

function onRowPriceInput(e: Event, cardId: string) {
  const val = Number((e.target as HTMLInputElement).value)
  pricesStore.setRowPrice(cardId, val)
}

async function onApplyPrice(offerId: string, price: number, action: 'min' | 'sale') {
  const update: { offer_id: string; price?: number; min_price?: number } = { offer_id: offerId }
  if (action === 'min') update.min_price = price
  else update.price = price
  try {
    const result = await pricesStore.applyPrices([update])
    if (result?.errors?.length) {
      ui.addToast(`Ошибка: ${result.errors[0].errors.join(', ')}`, 'error')
    } else {
      ui.addToast(`Цена установлена`, 'success')
    }
  } catch (err: any) {
    ui.addToast('Ошибка: ' + (err.message || ''), 'error')
  }
}

async function bulkApply(action: 'min' | 'sale') {
  const updates: Array<{ offer_id: string; price?: number; min_price?: number }> = []
  for (const p of pricesStore.priceProducts) {
    if (!p.ozon_offer_id || !p.cogs || p.cogs <= 0 || !p.commission_tiers?.length) continue
    const price = pricesStore.getRowPrice(p.id)
    if (price) {
      if (action === 'min') updates.push({ offer_id: p.ozon_offer_id, min_price: price })
      else updates.push({ offer_id: p.ozon_offer_id, price })
    }
  }
  if (!updates.length) {
    ui.addToast('Нет товаров с расчётной ценой', 'error')
    return
  }
  try {
    const result = await pricesStore.applyPrices(updates)
    if (result?.errors?.length) {
      ui.addToast(`Установлено ${result.updated}, ошибок: ${result.errors.length}`, 'error')
    } else {
      ui.addToast(`Цены установлены: ${result?.updated || 0} товаров`, 'success')
    }
  } catch (err: any) {
    ui.addToast('Ошибка: ' + (err.message || ''), 'error')
  }
}

const filteredCount = computed(() =>
  pricesStore.priceProducts.filter(p => p.ozon_offer_id && p.cogs > 0 && p.commission_tiers?.length).length
)

const bulkSuffix = computed(() => pricesStore.priceSearchQuery ? ` (${filteredCount.value})` : '')
</script>

<template>
  <div class="space-y-4">
    <!-- Global ROI -->
    <div class="flex flex-wrap items-center gap-4">
      <label class="text-sm font-medium text-slate-700 dark:text-slate-300">Целевой ROI:</label>
      <input
        type="range"
        min="0"
        max="200"
        :value="pricesStore.priceGlobalRoi"
        class="w-40"
        @input="onGlobalRoiSlider"
      />
      <input
        type="number"
        min="0"
        max="500"
        :value="pricesStore.priceGlobalRoi"
        class="w-16 text-sm text-center border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 py-0.5"
        @change="onGlobalRoiInput"
      />
      <span class="text-sm text-slate-500">%</span>

      <div class="flex-1" />

      <!-- Bulk buttons -->
      <button
        class="px-3 py-1.5 text-xs font-medium text-sky-500 border border-sky-200 dark:border-sky-800 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950 transition-colors"
        @click="bulkApply('min')"
      >
        Уст. мин. цену{{ bulkSuffix }}
      </button>
      <button
        class="px-3 py-1.5 text-xs font-medium text-sky-500 border border-sky-200 dark:border-sky-800 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950 transition-colors"
        @click="bulkApply('sale')"
      >
        Уст. цену продажи{{ bulkSuffix }}
      </button>
    </div>

    <!-- Search -->
    <div class="relative max-w-[360px]">
      <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        class="list-search-input"
        placeholder="Поиск по SKU, названию..."
        :value="pricesStore.priceSearchQuery"
        @input="onSearchInput"
      />
    </div>

    <!-- Table -->
    <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table class="w-full text-left">
        <thead>
          <tr class="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-pointer" @click="onSortClick('title')">
              Товар <span :class="sortArrowClass('title')">{{ sortArrow('title') }}</span>
            </th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right cursor-pointer" @click="onSortClick('cogs')">
              С/с <span :class="sortArrowClass('cogs')">{{ sortArrow('cogs') }}</span>
            </th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Комис.</th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-center">ROI %</th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Расч. цена</th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Мин. цена</th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right cursor-pointer" @click="onSortClick('ozon_price')">
              Цена продажи <span :class="sortArrowClass('ozon_price')">{{ sortArrow('ozon_price') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in pricesStore.priceProducts"
            :key="p.id"
            :class="['hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors', !p.cogs || p.cogs <= 0 ? 'opacity-50' : '']"
          >
            <td class="px-3 py-2.5">
              <div class="text-sm font-medium text-slate-800 dark:text-slate-200 truncate max-w-[220px]" :title="p.title">{{ p.title }}</div>
              <div class="text-xs text-slate-400 font-mono">{{ p.sku || p.ozon_offer_id || '\u2014' }}</div>
              <div v-if="p.ozon_category_name && p.ozon_product_type_name" class="text-[10px] text-slate-400 truncate max-w-[220px]" :title="`${p.ozon_category_name} / ${p.ozon_product_type_name}`">
                {{ p.ozon_category_name }} / {{ p.ozon_product_type_name }}
              </div>
            </td>
            <td class="px-3 py-2.5 text-right text-sm text-slate-600 dark:text-slate-400">{{ fmt(p.cogs) }}</td>
            <td class="px-3 py-2.5 text-right text-sm text-slate-600 dark:text-slate-400">{{ commPct(p) ? commPct(p) + '%' : '\u2014' }}</td>
            <td class="px-3 py-2.5 text-center">
              <input
                type="number"
                min="0"
                max="500"
                step="5"
                :value="pricesStore.getRowRoi(p.id)"
                :class="['w-16 text-sm text-center border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 py-0.5', isRoiOverridden(p.id) ? 'border-sky-400 dark:border-sky-500' : '']"
                @input="onRowRoiInput($event, p.id)"
              />
            </td>
            <td class="px-3 py-2.5 text-right">
              <template v-if="effectivePrice(p)">
                <input
                  type="number"
                  min="1"
                  step="1"
                  :value="effectivePrice(p)"
                  :class="['w-20 text-sm text-right border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 py-0.5 font-mono', isPriceOverridden(p.id) ? 'border-sky-400 dark:border-sky-500' : '']"
                  @input="onRowPriceInput($event, p.id)"
                />
              </template>
              <span v-else class="text-sm text-slate-400">\u2014</span>
            </td>
            <td class="px-3 py-2.5 text-right">
              <div class="flex items-center justify-end gap-1.5">
                <span class="text-sm text-slate-600 dark:text-slate-400">{{ fmt(p.ozon_min_price) }}</span>
                <button
                  v-if="effectivePrice(p) && p.ozon_offer_id"
                  class="text-xs text-sky-500 hover:text-sky-700 dark:hover:text-sky-300"
                  title="Установить расч. цену как мин."
                  @click="onApplyPrice(p.ozon_offer_id!, effectivePrice(p)!, 'min')"
                >
                  &larr;
                </button>
              </div>
            </td>
            <td class="px-3 py-2.5 text-right">
              <div class="flex items-center justify-end gap-1.5">
                <span class="text-sm font-medium text-slate-800 dark:text-slate-200">{{ fmt(p.ozon_price) }}</span>
                <button
                  v-if="effectivePrice(p) && p.ozon_offer_id"
                  class="text-xs text-sky-500 hover:text-sky-700 dark:hover:text-sky-300"
                  title="Установить расч. цену как продажную"
                  @click="onApplyPrice(p.ozon_offer_id!, effectivePrice(p)!, 'sale')"
                >
                  &larr;
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!pricesStore.priceProducts.length">
            <td colspan="7" class="px-4 py-8 text-center text-sm text-slate-400">
              {{ pricesStore.priceSearchQuery ? 'Ничего не найдено' : 'Нет товаров. Нажмите "Синхронизировать" для загрузки данных с Ozon.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
