import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { apiRequest } from '@/composables/useApi'

export interface PluginCardTab {
  id: string
  label: string
}

export interface PluginManifest {
  name: string
  title: string
  version: string
  description: string
  frontend?: {
    main: string
  }
  contributes?: {
    cardTabs?: PluginCardTab[]
  }
  provides_kinds?: string[]
}

export interface CardTabContribution {
  id: string
  label: string
  pluginName: string
  renderFn: ((pane: HTMLElement, cardDetail: any) => Promise<void> | void) | null
}

const DISABLED_PLUGINS_KEY = '_mpflow_disabled_plugins'

function getDisabledPlugins(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISABLED_PLUGINS_KEY) || '[]')
  } catch {
    return []
  }
}

function saveDisabledPlugins(disabled: string[]) {
  localStorage.setItem(DISABLED_PLUGINS_KEY, JSON.stringify(disabled))
}

export const usePluginsStore = defineStore('plugins', () => {
  const manifests = ref<PluginManifest[]>([])
  const contributions = reactive<{ cardTabs: CardTabContribution[] }>({
    cardTabs: [],
  })
  const disabledPlugins = ref<string[]>(getDisabledPlugins())
  const loadedModules = ref<Record<string, any>>({})

  async function loadPlugins() {
    try {
      const data = await apiRequest<{ plugins: PluginManifest[] }>('/plugins')
      const plugins = data?.plugins || []
      manifests.value = plugins

      // Build card tab contributions from non-disabled plugins
      const disabled = disabledPlugins.value
      contributions.cardTabs = []

      plugins
        .filter((p) => !disabled.includes(p.name))
        .forEach((p) => {
          ;(p.contributes?.cardTabs || []).forEach((tab) => {
            if (!contributions.cardTabs.find((t) => t.id === tab.id)) {
              contributions.cardTabs.push({
                id: tab.id,
                label: tab.label,
                pluginName: p.name,
                renderFn: null,
              })
            }
          })
        })

      console.log(
        '[plugins] Loaded',
        plugins.length,
        'plugin(s):',
        plugins.map((p) => p.name).join(', '),
      )
    } catch (e: any) {
      console.warn('[plugins] Failed to load plugins:', e.message)
    }
  }

  async function activatePlugin(pluginName: string) {
    if (loadedModules.value[pluginName]) return

    const manifest = manifests.value.find((p) => p.name === pluginName)
    if (!manifest?.frontend?.main) return

    try {
      const url = `./plugins/${pluginName}/${manifest.frontend.main}`
      const mod = await import(/* @vite-ignore */ url)
      loadedModules.value[pluginName] = mod

      if (mod.activate) {
        // Provide the PluginHost API to the plugin
        mod.activate({
          apiRequest,
          showToast: (msg: string, type?: string) => {
            // Will be replaced by proper toast composable in Vue migration
            console.log(`[plugin toast] ${type || 'info'}: ${msg}`)
          },
          getCardDetail: () => null, // Will be wired to card-detail store
          registerCardTabRenderer(
            tabId: string,
            renderFn: (pane: HTMLElement, detail: any) => void,
          ) {
            const existing = contributions.cardTabs.find(
              (t) => t.id === tabId,
            )
            if (existing) existing.renderFn = renderFn
          },
        })
      }

      console.log('[plugins] Activated plugin:', pluginName)
    } catch (e: any) {
      console.error(
        '[plugins] Failed to activate',
        pluginName,
        ':',
        e,
      )
    }
  }

  function togglePlugin(name: string, enabled: boolean) {
    const disabled = [...disabledPlugins.value]
    if (enabled) {
      const idx = disabled.indexOf(name)
      if (idx !== -1) disabled.splice(idx, 1)
    } else {
      if (!disabled.includes(name)) disabled.push(name)
    }
    disabledPlugins.value = disabled
    saveDisabledPlugins(disabled)
  }

  function isPluginEnabled(name: string): boolean {
    return !disabledPlugins.value.includes(name)
  }

  function getCardTabRenderer(
    tabId: string,
  ): CardTabContribution | undefined {
    return contributions.cardTabs.find((t) => t.id === tabId)
  }

  return {
    manifests,
    contributions,
    disabledPlugins,
    loadedModules,
    loadPlugins,
    activatePlugin,
    togglePlugin,
    isPluginEnabled,
    getCardTabRenderer,
  }
})
