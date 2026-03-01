<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { useSyncStore } from '@/stores/sync'
import AppShell from '@/components/layout/AppShell.vue'
import LoginView from '@/components/auth/LoginView.vue'

const authStore = useAuthStore()
const uiStore = useUiStore()
const syncStore = useSyncStore()

onMounted(async () => {
  uiStore.initTheme()

  try {
    await authStore.waitForBoot()

    // If authenticated after boot, load initial data in parallel
    if (authStore.isAuthenticated) {
      await Promise.all([
        syncStore.loadSyncFreshness(),
      ]).catch((e) => console.warn('[boot] parallel load error:', e))
    }
  } catch (err) {
    console.error('[boot] Init error:', err)
  }
})
</script>

<template>
  <!-- State 1: Booting — show loading screen -->
  <div
    v-if="authStore.isBooting"
    class="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900"
  >
    <img src="/logo.png" alt="MPFlow" class="w-16 h-16 rounded-xl mb-4" />
    <svg
      class="w-8 h-8 animate-spin text-sky-400 mb-3"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
    <span class="text-lg font-bold text-white tracking-tight">MPFlow</span>
    <span class="text-sm text-slate-400 mt-1">Загрузка...</span>
  </div>

  <!-- State 2: Not authenticated — show login -->
  <LoginView v-else-if="!authStore.isAuthenticated" />

  <!-- State 3: Authenticated — show main app -->
  <AppShell v-else />
</template>
