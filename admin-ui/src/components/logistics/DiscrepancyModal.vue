<script setup lang="ts">
import { ref, watch } from 'vue'
import { useLogisticsStore } from '@/stores/logistics'
import { useUiStore } from '@/stores/ui'
import { formatMoney } from '@/utils/format'
import BaseModal from '@/components/shared/BaseModal.vue'

const props = defineProps<{
  open: boolean
  cardId: string
  quantity: number
  productName: string
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const logisticsStore = useLogisticsStore()
const ui = useUiStore()

const qty = ref(0)
const notes = ref('')
const submitting = ref(false)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      qty.value = props.quantity
      notes.value = ''
    }
  },
)

async function onSubmit() {
  submitting.value = true
  try {
    const result = await logisticsStore.writeOffDiscrepancy({
      master_card_id: props.cardId,
      quantity: qty.value,
      notes: notes.value || null,
    })
    ui.addToast(`Списано ${result.written_off_qty} шт, потери ${formatMoney(result.loss_cost_rub)}`)
    emit('saved')
  } catch (err: any) {
    ui.addToast('Ошибка: ' + (err.message || ''), 'error')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseModal :open="open" max-width="480px" @close="emit('close')">
    <div class="p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold text-slate-900 dark:text-white">Списание расхождения</h3>
        <button
          class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          @click="emit('close')"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form @submit.prevent="onSubmit">
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Товар</label>
            <p class="text-sm text-slate-600 dark:text-slate-400">{{ productName || '\u2014' }}</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Количество</label>
            <input
              v-model.number="qty"
              type="number"
              min="1"
              class="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Причина (необязательно)</label>
            <textarea
              v-model="notes"
              rows="2"
              class="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              placeholder="Комментарий..."
            />
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button
            type="button"
            class="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            @click="emit('close')"
          >
            Отмена
          </button>
          <button
            type="submit"
            :disabled="submitting"
            class="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
          >
            {{ submitting ? 'Списание...' : 'Списать' }}
          </button>
        </div>
      </form>
    </div>
  </BaseModal>
</template>
