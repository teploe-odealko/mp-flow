<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettingsStore, type ApiKey } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import BaseModal from '@/components/shared/BaseModal.vue'

const settingsStore = useSettingsStore()
const ui = useUiStore()

const MCP_SERVER_URL = 'https://proxy.mp-flow.ru/mcp/'

const activeSnippetTab = ref<'claude' | 'cursor' | 'chatgpt' | 'curl'>('claude')
const showCreateKeyModal = ref(false)
const showKeyModal = ref(false)
const newKeyName = ref('')
const createdRawKey = ref('')
const creatingKey = ref(false)

onMounted(async () => {
  try {
    await settingsStore.loadApiKeys()
  } catch { /* ignore */ }
})

// Currently selected key for snippets
const selectedApiKey = ref<string | null>(null)

function snippetKey(): string {
  return selectedApiKey.value || createdRawKey.value || '<YOUR_API_KEY>'
}

function claudeSnippet(): string {
  const key = snippetKey()
  return `claude mcp add \\\n  --transport http \\\n  --header "Authorization: Bearer ${key}" \\\n  -s user \\\n  mpflow-erp \\\n  "${MCP_SERVER_URL}"`
}

function cursorSnippet(): string {
  const key = snippetKey()
  return JSON.stringify({
    mcpServers: {
      'mpflow-erp': {
        type: 'http',
        url: MCP_SERVER_URL,
        headers: { Authorization: `Bearer ${key}` },
      },
    },
  }, null, 2)
}

function curlSnippet(): string {
  const key = snippetKey()
  return `curl -X POST ${MCP_SERVER_URL} \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`
}

function chatgptSnippet(): string {
  const key = snippetKey()
  return JSON.stringify({
    type: 'mcp',
    server_label: 'mpflow-erp',
    server_url: MCP_SERVER_URL,
    headers: { Authorization: `Bearer ${key}` },
  }, null, 2)
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ui.addToast('Скопировано')
  } catch {
    ui.addToast('Не удалось скопировать', 'error')
  }
}

async function createApiKey() {
  const name = newKeyName.value.trim()
  if (!name) return
  creatingKey.value = true
  try {
    const data = await settingsStore.createApiKey(name)
    createdRawKey.value = data.raw_key
    selectedApiKey.value = data.raw_key
    showCreateKeyModal.value = false
    showKeyModal.value = true
    newKeyName.value = ''
  } catch (e: any) {
    ui.addToast('Ошибка: ' + (e.message || ''), 'error')
  } finally {
    creatingKey.value = false
  }
}

async function revokeKey(id: string) {
  if (!confirm('Отозвать этот ключ? Он перестанет работать.')) return
  try {
    await settingsStore.revokeApiKey(id)
    ui.addToast('Ключ отозван')
  } catch (e: any) {
    ui.addToast('Ошибка: ' + (e.message || ''), 'error')
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function snippetTabClass(tab: string): string {
  const isActive = activeSnippetTab.value === tab
  return [
    'px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer',
    isActive
      ? 'border-sky-500 text-sky-500 dark:text-sky-400 dark:border-sky-400'
      : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
  ].join(' ')
}
</script>

<template>
  <div class="space-y-6">
    <!-- MCP Server URL -->
    <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
      <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">MCP Server URL</h3>
      <div class="flex items-center gap-3">
        <code class="flex-1 text-sm font-mono text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 select-all">
          {{ MCP_SERVER_URL }}
        </code>
        <button
          class="px-4 py-2 text-sm font-medium text-sky-500 border border-sky-200 dark:border-sky-800 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950 transition-colors"
          @click="copyText(MCP_SERVER_URL)"
        >
          Копировать
        </button>
      </div>
    </div>

    <!-- API Keys -->
    <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-300">API ключи</h3>
        <button
          class="px-4 py-2 text-sm font-medium text-white bg-sky-500 hover:bg-sky-600 rounded-lg transition-colors"
          @click="showCreateKeyModal = true"
        >
          Создать ключ
        </button>
      </div>

      <div v-if="settingsStore.apiKeys.length" class="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-slate-50 dark:bg-slate-800/50">
              <th class="text-left px-4 py-3 text-xs font-semibold text-slate-500">Название</th>
              <th class="text-left px-4 py-3 text-xs font-semibold text-slate-500">Ключ</th>
              <th class="text-left px-4 py-3 text-xs font-semibold text-slate-500">Создан</th>
              <th class="text-left px-4 py-3 text-xs font-semibold text-slate-500">Использован</th>
              <th class="text-right px-4 py-3 text-xs font-semibold text-slate-500"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
            <tr v-for="k in settingsStore.apiKeys" :key="k.id" class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <td class="px-4 py-3 text-sm text-slate-800 dark:text-slate-200 font-medium">{{ k.name }}</td>
              <td class="px-4 py-3 text-sm text-slate-500 font-mono">{{ k.key_prefix }}...</td>
              <td class="px-4 py-3 text-sm text-slate-500">{{ fmtDate(k.created_at) }}</td>
              <td class="px-4 py-3 text-sm text-slate-500">
                {{ k.last_used_at ? fmtDate(k.last_used_at) : '\u2014' }}
              </td>
              <td class="px-4 py-3 text-right">
                <button
                  class="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                  @click="revokeKey(k.id)"
                >
                  Отозвать
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="text-sm text-slate-400 py-4 text-center">
        Нет активных API ключей. Создайте ключ для подключения MCP клиентов.
      </div>
    </div>

    <!-- Connection snippets -->
    <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
      <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Подключение</h3>

      <!-- Tabs -->
      <div class="flex gap-0 border-b border-slate-200 dark:border-slate-700 mb-4">
        <button :class="snippetTabClass('claude')" @click="activeSnippetTab = 'claude'">Claude Code</button>
        <button :class="snippetTabClass('cursor')" @click="activeSnippetTab = 'cursor'">Cursor</button>
        <button :class="snippetTabClass('chatgpt')" @click="activeSnippetTab = 'chatgpt'">ChatGPT</button>
        <button :class="snippetTabClass('curl')" @click="activeSnippetTab = 'curl'">cURL</button>
      </div>

      <!-- Claude Code snippet -->
      <div v-show="activeSnippetTab === 'claude'" class="relative">
        <pre class="text-sm font-mono text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto whitespace-pre-wrap">{{ claudeSnippet() }}</pre>
        <button
          class="absolute top-2 right-2 px-2 py-1 text-xs text-sky-500 hover:text-sky-700 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded transition-colors"
          @click="copyText(claudeSnippet())"
        >
          Копировать
        </button>
      </div>

      <!-- Cursor snippet -->
      <div v-show="activeSnippetTab === 'cursor'" class="relative">
        <pre class="text-sm font-mono text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto whitespace-pre-wrap">{{ cursorSnippet() }}</pre>
        <button
          class="absolute top-2 right-2 px-2 py-1 text-xs text-sky-500 hover:text-sky-700 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded transition-colors"
          @click="copyText(cursorSnippet())"
        >
          Копировать
        </button>
      </div>

      <!-- ChatGPT snippet -->
      <div v-show="activeSnippetTab === 'chatgpt'" class="relative">
        <pre class="text-sm font-mono text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto whitespace-pre-wrap">{{ chatgptSnippet() }}</pre>
        <button
          class="absolute top-2 right-2 px-2 py-1 text-xs text-sky-500 hover:text-sky-700 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded transition-colors"
          @click="copyText(chatgptSnippet())"
        >
          Копировать
        </button>
      </div>

      <!-- cURL snippet -->
      <div v-show="activeSnippetTab === 'curl'" class="relative">
        <pre class="text-sm font-mono text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto whitespace-pre-wrap">{{ curlSnippet() }}</pre>
        <button
          class="absolute top-2 right-2 px-2 py-1 text-xs text-sky-500 hover:text-sky-700 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded transition-colors"
          @click="copyText(curlSnippet())"
        >
          Копировать
        </button>
      </div>
    </div>

    <!-- Create API Key Modal -->
    <BaseModal :open="showCreateKeyModal" max-width="400px" @close="showCreateKeyModal = false">
      <div class="p-6 space-y-4">
        <h3 class="text-lg font-semibold text-slate-900 dark:text-white">Создать API ключ</h3>
        <form @submit.prevent="createApiKey">
          <div class="mb-4">
            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Название</label>
            <input
              v-model="newKeyName"
              type="text"
              required
              autofocus
              class="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
              placeholder="Например: Claude Code"
            />
          </div>
          <div class="flex justify-end gap-3">
            <button
              type="button"
              class="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              @click="showCreateKeyModal = false"
            >
              Отмена
            </button>
            <button
              type="submit"
              :disabled="creatingKey || !newKeyName.trim()"
              class="px-4 py-2 text-sm font-medium text-white bg-sky-500 hover:bg-sky-600 rounded-lg transition-colors disabled:opacity-50"
            >
              {{ creatingKey ? 'Создание...' : 'Создать' }}
            </button>
          </div>
        </form>
      </div>
    </BaseModal>

    <!-- Show Created API Key Modal -->
    <BaseModal :open="showKeyModal" max-width="500px" @close="showKeyModal = false">
      <div class="p-6 space-y-4">
        <h3 class="text-lg font-semibold text-slate-900 dark:text-white">API ключ создан</h3>
        <p class="text-sm text-slate-500">
          Скопируйте ключ сейчас. Он больше не будет показан.
        </p>
        <div class="flex items-center gap-2">
          <code class="flex-1 text-sm font-mono text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 select-all break-all">
            {{ createdRawKey }}
          </code>
          <button
            class="px-3 py-2 text-sm text-sky-500 border border-sky-200 dark:border-sky-800 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950 transition-colors"
            @click="copyText(createdRawKey)"
          >
            Копировать
          </button>
        </div>
        <div class="flex justify-end">
          <button
            class="px-4 py-2 text-sm font-medium text-white bg-sky-500 hover:bg-sky-600 rounded-lg transition-colors"
            @click="showKeyModal = false"
          >
            Готово
          </button>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
