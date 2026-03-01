<script setup lang="ts">
import { watch, onUnmounted, ref, nextTick } from 'vue'

const props = withDefaults(defineProps<{
  open: boolean
  width?: string
}>(), {
  width: '45vw',
})

const emit = defineEmits<{
  close: []
}>()

const isVisible = ref(false)

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}

watch(() => props.open, async (val) => {
  if (val) {
    document.addEventListener('keydown', handleKeydown)
    document.body.style.overflow = 'hidden'
    // Trigger CSS transition after mount
    await nextTick()
    requestAnimationFrame(() => {
      isVisible.value = true
    })
  } else {
    isVisible.value = false
    document.removeEventListener('keydown', handleKeydown)
    document.body.style.overflow = ''
  }
}, { immediate: true })

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <template v-if="open">
      <!-- Backdrop -->
      <div
        class="drawer-backdrop"
        :class="{ visible: isVisible }"
        @click="emit('close')"
      />
      <!-- Panel -->
      <div
        class="drawer-panel"
        :class="{ visible: isVisible }"
        :style="{ width: width }"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <slot name="header" />
          <button
            class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            @click="emit('close')"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-5">
          <slot />
        </div>
        <!-- Footer (optional) -->
        <slot name="footer" />
      </div>
    </template>
  </Teleport>
</template>
