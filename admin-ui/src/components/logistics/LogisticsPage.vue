<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useLogisticsStore } from '@/stores/logistics'
import MatrixTab from '@/components/logistics/MatrixTab.vue'
import SuppliesTab from '@/components/logistics/SuppliesTab.vue'

const logisticsStore = useLogisticsStore()
const activeTab = ref<'matrixView' | 'suppliesView'>('matrixView')

onMounted(() => {
  logisticsStore.loadMatrix()
})

function switchTab(tab: 'matrixView' | 'suppliesView') {
  activeTab.value = tab
  if (tab === 'suppliesView' && logisticsStore.suppliesData === null) {
    logisticsStore.loadSupplies()
  }
}

function tabClass(tab: string): string {
  const isActive = activeTab.value === tab
  return [
    'px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer',
    isActive
      ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
      : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
  ].join(' ')
}
</script>

<template>
  <div class="space-y-4">
    <!-- Tab switcher -->
    <div class="flex gap-0 border-b border-slate-200 dark:border-slate-700">
      <button :class="tabClass('matrixView')" @click="switchTab('matrixView')">
        Где сейчас товар
      </button>
      <button :class="tabClass('suppliesView')" @click="switchTab('suppliesView')">
        Поставки на Ozon
      </button>
    </div>

    <!-- Tab content -->
    <MatrixTab v-show="activeTab === 'matrixView'" />
    <SuppliesTab v-show="activeTab === 'suppliesView'" />
  </div>
</template>
