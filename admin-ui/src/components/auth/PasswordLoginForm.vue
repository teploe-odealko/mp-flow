<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleSubmit() {
  error.value = ''
  const u = username.value.trim()
  const p = password.value
  if (!u || !p) {
    error.value = 'Заполните все поля'
    return
  }
  loading.value = true
  try {
    await authStore.loginPassword(u, p)
    await authStore.loadCurrentUser()
  } catch (e: any) {
    error.value = e.message || 'Ошибка соединения'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="handleSubmit">
    <div>
      <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Имя пользователя</label>
      <input
        v-model="username"
        type="text"
        class="form-input"
        placeholder="admin"
        autocomplete="username"
      />
    </div>
    <div>
      <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Пароль</label>
      <input
        v-model="password"
        type="password"
        class="form-input"
        placeholder="Пароль"
        autocomplete="current-password"
      />
    </div>
    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <button
      type="submit"
      class="w-full py-2.5 px-4 text-sm font-medium text-white bg-sky-500 rounded-lg hover:bg-sky-600 transition-colors disabled:opacity-50"
      :disabled="loading"
    >
      {{ loading ? 'Вход...' : 'Войти' }}
    </button>
  </form>
</template>
