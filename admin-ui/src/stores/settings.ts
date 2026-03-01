import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiRequest } from '@/composables/useApi'

export interface ApiKey {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export interface OzonIntegration {
  has_credentials: boolean
  client_id_masked: string | null
  api_key_masked: string | null
}

export const useSettingsStore = defineStore('settings', () => {
  const usnRate = ref<number>(7)
  const apiKeys = ref<ApiKey[]>([])
  const ozonCredentials = ref<OzonIntegration | null>(null)
  const ozonLoaded = ref(false)
  const settingsLoaded = ref(false)

  async function loadAdminSettings() {
    try {
      const data = await apiRequest<{ usn_rate?: number }>('/settings')
      if (data.usn_rate != null) usnRate.value = data.usn_rate
    } catch (_) {
      /* ignore */
    }
  }

  async function saveUsnRate(rate: number) {
    if (isNaN(rate) || rate < 0 || rate > 100) return
    await apiRequest('/settings', {
      method: 'PUT',
      body: { usn_rate: rate },
    })
    usnRate.value = rate
  }

  async function loadOzonIntegration() {
    try {
      const data = await apiRequest<OzonIntegration>('/integrations/ozon')
      ozonCredentials.value = data
      ozonLoaded.value = true
    } catch (err: any) {
      ozonCredentials.value = null
      ozonLoaded.value = true
      throw err
    }
  }

  async function saveOzonCredentials(clientId: string, apiKey: string) {
    await apiRequest('/integrations/ozon', {
      method: 'PUT',
      body: { client_id: clientId, api_key: apiKey },
    })
    await loadOzonIntegration()
  }

  async function clearOzonCredentials() {
    await apiRequest('/integrations/ozon', { method: 'DELETE' })
    await loadOzonIntegration()
  }

  async function loadApiKeys() {
    try {
      const data = await apiRequest<{ items: ApiKey[] }>('/api-keys')
      // Filter out revoked keys
      apiKeys.value = (data.items || []).filter((k) => !k.revoked_at)
    } catch (_) {
      apiKeys.value = []
    }
  }

  async function createApiKey(
    name: string,
  ): Promise<{ raw_key: string; id: string }> {
    const data = await apiRequest<{ raw_key: string; id: string }>(
      '/api-keys',
      {
        method: 'POST',
        body: { name },
      },
    )
    await loadApiKeys()
    return data
  }

  async function revokeApiKey(id: string) {
    await apiRequest(`/api-keys/${id}`, { method: 'DELETE' })
    await loadApiKeys()
  }

  async function loadSettings() {
    settingsLoaded.value = true
    try {
      const data = await apiRequest<{ usn_rate?: number }>('/settings')
      if (data.usn_rate != null) usnRate.value = data.usn_rate
    } catch (e) {
      console.warn('Failed to load settings', e)
    }
  }

  return {
    usnRate,
    apiKeys,
    ozonCredentials,
    ozonLoaded,
    settingsLoaded,
    loadAdminSettings,
    saveUsnRate,
    loadOzonIntegration,
    saveOzonCredentials,
    clearOzonCredentials,
    loadApiKeys,
    createApiKey,
    revokeApiKey,
    loadSettings,
  }
})
