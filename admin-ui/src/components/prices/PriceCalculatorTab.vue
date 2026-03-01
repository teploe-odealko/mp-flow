<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePricesStore, type BreakevenResult, type BreakevenBreakdown } from '@/stores/prices'
import { useUiStore } from '@/stores/ui'

const pricesStore = usePricesStore()
const ui = useUiStore()

const categoryInput = ref('')
const dropdownVisible = ref(false)
const selectedCategory = ref('')
const selectedType = ref('')
const cogsInput = ref('')
const lastMileInput = ref('63')
const targetMarginInput = ref('')
const salePriceInput = ref('')
const usnRateInput = ref('7')
const returnRateInput = ref('5')
const returnLogisticsInput = ref('50')
const calculating = ref(false)
const calcResult = ref<BreakevenResult | null>(null)
const calcError = ref('')
const typesLoading = ref(false)

const filteredCategories = computed(() => {
  const q = categoryInput.value.toLowerCase()
  if (!q) return []
  return pricesStore.calcCategories
    .filter((c) => c.toLowerCase().includes(q))
    .slice(0, 50)
})

function onCategoryInput() {
  selectedCategory.value = ''
  selectedType.value = ''
  dropdownVisible.value = filteredCategories.value.length > 0
}

async function selectCategory(cat: string) {
  categoryInput.value = cat
  selectedCategory.value = cat
  dropdownVisible.value = false
  typesLoading.value = true
  try {
    await pricesStore.loadCalcTypes(cat)
  } catch {
    ui.addToast('Ошибка загрузки типов', 'error')
  } finally {
    typesLoading.value = false
  }
}

function onClickOutside() {
  dropdownVisible.value = false
}

async function calculate() {
  const category = selectedCategory.value || categoryInput.value.trim()
  const product_type = selectedType.value
  const cogs = parseFloat(cogsInput.value)
  const last_mile = parseFloat(lastMileInput.value) || 63
  const target_margin = parseFloat(targetMarginInput.value)
  const sale_price = parseFloat(salePriceInput.value)
  const usn_rate = parseFloat(usnRateInput.value) || 7
  const return_rate = parseFloat(returnRateInput.value) || 5
  const return_logistics = parseFloat(returnLogisticsInput.value) || 50

  if (!category || !product_type) {
    ui.addToast('Выберите категорию и тип товара', 'error')
    return
  }
  if (!cogs || cogs <= 0) {
    ui.addToast('Введите себестоимость', 'error')
    return
  }

  calculating.value = true
  calcError.value = ''
  calcResult.value = null

  try {
    const payload: Parameters<typeof pricesStore.calculateBreakeven>[0] = {
      cogs_rub: cogs,
      category,
      product_type,
      scheme: 'FBO',
      last_mile_rub: last_mile,
      usn_rate_pct: usn_rate,
      return_rate_pct: return_rate,
      return_logistics_rub: return_logistics,
    }

    if (sale_price > 0) {
      payload.sale_price_rub = sale_price
    } else if (!isNaN(target_margin)) {
      payload.target_margin_pct = target_margin
    } else {
      payload.margin_targets = [0, 10, 15, 20, 25, 30]
    }

    calcResult.value = await pricesStore.calculateBreakeven(payload)
  } catch (e: any) {
    calcError.value = e.message || 'Неизвестная ошибка'
  } finally {
    calculating.value = false
  }
}

function fmt(v: number): string {
  return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 })
}

function fmtDec(v: number): string {
  return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

function marginClass(v: number): string {
  return v >= 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-500 dark:text-red-400'
}

// Check result type helpers
function isMultiMargin(r: BreakevenResult): boolean {
  return !!r.margin_results && r.margin_results.length > 0
}

function singleSalePrice(r: BreakevenResult): number {
  return r.sale_price_rub || r.breakeven_price_rub || 0
}

function singleMargin(r: BreakevenResult): number {
  return r.actual_margin_pct != null
    ? r.actual_margin_pct
    : r.target_margin_pct || 0
}
</script>

<template>
  <div class="space-y-6">
    <!-- Input form -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Category autocomplete -->
      <div class="relative" @focusout="onClickOutside">
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Категория Ozon</label>
        <input
          v-model="categoryInput"
          type="text"
          class="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
          placeholder="Начните вводить категорию..."
          autocomplete="off"
          @input="onCategoryInput"
          @focus="onCategoryInput"
        />
        <div
          v-if="dropdownVisible && filteredCategories.length"
          class="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg"
        >
          <div
            v-for="cat in filteredCategories"
            :key="cat"
            class="px-3 py-2 cursor-pointer hover:bg-sky-50 dark:hover:bg-slate-700 text-sm text-slate-700 dark:text-slate-200"
            @mousedown.prevent="selectCategory(cat)"
          >
            {{ cat }}
          </div>
        </div>
      </div>

      <!-- Type select -->
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Тип товара</label>
        <select
          v-model="selectedType"
          :disabled="!pricesStore.calcTypes.length && !typesLoading"
          class="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none disabled:opacity-50"
        >
          <option value="">
            {{ typesLoading ? 'Загрузка...' : 'Выберите тип' }}
          </option>
          <option v-for="t in pricesStore.calcTypes" :key="t" :value="t">
            {{ t }}
          </option>
        </select>
      </div>

      <!-- COGS -->
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Себестоимость (руб.)</label>
        <input
          v-model="cogsInput"
          type="number"
          min="0"
          step="1"
          class="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
          placeholder="Себестоимость"
        />
      </div>

      <!-- Last mile -->
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Последняя миля (руб.)</label>
        <input
          v-model="lastMileInput"
          type="number"
          min="0"
          step="1"
          class="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
        />
      </div>

      <!-- Target margin -->
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Целевая маржа (%)</label>
        <input
          v-model="targetMarginInput"
          type="number"
          min="0"
          max="100"
          step="1"
          class="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
          placeholder="Оставьте пустым для таблицы маржей"
        />
      </div>

      <!-- Sale price -->
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Цена продажи (руб.)</label>
        <input
          v-model="salePriceInput"
          type="number"
          min="0"
          step="1"
          class="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
          placeholder="Для обратного расчёта"
        />
      </div>

      <!-- USN rate -->
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Ставка УСН (%)</label>
        <input
          v-model="usnRateInput"
          type="number"
          min="0"
          max="100"
          step="0.1"
          class="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
        />
      </div>

      <!-- Return rate -->
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Доля возвратов (%)</label>
        <input
          v-model="returnRateInput"
          type="number"
          min="0"
          max="100"
          step="0.1"
          class="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
        />
      </div>

      <!-- Return logistics -->
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Логистика возврата (руб.)</label>
        <input
          v-model="returnLogisticsInput"
          type="number"
          min="0"
          step="1"
          class="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
        />
      </div>
    </div>

    <!-- Calculate button -->
    <div>
      <button
        class="px-6 py-2.5 text-sm font-medium text-white bg-sky-500 hover:bg-sky-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="calculating"
        @click="calculate"
      >
        {{ calculating ? 'Считаем...' : 'Рассчитать' }}
      </button>
    </div>

    <!-- Error -->
    <div v-if="calcError" class="text-red-500 text-sm">
      Ошибка: {{ calcError }}
    </div>

    <!-- Result -->
    <div v-if="calcResult">
      <!-- Error in result -->
      <div v-if="calcResult.error" class="text-red-500 text-sm">
        {{ calcResult.error }}
      </div>

      <!-- Multi-margin table -->
      <template v-else-if="isMultiMargin(calcResult)">
        <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table class="w-full">
            <thead>
              <tr class="border-b border-slate-200 dark:border-slate-700">
                <th class="px-3 py-2 text-left text-xs uppercase text-slate-500">Маржа</th>
                <th class="px-3 py-2 text-right text-xs uppercase text-slate-500">Цена продажи</th>
                <th class="px-3 py-2 text-right text-xs uppercase text-slate-500">Прибыль</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              <tr
                v-for="r in calcResult.margin_results"
                :key="r.target_margin_pct"
                class="hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <td class="px-3 py-2 text-sm font-medium">{{ r.target_margin_pct }}%</td>
                <template v-if="r.error">
                  <td colspan="2" class="px-3 py-2 text-sm text-red-500">{{ r.error }}</td>
                </template>
                <template v-else>
                  <td class="px-3 py-2 text-sm text-right font-semibold">{{ fmt(r.sale_price_rub) }} &#8381;</td>
                  <td :class="['px-3 py-2 text-sm text-right', marginClass(r.profit_rub)]">{{ fmt(r.profit_rub) }} &#8381;</td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
        <!-- Show breakdown from first result -->
        <template v-if="calcResult.margin_results![0]?.breakdown">
          <div class="mt-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg space-y-1 text-sm">
            <div class="text-xs uppercase font-semibold text-slate-400 mb-2">Раскладка затрат на единицу</div>
            <div class="flex justify-between" v-if="calcResult.margin_results![0].breakdown!.cogs_rub != null">
              <span class="text-slate-500 dark:text-slate-400">Себестоимость</span>
              <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.margin_results![0].breakdown!.cogs_rub) }} &#8381;</span>
            </div>
            <div class="flex justify-between" v-if="calcResult.margin_results![0].breakdown!.commission_rub != null">
              <span class="text-slate-500 dark:text-slate-400">
                Комиссия Ozon<template v-if="calcResult.margin_results![0].breakdown!.commission_pct != null"> ({{ calcResult.margin_results![0].breakdown!.commission_pct.toFixed(1) }}%)</template>
              </span>
              <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.margin_results![0].breakdown!.commission_rub) }} &#8381;</span>
            </div>
            <div class="flex justify-between" v-if="calcResult.margin_results![0].breakdown!.acquiring_rub != null">
              <span class="text-slate-500 dark:text-slate-400">Эквайринг</span>
              <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.margin_results![0].breakdown!.acquiring_rub) }} &#8381;</span>
            </div>
            <div class="flex justify-between" v-if="calcResult.margin_results![0].breakdown!.last_mile_rub != null">
              <span class="text-slate-500 dark:text-slate-400">Последняя миля</span>
              <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.margin_results![0].breakdown!.last_mile_rub) }} &#8381;</span>
            </div>
            <div class="flex justify-between" v-if="calcResult.margin_results![0].breakdown!.storage_rub != null">
              <span class="text-slate-500 dark:text-slate-400">Хранение</span>
              <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.margin_results![0].breakdown!.storage_rub) }} &#8381;</span>
            </div>
            <div class="flex justify-between" v-if="calcResult.margin_results![0].breakdown!.return_cost_rub != null">
              <span class="text-slate-500 dark:text-slate-400">Возвраты</span>
              <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.margin_results![0].breakdown!.return_cost_rub) }} &#8381;</span>
            </div>
            <div class="flex justify-between" v-if="calcResult.margin_results![0].breakdown!.tax_rub != null">
              <span class="text-slate-500 dark:text-slate-400">Налог (УСН)</span>
              <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.margin_results![0].breakdown!.tax_rub) }} &#8381;</span>
            </div>
            <div class="border-t border-slate-200 dark:border-slate-700 pt-1 mt-1 flex justify-between font-semibold">
              <span>Итого затрат</span>
              <span>{{ fmtDec(calcResult.margin_results![0].breakdown!.total_costs) }} &#8381;</span>
            </div>
          </div>
        </template>
      </template>

      <!-- Single result -->
      <template v-else>
        <div class="space-y-4">
          <div class="flex items-baseline gap-3">
            <span class="text-2xl font-bold text-slate-800 dark:text-white">{{ fmt(singleSalePrice(calcResult)) }} &#8381;</span>
            <span :class="['text-sm font-semibold', marginClass(singleMargin(calcResult))]">
              маржа {{ singleMargin(calcResult).toFixed(1) }}%
            </span>
            <span class="text-sm text-slate-500">
              прибыль {{ fmt(calcResult.profit_rub || 0) }} &#8381;
            </span>
          </div>

          <!-- Breakdown -->
          <template v-if="calcResult.breakdown">
            <div class="mt-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg space-y-1 text-sm">
              <div class="text-xs uppercase font-semibold text-slate-400 mb-2">Раскладка затрат на единицу</div>
              <div class="flex justify-between" v-if="calcResult.breakdown.cogs_rub != null">
                <span class="text-slate-500 dark:text-slate-400">Себестоимость</span>
                <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.breakdown.cogs_rub) }} &#8381;</span>
              </div>
              <div class="flex justify-between" v-if="calcResult.breakdown.commission_rub != null">
                <span class="text-slate-500 dark:text-slate-400">
                  Комиссия Ozon<template v-if="calcResult.breakdown.commission_pct != null"> ({{ calcResult.breakdown.commission_pct.toFixed(1) }}%)</template>
                </span>
                <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.breakdown.commission_rub) }} &#8381;</span>
              </div>
              <div class="flex justify-between" v-if="calcResult.breakdown.acquiring_rub != null">
                <span class="text-slate-500 dark:text-slate-400">Эквайринг</span>
                <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.breakdown.acquiring_rub) }} &#8381;</span>
              </div>
              <div class="flex justify-between" v-if="calcResult.breakdown.last_mile_rub != null">
                <span class="text-slate-500 dark:text-slate-400">Последняя миля</span>
                <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.breakdown.last_mile_rub) }} &#8381;</span>
              </div>
              <div class="flex justify-between" v-if="calcResult.breakdown.storage_rub != null">
                <span class="text-slate-500 dark:text-slate-400">Хранение</span>
                <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.breakdown.storage_rub) }} &#8381;</span>
              </div>
              <div class="flex justify-between" v-if="calcResult.breakdown.return_cost_rub != null">
                <span class="text-slate-500 dark:text-slate-400">Возвраты</span>
                <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.breakdown.return_cost_rub) }} &#8381;</span>
              </div>
              <div class="flex justify-between" v-if="calcResult.breakdown.tax_rub != null">
                <span class="text-slate-500 dark:text-slate-400">Налог (УСН)</span>
                <span class="text-slate-800 dark:text-slate-200">{{ fmtDec(calcResult.breakdown.tax_rub) }} &#8381;</span>
              </div>
              <div class="border-t border-slate-200 dark:border-slate-700 pt-1 mt-1 flex justify-between font-semibold">
                <span>Итого затрат</span>
                <span>{{ fmtDec(calcResult.breakdown.total_costs) }} &#8381;</span>
              </div>
            </div>
          </template>

          <div v-if="calcResult.breakeven_price_rub" class="text-xs text-slate-400 mt-2">
            Цена безубытка: {{ fmt(calcResult.breakeven_price_rub) }} &#8381;
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
