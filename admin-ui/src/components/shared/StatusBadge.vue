<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  status: string
}>()

const badgeClass = computed(() => {
  const map: Record<string, string> = {
    active: 'badge-success',
    draft: 'badge-muted',
    archived: 'badge-muted',
    received: 'badge-success',
    pending: 'badge-warning',
    processing: 'badge-warning',
    '1688': 'badge-1688',
    ozon: 'badge-ozon',
    success: 'badge-success',
    error: 'badge-warning',
    warning: 'badge-warning',
  }
  return map[props.status] || 'badge-muted'
})
</script>

<template>
  <span class="badge" :class="badgeClass">{{ status }}</span>
</template>
