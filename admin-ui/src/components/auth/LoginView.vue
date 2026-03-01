<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import PasswordLoginForm from './PasswordLoginForm.vue'

const authStore = useAuthStore()
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 p-4">
    <div class="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-8 space-y-6">
      <!-- Logo + Title -->
      <div class="text-center space-y-3">
        <img src="/logo.png" alt="MPFlow" class="w-16 h-16 mx-auto rounded-xl" />
        <h1 class="text-2xl font-bold text-slate-900 dark:text-white">MPFlow</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400">Управление маркетплейсами</p>
      </div>

      <!-- Logto mode: show redirecting -->
      <div v-if="authStore.isLogtoMode" class="text-center py-6">
        <svg class="w-8 h-8 animate-spin text-sky-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p class="text-sm text-slate-500 dark:text-slate-400">Перенаправление...</p>
      </div>

      <!-- Password mode: show form -->
      <PasswordLoginForm v-else />
    </div>
  </div>
</template>
