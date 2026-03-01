<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const props = withDefaults(defineProps<{
  title?: string
  subtitle?: string
}>(), {
  title: '',
  subtitle: '',
})

const route = useRoute()

const displayTitle = computed(() => {
  return props.title || (route.meta?.title as string) || ''
})

const displaySubtitle = computed(() => {
  return props.subtitle || (route.meta?.subtitle as string) || ''
})
</script>

<template>
  <div v-if="displayTitle" class="mb-6 flex items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-slate-900 dark:text-white">{{ displayTitle }}</h1>
      <p v-if="displaySubtitle" class="mt-1 text-sm text-slate-500 dark:text-slate-400">{{ displaySubtitle }}</p>
    </div>
    <div class="flex items-center gap-2 flex-shrink-0">
      <slot />
    </div>
  </div>
</template>
