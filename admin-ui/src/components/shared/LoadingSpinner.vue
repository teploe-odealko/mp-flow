<script setup lang="ts">
withDefaults(defineProps<{
  size?: string
}>(), {
  size: 'w-8 h-8',
})
</script>

<template>
  <div class="flex items-center justify-center">
    <svg
      :class="['animate-spin text-sky-500', size]"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        class="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="4"
      />
      <path
        class="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  </div>
</template>
