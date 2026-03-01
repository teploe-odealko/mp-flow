<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

const settingsStore = useSettingsStore()
const ui = useUiStore()

const ozonClientId = ref('')
const ozonApiKey = ref('')
const usnRateInput = ref('7')
const savingOzon = ref(false)
const clearingOzon = ref(false)
const savingUsn = ref(false)

onMounted(async () => {
  // Load settings
  if (!settingsStore.settingsLoaded) {
    try {
      await settingsStore.loadSettings()
    } catch { /* ignore */ }
  }
  usnRateInput.value = String(settingsStore.usnRate)

  // Load Ozon integration status
  if (!settingsStore.ozonLoaded) {
    try {
      await settingsStore.loadOzonIntegration()
    } catch { /* ignore */ }
  }
})

async function saveOzonCredentials() {
  const clientId = ozonClientId.value.trim()
  const apiKey = ozonApiKey.value.trim()
  if (!clientId && !apiKey) {
    ui.addToast('Введите Client ID и API Key', 'error')
    return
  }
  savingOzon.value = true
  try {
    await settingsStore.saveOzonCredentials(clientId, apiKey)
    ui.addToast('Креды Ozon сохранены', 'success')
    ozonClientId.value = ''
    ozonApiKey.value = ''
  } catch (e: any) {
    ui.addToast('Ошибка: ' + (e.message || ''), 'error')
  } finally {
    savingOzon.value = false
  }
}

async function clearOzonCredentials() {
  if (!confirm('Удалить креды Ozon? Синхронизация перестанет работать.')) return
  clearingOzon.value = true
  try {
    await settingsStore.clearOzonCredentials()
    ui.addToast('Креды Ozon удалены')
  } catch (e: any) {
    ui.addToast('Ошибка: ' + (e.message || ''), 'error')
  } finally {
    clearingOzon.value = false
  }
}

async function saveUsnRate() {
  const rate = parseFloat(usnRateInput.value)
  if (isNaN(rate) || rate < 0 || rate > 100) {
    ui.addToast('Укажите ставку от 0 до 100', 'error')
    return
  }
  savingUsn.value = true
  try {
    await settingsStore.saveUsnRate(rate)
    ui.addToast('Ставка сохранена')
  } catch (e: any) {
    ui.addToast('Ошибка: ' + (e.message || ''), 'error')
  } finally {
    savingUsn.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Ozon Integration -->
    <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
      <div class="flex items-center gap-3 mb-4">
        <h3 class="text-base font-semibold text-slate-900 dark:text-white">Интеграция с Ozon</h3>
        <span
          v-if="settingsStore.ozonCredentials?.has_credentials"
          class="inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
        >
          Подключено
        </span>
        <span
          v-else-if="settingsStore.ozonLoaded"
          class="inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        >
          Не настроено
        </span>
      </div>

      <!-- Current credentials info -->
      <div v-if="settingsStore.ozonCredentials?.has_credentials" class="mb-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm text-slate-600 dark:text-slate-400">
        Креды: {{ settingsStore.ozonCredentials.client_id_masked || 'client_id' }}, {{ settingsStore.ozonCredentials.api_key_masked || 'api_key' }}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Client ID</label>
          <input
            v-model="ozonClientId"
            type="text"
            class="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
            :placeholder="settingsStore.ozonCredentials?.client_id_masked || 'Введите Client ID'"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">API Key</label>
          <input
            v-model="ozonApiKey"
            type="text"
            class="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
            :placeholder="settingsStore.ozonCredentials?.api_key_masked || 'Введите API Key'"
          />
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button
          class="px-4 py-2 text-sm font-medium text-white bg-sky-500 hover:bg-sky-600 rounded-lg transition-colors disabled:opacity-50"
          :disabled="savingOzon"
          @click="saveOzonCredentials"
        >
          {{ savingOzon ? 'Сохранение...' : 'Сохранить' }}
        </button>
        <button
          v-if="settingsStore.ozonCredentials?.has_credentials"
          class="px-4 py-2 text-sm font-medium text-red-500 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors disabled:opacity-50"
          :disabled="clearingOzon"
          @click="clearOzonCredentials"
        >
          {{ clearingOzon ? 'Удаление...' : 'Удалить креды' }}
        </button>
      </div>
    </div>

    <!-- USN Tax Rate -->
    <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
      <h3 class="text-base font-semibold text-slate-900 dark:text-white mb-4">Налоговые настройки</h3>
      <div class="flex items-end gap-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Ставка УСН (%)</label>
          <input
            v-model="usnRateInput"
            type="number"
            min="0"
            max="100"
            step="0.1"
            class="w-32 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
          />
        </div>
        <button
          class="px-4 py-2 text-sm font-medium text-white bg-sky-500 hover:bg-sky-600 rounded-lg transition-colors disabled:opacity-50"
          :disabled="savingUsn"
          @click="saveUsnRate"
        >
          {{ savingUsn ? 'Сохранение...' : 'Сохранить' }}
        </button>
      </div>
    </div>
  </div>
</template>
