<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useFinanceStore, FINANCE_CATEGORIES, type FinanceTransaction } from '@/stores/finance'
import { useUiStore } from '@/stores/ui'
import BaseModal from '@/components/shared/BaseModal.vue'

const props = defineProps<{
  open: boolean
  editingTransaction: FinanceTransaction | null
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const financeStore = useFinanceStore()
const ui = useUiStore()

const kind = ref<'expense' | 'income'>('expense')
const category = ref('')
const amount = ref<number | string>('')
const notes = ref('')
const date = ref('')
const submitting = ref(false)

const isEditing = computed(() => !!props.editingTransaction)

const categories = computed(() => {
  return FINANCE_CATEGORIES[kind.value] || []
})

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (props.editingTransaction) {
        kind.value = props.editingTransaction.kind
        category.value = props.editingTransaction.category
        amount.value = Number(props.editingTransaction.amount_rub)
        notes.value = props.editingTransaction.notes || ''
        date.value = props.editingTransaction.happened_at
          ? props.editingTransaction.happened_at.slice(0, 10)
          : ''
      } else {
        kind.value = 'expense'
        category.value = FINANCE_CATEGORIES.expense[0]?.value || ''
        amount.value = ''
        notes.value = ''
        date.value = ''
      }
    }
  },
)

// When kind changes, reset category
watch(kind, (newKind) => {
  const cats = FINANCE_CATEGORIES[newKind] || []
  if (!cats.find((c) => c.value === category.value)) {
    category.value = cats[0]?.value || ''
  }
})

async function onSubmit() {
  const amtNum = Number(amount.value)
  if (!amtNum || amtNum <= 0) {
    ui.addToast('Введите сумму', 'error')
    return
  }
  if (!category.value) {
    ui.addToast('Выберите категорию', 'error')
    return
  }

  submitting.value = true
  try {
    const payload: {
      kind: string
      category: string
      amount_rub: number
      notes?: string | null
      happened_at?: string
    } = {
      kind: kind.value,
      category: category.value,
      amount_rub: amtNum,
      notes: notes.value.trim() || null,
    }
    if (date.value) {
      payload.happened_at = new Date(date.value).toISOString()
    }

    if (props.editingTransaction) {
      await financeStore.updateTransaction(props.editingTransaction.id, payload)
      ui.addToast('Запись обновлена', 'success')
    } else {
      await financeStore.createTransaction(payload)
      ui.addToast('Запись создана', 'success')
    }
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
        <h3 class="text-lg font-semibold text-slate-900 dark:text-white">
          {{ isEditing ? 'Редактировать запись' : 'Новая запись' }}
        </h3>
        <button
          class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          @click="emit('close')"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form @submit.prevent="onSubmit" class="space-y-4">
        <!-- Kind -->
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Тип</label>
          <select
            v-model="kind"
            class="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
          >
            <option value="expense">Расход</option>
            <option value="income">Доход</option>
          </select>
        </div>

        <!-- Category -->
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Категория</label>
          <select
            v-model="category"
            class="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
          >
            <option v-for="c in categories" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
        </div>

        <!-- Amount -->
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Сумма, руб.</label>
          <input
            v-model="amount"
            type="number"
            step="0.01"
            min="0"
            class="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
            placeholder="0.00"
          />
        </div>

        <!-- Date -->
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Дата</label>
          <input
            v-model="date"
            type="date"
            class="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
          />
        </div>

        <!-- Notes -->
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Описание</label>
          <textarea
            v-model="notes"
            rows="2"
            class="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
            placeholder="Комментарий..."
          />
        </div>

        <div class="flex justify-end gap-3 pt-2">
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
            class="px-4 py-2 text-sm font-medium text-white bg-sky-500 rounded-lg hover:bg-sky-600 disabled:opacity-50 transition-colors"
          >
            {{ submitting ? 'Сохранение...' : (isEditing ? 'Сохранить' : 'Создать') }}
          </button>
        </div>
      </form>
    </div>
  </BaseModal>
</template>
