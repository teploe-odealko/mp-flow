<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { useSyncStore } from '@/stores/sync'
import { SECTION_SYNC_MAP } from '@/components/sync/sync-registry'

const route = useRoute()
const authStore = useAuthStore()
const uiStore = useUiStore()
const syncStore = useSyncStore()

interface MenuItem {
  id: string
  label: string
  route: string
  icon: string
}

const menuItems: MenuItem[] = [
  { id: 'catalog', label: 'Каталог', route: '/catalog', icon: 'catalog' },
  { id: 'orders', label: 'Закупки', route: '/orders', icon: 'orders' },
  { id: 'analytics', label: 'Аналитика', route: '/analytics', icon: 'analytics' },
  { id: 'demand', label: 'Планирование', route: '/demand', icon: 'demand' },
  { id: 'logistics', label: 'Логистика', route: '/logistics', icon: 'logistics' },
  { id: 'finance', label: 'Финансы', route: '/finance', icon: 'finance' },
  { id: 'prices', label: 'Цены', route: '/prices', icon: 'prices' },
  { id: 'promo', label: 'Продвижение', route: '/promo', icon: 'promo' },
  { id: 'sync', label: 'Синхронизация', route: '/sync', icon: 'sync' },
  { id: 'mcp', label: 'MCP', route: '/mcp', icon: 'mcp' },
  { id: 'plugins', label: 'Плагины', route: '/plugins', icon: 'plugins' },
  { id: 'settings', label: 'Настройки', route: '/settings', icon: 'settings' },
]

function isActive(item: MenuItem): boolean {
  if (route.path === item.route) return true
  if (item.route === '/catalog' && route.path.startsWith('/card/')) return true
  return false
}

function hasFreshnessDot(id: string): string | null {
  return SECTION_SYNC_MAP[id] ? syncStore.sectionFreshnessColor(id) : null
}

const dotColorClass: Record<string, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  red: 'bg-red-400',
}

const userDisplay = computed(() => authStore.displayName)

function handleLogout() {
  authStore.logout()
}
</script>

<template>
  <aside
    class="hidden lg:flex flex-col w-60 bg-slate-900 text-slate-300 fixed inset-y-0 left-0 z-40 overflow-y-auto"
  >
    <!-- Logo -->
    <div class="flex items-center gap-2.5 px-4 py-5 border-b border-slate-800">
      <img src="/logo.png" alt="MPFlow" class="w-8 h-8 rounded-lg" />
      <span class="text-lg font-bold text-white tracking-tight">MPFlow</span>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
      <router-link
        v-for="item in menuItems"
        :key="item.id"
        :to="item.route"
        class="menu-item"
        :class="{ active: isActive(item) }"
      >
        <!-- Icons -->
        <svg v-if="item.icon === 'catalog'" class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
        <svg v-else-if="item.icon === 'orders'" class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>
        <svg v-else-if="item.icon === 'analytics'" class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
        <svg v-else-if="item.icon === 'demand'" class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        <svg v-else-if="item.icon === 'logistics'" class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7h12l-4 9H8l-4-9h4m0 0L2 3m6 4v10m4-10v10m4-10l2 10"/></svg>
        <svg v-else-if="item.icon === 'finance'" class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <svg v-else-if="item.icon === 'prices'" class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"/></svg>
        <svg v-else-if="item.icon === 'promo'" class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/></svg>
        <svg v-else-if="item.icon === 'sync'" class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
        <svg v-else-if="item.icon === 'mcp'" class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
        <svg v-else-if="item.icon === 'plugins'" class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h2a2 2 0 002-2v-2a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2z"/></svg>
        <svg v-else-if="item.icon === 'settings'" class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>

        <span class="truncate">{{ item.label }}</span>

        <!-- Freshness dot -->
        <span
          v-if="hasFreshnessDot(item.id)"
          class="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0"
          :class="dotColorClass[hasFreshnessDot(item.id)!]"
        />
      </router-link>
    </nav>

    <!-- Bottom: user + theme + logout -->
    <div class="border-t border-slate-800 px-4 py-3 space-y-2">
      <div class="text-xs text-slate-400 truncate">{{ userDisplay }}</div>
      <div class="flex items-center gap-2">
        <!-- Theme toggle -->
        <button
          class="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          title="Переключить тему"
          @click="uiStore.toggleTheme()"
        >
          <!-- Sun icon (shown when dark) -->
          <svg v-if="uiStore.theme === 'dark'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
          <!-- Moon icon (shown when light) -->
          <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
        </button>

        <!-- Logout -->
        <button
          class="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
          title="Выйти"
          @click="handleLogout"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
        </button>
      </div>
    </div>
  </aside>
</template>
