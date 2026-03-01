import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { apiRequest } from '@/composables/useApi'
import { SYNC_REGISTRY, SECTION_SYNC_MAP } from '@/components/sync/sync-registry'

export const useSyncStore = defineStore('sync', () => {
  const syncFreshness = ref<Record<string, string>>({})
  const syncRunning = reactive<Record<string, boolean>>({})
  const syncAllRunning = ref(false)
  const syncLoaded = ref(false)

  async function loadSyncFreshness() {
    try {
      const data = await apiRequest<{ sync_types: Record<string, string> }>(
        '/ozon/sync/freshness',
      )
      syncFreshness.value = data.sync_types || {}
    } catch {
      syncFreshness.value = {}
    }
  }

  async function runSync(syncKey: string, body?: Record<string, any>) {
    const sync = SYNC_REGISTRY.find((s) => s.key === syncKey)
    if (!sync) return
    syncRunning[syncKey] = true
    try {
      await apiRequest(sync.endpoint, {
        method: 'POST',
        body: body || sync.body,
      })
      await loadSyncFreshness()
    } finally {
      syncRunning[syncKey] = false
    }
  }

  async function runAllSync(
    onProgress?: (index: number, total: number, label: string) => void,
  ): Promise<{ ok: number; fail: number }> {
    if (syncAllRunning.value) return { ok: 0, fail: 0 }
    syncAllRunning.value = true
    const total = SYNC_REGISTRY.length
    let ok = 0
    let fail = 0

    for (let i = 0; i < total; i++) {
      const sync = SYNC_REGISTRY[i]
      onProgress?.(i + 1, total, sync.label)
      try {
        await apiRequest(sync.endpoint, {
          method: 'POST',
          body: sync.body,
        })
        ok++
      } catch {
        fail++
      }
      await loadSyncFreshness()
    }

    syncAllRunning.value = false
    return { ok, fail }
  }

  /** Get the oldest sync timestamp for a set of sync type keys */
  function getOldestFreshness(syncKeys: string[]): string | null {
    const fr = syncFreshness.value
    let oldest: string | null = null
    for (const key of syncKeys) {
      const ts = fr[key]
      if (!ts) return null // if any key has no data, return null
      if (!oldest || ts < oldest) oldest = ts
    }
    return oldest
  }

  /** Compute sync status color based on timestamp age */
  function syncStatusColor(isoStr: string | null): 'green' | 'yellow' | 'red' {
    if (!isoStr) return 'red'
    const diffH = (Date.now() - new Date(isoStr).getTime()) / 3600000
    if (diffH < 1) return 'green'
    if (diffH < 24) return 'yellow'
    return 'red'
  }

  /** Format a freshness timestamp as a human-readable relative string */
  function formatFreshness(isoStr: string | null): string | null {
    if (!isoStr) return null
    const d = new Date(isoStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'только что'
    if (diffMin < 60) return `${diffMin} мин. назад`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH} ч. назад`
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${dd}.${mm} ${hh}:${mi}`
  }

  /** Returns freshness color for a section by looking up its sync keys */
  function sectionFreshnessColor(
    sectionKey: string,
  ): 'green' | 'yellow' | 'red' | null {
    const syncKeys = SECTION_SYNC_MAP[sectionKey]
    if (!syncKeys?.length) return null
    const oldest = getOldestFreshness(syncKeys)
    return syncStatusColor(oldest)
  }

  return {
    syncFreshness,
    syncRunning,
    syncAllRunning,
    syncLoaded,
    loadSyncFreshness,
    runSync,
    runAllSync,
    getOldestFreshness,
    syncStatusColor,
    formatFreshness,
    sectionFreshnessColor,
  }
})
