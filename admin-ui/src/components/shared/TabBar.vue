<script setup lang="ts">
export interface Tab {
  id: string
  label: string
}

defineProps<{
  tabs: Tab[]
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <div class="flex border-b border-slate-200 dark:border-slate-700 mb-4">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="card-page-tab"
      :class="{ active: modelValue === tab.id }"
      @click="emit('update:modelValue', tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>
