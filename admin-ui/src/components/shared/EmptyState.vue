<script setup lang="ts">
withDefaults(defineProps<{
  message?: string
}>(), {
  message: 'Нет данных',
})
</script>

<template>
  <div class="flex items-center justify-center py-12">
    <p class="text-sm text-slate-400 dark:text-slate-500">{{ message }}</p>
  </div>
</template>
