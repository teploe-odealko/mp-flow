<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAnalyticsStore } from '@/stores/analytics'
import { apiRequest } from '@/utils/api'
import { useUiStore } from '@/stores/ui'
import UnitEconomicsTab from './UnitEconomicsTab.vue'
import StockValuationTab from './StockValuationTab.vue'

const store = useAnalyticsStore()
const ui = useUiStore()

const usnRate = ref(7)
const usnRateDirty = ref(false)
const savingUsn = ref(false)

onMounted(async () => {
  await loadSettings()
  await store.reloadAnalytics()
})

async function loadSettings() {
  try {
    const s = await apiRequest<{ usn_rate?: number }>('/settings')
    if (s.usn_rate != null) usnRate.value = s.usn_rate
  } catch { /* ignore */ }
}

function onUsnInput() {
  usnRateDirty.value = true
}

async function saveUsnRate() {
  const val = usnRate.value
  if (isNaN(val) || val < 0 || val > 100) return
  savingUsn.value = true
  try {
    await apiRequest('/settings', { method: 'PUT', body: { usn_rate: val } })
    usnRateDirty.value = false
    ui.addToast('Ставка УСН сохранена', 'success')
    await store.loadPnlOzon()
  } catch (err: any) {
    ui.addToast('Ошибка: ' + err.message, 'error')
  } finally {
    savingUsn.value = false
  }
}

function onDateChange() {
  store.reloadAnalytics()
}

async function onReload() {
  await store.reloadAnalytics()
}
</script>

<template>
  <div>
    <!-- Toolbar: tabs + date range + USN -->
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <!-- Tab switcher -->
      <div class="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <button
          class="px-4 py-1.5 text-sm font-medium transition-colors"
          :class="store.activeTab === 'economy'
            ? 'bg-sky-500 text-white'
            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'"
          @click="store.activeTab = 'economy'"
        >
          Юнит-экономика
        </button>
        <button
          class="px-4 py-1.5 text-sm font-medium transition-colors"
          :class="store.activeTab === 'stock'
            ? 'bg-sky-500 text-white'
            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'"
          @click="store.activeTab = 'stock'"
        >
          Стоимость остатков
        </button>
      </div>

      <!-- Date range -->
      <div class="flex items-center gap-2 text-sm">
        <span class="text-slate-500 text-xs">с</span>
        <input
          v-model="store.ueDateFrom"
          type="date"
          class="form-input w-36 py-1 text-sm"
          @change="onDateChange"
        />
        <span class="text-slate-500 text-xs">по</span>
        <input
          v-model="store.ueDateTo"
          type="date"
          class="form-input w-36 py-1 text-sm"
          @change="onDateChange"
        />
      </div>

      <!-- USN rate -->
      <div class="flex items-center gap-2">
        <label class="text-xs text-slate-500 whitespace-nowrap">УСН %</label>
        <input
          v-model.number="usnRate"
          type="number"
          min="0"
          max="100"
          step="0.1"
          class="form-input w-16 py-1 text-sm text-right"
          @input="onUsnInput"
        />
        <button
          v-if="usnRateDirty"
          class="px-3 py-1 rounded-lg bg-sky-500 text-white text-xs font-medium hover:bg-sky-600 transition-colors disabled:opacity-50"
          :disabled="savingUsn"
          @click="saveUsnRate"
        >
          Сохр.
        </button>
      </div>

      <!-- Reload button -->
      <button
        class="ml-auto ghost-btn flex items-center gap-1"
        @click="onReload"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Обновить
      </button>
    </div>

    <!-- Tab content -->
    <UnitEconomicsTab v-if="store.activeTab === 'economy'" />
    <StockValuationTab v-else />
  </div>
</template>
