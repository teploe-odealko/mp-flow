<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { usePromoStore, type PromoItem } from '@/stores/promo'
import { useUiStore } from '@/stores/ui'

const promoStore = usePromoStore()
const ui = useUiStore()
const loading = ref(false)

// Track edited min prices: offerId -> { value, orig }
const editedMinPrices = ref<Record<string, { value: number; orig: number }>>({})

onMounted(async () => {
  if (!promoStore.promoLoaded) {
    await loadData()
  }
})

async function loadData() {
  loading.value = true
  try {
    await promoStore.loadPromoData()
  } catch (e: any) {
    ui.addToast('Ошибка загрузки: ' + (e.message || e), 'error')
  } finally {
    loading.value = false
  }
}

const sortedItems = computed(() => {
  const items = [...promoStore.promoItems]
  const { field, dir } = promoStore.promoSort
  items.sort((a: any, b: any) => {
    let va = a[field]
    let vb = b[field]
    if (typeof va === 'string') va = va.toLowerCase()
    if (typeof vb === 'string') vb = vb.toLowerCase()
    if (va < vb) return dir === 'asc' ? -1 : 1
    if (va > vb) return dir === 'asc' ? 1 : -1
    return 0
  })
  return items
})

function onSortClick(field: string) {
  promoStore.sortItems(field)
}

function sortArrow(field: string): string {
  if (promoStore.promoSort.field !== field) return ''
  return promoStore.promoSort.dir === 'asc' ? '\u25B2' : '\u25BC'
}

function sortArrowClass(field: string): string {
  return promoStore.promoSort.field === field ? 'sort-arrow active' : 'sort-arrow'
}

function fmt(v: number | null): string {
  return v ? Number(v).toLocaleString('ru-RU') : '\u2014'
}

// Price index badge
const INDEX_BADGE_MAP: Record<string, { bg: string; text: string; label: string }> = {
  SUPER: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', label: 'Super' },
  GREEN: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', label: 'Выгодная' },
  RED: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', label: 'Завышена' },
  WITHOUT_INDEX: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-500', label: '\u2014' },
}

function indexBadge(color: string) {
  return INDEX_BADGE_MAP[color] || INDEX_BADGE_MAP.WITHOUT_INDEX
}

// Timer display
function timerDays(item: PromoItem): number | null {
  if (!item.timer_enabled || !item.timer_expires_at) return null
  const expires = new Date(item.timer_expires_at)
  const now = new Date()
  return Math.max(0, Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
}

function timerColor(days: number): string {
  if (days <= 7) return 'text-red-600 dark:text-red-400'
  if (days <= 14) return 'text-amber-600 dark:text-amber-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

// Min price editing
function onMinPriceInput(offerId: string, value: string, origPrice: number) {
  const num = parseFloat(value) || 0
  editedMinPrices.value[offerId] = { value: num, orig: origPrice }
}

function isMinPriceChanged(offerId: string): boolean {
  const edit = editedMinPrices.value[offerId]
  if (!edit) return false
  return edit.value !== edit.orig
}

async function saveMinPrice(offerId: string, price: number) {
  const edit = editedMinPrices.value[offerId]
  if (!edit) return
  try {
    const result = await promoStore.saveMinPrice(offerId, price, edit.value)
    if (result.errors?.length) {
      ui.addToast('Ошибка: ' + JSON.stringify(result.errors[0].errors), 'error')
    } else {
      ui.addToast('Мин. цена обновлена', 'success')
      edit.orig = edit.value
    }
  } catch (e: any) {
    ui.addToast('Ошибка: ' + (e.message || e), 'error')
  }
}

// Toggle promo flags
async function onToggleFlag(
  offerId: string,
  field: 'auto_action_enabled' | 'auto_add_to_ozon_actions_list_enabled',
  enabled: boolean,
  price: number,
) {
  try {
    const result = await promoStore.togglePromoFlag(offerId, field, enabled, price)
    if (result.errors?.length) {
      ui.addToast('Ошибка: ' + JSON.stringify(result.errors[0].errors), 'error')
    } else {
      ui.addToast(enabled ? 'Включено' : 'Выключено', 'success')
    }
  } catch (e: any) {
    ui.addToast('Ошибка: ' + (e.message || e), 'error')
  }
}

// Refresh single timer
async function onRefreshTimer(productId: number) {
  try {
    await promoStore.refreshTimers([productId])
    ui.addToast('Таймер обновлён на 30 дней', 'success')
  } catch (e: any) {
    ui.addToast('Ошибка: ' + (e.message || e), 'error')
  }
}

// Bulk operations
async function bulkToggle(
  field: 'auto_action_enabled' | 'auto_add_to_ozon_actions_list_enabled',
  value: 'ENABLED' | 'DISABLED',
) {
  if (!promoStore.promoItems.length) return
  try {
    const result = await promoStore.bulkToggle(field, value)
    const errCount = (result?.errors || []).length
    if (errCount) {
      ui.addToast(`Обновлено ${result?.updated}, ошибок: ${errCount}`, 'error')
    } else {
      ui.addToast(`Обновлено: ${result?.updated}`, 'success')
    }
  } catch (e: any) {
    ui.addToast('Ошибка: ' + (e.message || e), 'error')
  }
}

async function bulkRefreshTimers() {
  if (!promoStore.promoItems.length) return
  try {
    await promoStore.refreshTimers()
    ui.addToast('Все таймеры обновлены на 30 дней', 'success')
  } catch (e: any) {
    ui.addToast('Ошибка: ' + (e.message || e), 'error')
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-3">
      <button
        class="px-4 py-2 text-sm font-medium text-white bg-sky-500 hover:bg-sky-600 rounded-lg transition-colors disabled:opacity-50"
        :disabled="loading"
        @click="loadData"
      >
        {{ loading ? 'Загрузка...' : 'Загрузить с Ozon' }}
      </button>

      <div class="flex-1" />

      <!-- Bulk toggles -->
      <template v-if="promoStore.promoItems.length">
        <button
          class="px-3 py-1.5 text-xs font-medium text-emerald-600 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors"
          @click="bulkToggle('auto_action_enabled', 'ENABLED')"
        >
          Вкл. все автоакции
        </button>
        <button
          class="px-3 py-1.5 text-xs font-medium text-slate-500 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          @click="bulkToggle('auto_action_enabled', 'DISABLED')"
        >
          Выкл. все автоакции
        </button>
        <button
          class="px-3 py-1.5 text-xs font-medium text-sky-500 border border-sky-200 dark:border-sky-800 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950 transition-colors"
          @click="bulkRefreshTimers"
        >
          Обновить все таймеры
        </button>
      </template>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center text-sm text-slate-400 py-8">
      Загрузка данных...
    </div>

    <!-- Table -->
    <div v-else-if="promoStore.promoItems.length" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table class="w-full text-left">
        <thead>
          <tr class="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
            <th
              class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-pointer"
              @click="onSortClick('title')"
            >
              Товар <span :class="sortArrowClass('title')">{{ sortArrow('title') }}</span>
            </th>
            <th
              class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right cursor-pointer"
              @click="onSortClick('price')"
            >
              Цена <span :class="sortArrowClass('price')">{{ sortArrow('price') }}</span>
            </th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">
              Мин. цена
            </th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-center">
              Таймер
            </th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-center">
              Ценовой индекс
            </th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-center">
              Автоакция
            </th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-center">
              Авто Ozon акции
            </th>
            <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-center">
              Акции
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="it in sortedItems"
            :key="it.offer_id"
            class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
          >
            <!-- Product -->
            <td class="px-3 py-2.5">
              <div class="text-sm font-medium text-slate-900 dark:text-white">{{ it.title }}</div>
              <div v-if="it.sku" class="text-xs text-slate-400">{{ it.sku }}</div>
            </td>

            <!-- Price -->
            <td class="px-3 py-2.5 text-right text-sm text-slate-700 dark:text-slate-300 font-mono">
              {{ fmt(it.price) }}
            </td>

            <!-- Min price (editable) -->
            <td class="px-3 py-2.5 text-right">
              <div class="flex items-center justify-end gap-1">
                <input
                  type="number"
                  :value="editedMinPrices[it.offer_id]?.value ?? it.min_price ?? ''"
                  min="0"
                  step="1"
                  class="w-20 text-sm text-right font-mono border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                  @input="onMinPriceInput(it.offer_id, ($event.target as HTMLInputElement).value, it.min_price || 0)"
                />
                <button
                  v-if="isMinPriceChanged(it.offer_id)"
                  class="px-1.5 py-0.5 text-xs font-medium text-white bg-sky-500 rounded hover:bg-sky-600 transition-colors"
                  @click="saveMinPrice(it.offer_id, it.price || 0)"
                >
                  OK
                </button>
              </div>
            </td>

            <!-- Timer -->
            <td class="px-3 py-2.5 text-center">
              <template v-if="timerDays(it) != null">
                <span :class="['text-xs font-medium', timerColor(timerDays(it)!)]">{{ timerDays(it) }}д</span>
                <button
                  class="ml-1 text-xs text-sky-500 hover:text-sky-700 dark:hover:text-sky-300"
                  title="Обновить таймер (сброс на 30 дней)"
                  @click="onRefreshTimer(it.product_id)"
                >
                  <svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </template>
              <span v-else class="text-xs text-slate-400">&mdash;</span>
            </td>

            <!-- Price index badge -->
            <td class="px-3 py-2.5 text-center">
              <span :class="['inline-flex px-2 py-0.5 text-xs font-medium rounded-full', indexBadge(it.color_index).bg, indexBadge(it.color_index).text]">
                {{ indexBadge(it.color_index).label }}
              </span>
            </td>

            <!-- Auto action toggle -->
            <td class="px-3 py-2.5 text-center">
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  :checked="it.auto_action_enabled"
                  class="sr-only peer"
                  @change="onToggleFlag(it.offer_id, 'auto_action_enabled', ($event.target as HTMLInputElement).checked, it.price || 0)"
                />
                <div class="w-9 h-5 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500" />
              </label>
            </td>

            <!-- Auto add to Ozon actions toggle -->
            <td class="px-3 py-2.5 text-center">
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  :checked="it.auto_add_to_ozon_actions_list_enabled"
                  class="sr-only peer"
                  @change="onToggleFlag(it.offer_id, 'auto_add_to_ozon_actions_list_enabled', ($event.target as HTMLInputElement).checked, it.price || 0)"
                />
                <div class="w-9 h-5 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500" />
              </label>
            </td>

            <!-- Actions count -->
            <td class="px-3 py-2.5 text-center">
              <span
                v-if="it.actions_count > 0"
                class="inline-flex items-center justify-center w-6 h-6 text-xs font-bold rounded-full bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400"
                :title="it.actions.map((a) => a.title).join('\n')"
              >
                {{ it.actions_count }}
              </span>
              <span v-else class="text-xs text-slate-400">&mdash;</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="promoStore.promoLoaded && !loading"
      class="text-center text-sm text-slate-400 py-8"
    >
      Нет данных. Нажмите "Загрузить с Ozon" для загрузки.
    </div>
  </div>
</template>
