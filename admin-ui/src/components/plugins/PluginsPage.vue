<script setup lang="ts">
import { onMounted } from 'vue'
import { usePluginsStore } from '@/stores/plugins'
import { useUiStore } from '@/stores/ui'

const pluginsStore = usePluginsStore()
const ui = useUiStore()

onMounted(async () => {
  if (!pluginsStore.manifests.length) {
    try {
      await pluginsStore.loadPlugins()
    } catch { /* ignore */ }
  }
})

function onTogglePlugin(name: string, checked: boolean) {
  pluginsStore.togglePlugin(name, checked)
  ui.addToast(
    checked
      ? `Плагин "${name}" включён`
      : `Плагин "${name}" отключён. Перезагрузите для применения.`,
  )
}
</script>

<template>
  <div class="space-y-4">
    <template v-if="pluginsStore.manifests.length">
      <div class="grid gap-4">
        <div
          v-for="p in pluginsStore.manifests"
          :key="p.name"
          class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm"
        >
          <div class="flex items-center justify-between gap-4">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <h3 class="text-base font-semibold text-slate-900 dark:text-white">
                  {{ p.title || p.name }}
                </h3>
                <span class="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                  {{ p.version || '' }}
                </span>
              </div>
              <p class="text-sm text-slate-500 mt-1">{{ p.description || '' }}</p>
              <p
                v-if="p.contributes?.cardTabs?.length"
                class="text-xs text-slate-400 mt-2"
              >
                Card tabs: {{ p.contributes.cardTabs.map((t) => t.label).join(', ') }}
              </p>
              <p
                v-if="p.provides_kinds?.length"
                class="text-xs text-slate-400 mt-1"
              >
                Provides: {{ p.provides_kinds.join(', ') }}
              </p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                class="sr-only peer"
                :checked="pluginsStore.isPluginEnabled(p.name)"
                @change="onTogglePlugin(p.name, ($event.target as HTMLInputElement).checked)"
              />
              <div class="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500" />
            </label>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="text-center text-sm text-slate-400 py-8">
      Нет установленных плагинов
    </div>
  </div>
</template>
