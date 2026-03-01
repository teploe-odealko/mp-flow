<script setup lang="ts">
import { onMounted } from 'vue'
import { usePricesStore } from '@/stores/prices'
import PriceProductsTab from '@/components/prices/PriceProductsTab.vue'
import PriceCalculatorTab from '@/components/prices/PriceCalculatorTab.vue'

const pricesStore = usePricesStore()

onMounted(async () => {
  if (!pricesStore.pricesLoaded) {
    try {
      await pricesStore.loadPriceProducts()
    } catch { /* ignore */ }
  }
})

function switchTab(tab: 'priceProductsView' | 'priceCalcView') {
  pricesStore.activeTab = tab
  if (tab === 'priceCalcView' && pricesStore.calcCategories.length === 0) {
    pricesStore.loadCalcCategories().catch(() => {})
  }
}

function tabClass(tab: string): string {
  const isActive = pricesStore.activeTab === tab
  return [
    'px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer',
    isActive
      ? 'border-sky-500 text-sky-500 dark:text-sky-400 dark:border-sky-400'
      : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
  ].join(' ')
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex gap-0 border-b border-slate-200 dark:border-slate-700">
      <button :class="tabClass('priceProductsView')" @click="switchTab('priceProductsView')">Мои товары</button>
      <button :class="tabClass('priceCalcView')" @click="switchTab('priceCalcView')">Калькулятор</button>
    </div>
    <PriceProductsTab v-show="pricesStore.activeTab === 'priceProductsView'" />
    <PriceCalculatorTab v-show="pricesStore.activeTab === 'priceCalcView'" />
  </div>
</template>
