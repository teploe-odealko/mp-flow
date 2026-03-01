<script setup lang="ts">
import { onMounted } from 'vue'
import { useSyncStore } from '@/stores/sync'
import { useUiStore } from '@/stores/ui'
import { SYNC_REGISTRY, SYNC_GROUPS } from './sync-registry'

const syncStore = useSyncStore()
const uiStore = useUiStore()

onMounted(async () => {
  if (!syncStore.syncLoaded) {
    syncStore.syncLoaded = true
    await syncStore.loadSyncFreshness()
  }
})

function timeLabel(key: string): string {
  const ts = syncStore.syncFreshness[key]
  if (!ts) return 'Нет данных'
  return syncStore.formatFreshness(ts) || 'Нет данных'
}

function dotClass(key: string): string {
  const ts = syncStore.syncFreshness[key]
  const color = syncStore.syncStatusColor(ts || null)
  const map: Record<string, string> = { green: 'bg-emerald-500', yellow: 'bg-amber-400', red: 'bg-red-400' }
  return map[color] || 'bg-red-400'
}

async function handleSync(key: string) {
  try {
    await syncStore.runSync(key)
    uiStore.addToast('Синхронизация завершена', 'success')
  } catch (e: any) {
    uiStore.addToast(e.message || 'Ошибка синхронизации', 'error')
  }
}

async function handleSyncAll() {
  const { ok, fail } = await syncStore.runAllSync()
  if (fail === 0) {
    uiStore.addToast(`Все ${ok} синхронизаций выполнены`, 'success')
  } else {
    uiStore.addToast(`Выполнено: ${ok}, ошибок: ${fail}`, 'error')
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Sync All button -->
    <div class="flex justify-end">
      <button
        class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-500 rounded-lg hover:bg-sky-600 transition-colors disabled:opacity-50"
        :disabled="syncStore.syncAllRunning"
        @click="handleSyncAll"
      >
        <svg class="w-4 h-4" :class="{ 'animate-spin': syncStore.syncAllRunning }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {{ syncStore.syncAllRunning ? 'Синхронизация...' : 'Синхронизировать все' }}
      </button>
    </div>

    <!-- Sync groups -->
    <div v-for="group in SYNC_GROUPS" :key="group.key" class="space-y-2">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
        {{ group.label }}
      </h3>
      <div
        v-for="sync in SYNC_REGISTRY.filter((s) => s.group === group.key)"
        :key="sync.key"
        class="flex items-center gap-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3"
        :title="`API: ${sync.api}\nБД: ${sync.db}`"
      >
        <span class="w-2 h-2 rounded-full flex-shrink-0" :class="dotClass(sync.key)" />
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-slate-800 dark:text-slate-200">{{ sync.label }}</div>
          <div class="text-xs text-slate-400">{{ sync.desc }}</div>
        </div>
        <span class="text-xs text-slate-400 whitespace-nowrap">{{ timeLabel(sync.key) }}</span>
        <button
          class="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-sky-500 dark:text-sky-400 border border-sky-200 dark:border-sky-800 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950 transition-colors disabled:opacity-50"
          :disabled="!!syncStore.syncRunning[sync.key]"
          @click="handleSync(sync.key)"
        >
          <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': syncStore.syncRunning[sync.key] }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Синк
        </button>
      </div>
    </div>
  </div>
</template>
