<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useFinanceStore, FINANCE_CATEGORIES, financeCategoryLabel } from '@/stores/finance'
import { useUiStore } from '@/stores/ui'
import { formatMoney } from '@/utils/format'
import FinanceModal from '@/components/finance/FinanceModal.vue'
import type { FinanceTransaction } from '@/stores/finance'

const financeStore = useFinanceStore()
const ui = useUiStore()

const modalOpen = ref(false)
const editingTxn = ref<FinanceTransaction | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  financeStore.loadFinanceTransactions()
})

function onSearchInput(e: Event) {
  financeStore.financeSearchQuery = (e.target as HTMLInputElement).value.trim()
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => financeStore.loadFinanceTransactions(), 300)
}

function onFilterChange() {
  financeStore.loadFinanceTransactions()
}

function onKindFilterChange(e: Event) {
  financeStore.filterKind = (e.target as HTMLSelectElement).value
  financeStore.filterCategory = ''
  financeStore.loadFinanceTransactions()
}

const filterCategories = computed(() => {
  const kind = financeStore.filterKind
  if (kind) return FINANCE_CATEGORIES[kind] || []
  return [...(FINANCE_CATEGORIES.expense || []), ...(FINANCE_CATEGORIES.income || [])]
})

function onSortClick(field: string) {
  financeStore.toggleSort(field)
  financeStore.loadFinanceTransactions()
}

function sortArrow(field: string): string {
  if (financeStore.financeSort.field !== field) return ''
  return financeStore.financeSort.dir === 'asc' ? '\u25B2' : '\u25BC'
}

function sortArrowClass(field: string): string {
  return financeStore.financeSort.field === field ? 'sort-arrow active' : 'sort-arrow'
}

function formatDate(d: string | null): string {
  if (!d) return '\u2014'
  return new Date(d).toLocaleDateString('ru-RU')
}

function kindBadge(kind: string): { label: string; cls: string } {
  if (kind === 'income') {
    return { label: 'Доход', cls: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' }
  }
  return { label: 'Расход', cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' }
}

function amountClass(kind: string): string {
  return kind === 'income' ? 'text-emerald-600' : 'text-red-500'
}

function openCreateModal() {
  editingTxn.value = null
  modalOpen.value = true
}

function openEditModal(txn: FinanceTransaction) {
  editingTxn.value = txn
  modalOpen.value = true
}

async function onDeleteTransaction(id: string) {
  if (!confirm('Удалить запись?')) return
  try {
    await financeStore.deleteTransaction(id)
    ui.addToast('Запись удалена', 'success')
  } catch (err: any) {
    ui.addToast('Ошибка: ' + (err.message || ''), 'error')
  }
}

function onModalSaved() {
  modalOpen.value = false
  financeStore.loadFinanceTransactions()
}
</script>

<template>
  <div class="space-y-4">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-3">
      <!-- Search -->
      <div class="relative flex-1 min-w-[200px] max-w-[300px]">
        <svg
          class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          class="list-search-input"
          placeholder="Поиск..."
          :value="financeStore.financeSearchQuery"
          @input="onSearchInput"
        />
      </div>

      <!-- Date range -->
      <input
        type="date"
        :value="financeStore.filterFrom"
        class="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
        @change="financeStore.filterFrom = ($event.target as HTMLInputElement).value; onFilterChange()"
      />
      <input
        type="date"
        :value="financeStore.filterTo"
        class="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
        @change="financeStore.filterTo = ($event.target as HTMLInputElement).value; onFilterChange()"
      />

      <!-- Kind filter -->
      <select
        :value="financeStore.filterKind"
        class="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
        @change="onKindFilterChange"
      >
        <option value="">Все типы</option>
        <option value="expense">Расходы</option>
        <option value="income">Доходы</option>
      </select>

      <!-- Category filter -->
      <select
        :value="financeStore.filterCategory"
        class="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
        @change="financeStore.filterCategory = ($event.target as HTMLSelectElement).value; onFilterChange()"
      >
        <option value="">Все категории</option>
        <option v-for="c in filterCategories" :key="c.value" :value="c.value">{{ c.label }}</option>
      </select>

      <div class="flex-1" />

      <!-- Add button -->
      <button
        class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-500 rounded-lg hover:bg-sky-600 transition-colors"
        @click="openCreateModal"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Добавить
      </button>
    </div>

    <!-- Table -->
    <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table class="w-full text-left">
        <thead>
          <tr class="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
            <th
              class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-pointer"
              @click="onSortClick('happened_at')"
            >
              Дата <span :class="sortArrowClass('happened_at')">{{ sortArrow('happened_at') }}</span>
            </th>
            <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Тип</th>
            <th
              class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-pointer"
              @click="onSortClick('category')"
            >
              Категория <span :class="sortArrowClass('category')">{{ sortArrow('category') }}</span>
            </th>
            <th
              class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right cursor-pointer"
              @click="onSortClick('amount_rub')"
            >
              Сумма <span :class="sortArrowClass('amount_rub')">{{ sortArrow('amount_rub') }}</span>
            </th>
            <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Заметки</th>
            <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Действия</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in financeStore.transactions"
            :key="t.id"
            class="hover:bg-slate-50 dark:hover:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800/50"
          >
            <td class="px-4 py-2.5 text-sm">{{ formatDate(t.happened_at) }}</td>
            <td class="px-4 py-2.5">
              <span :class="'px-2 py-0.5 text-[10px] font-bold rounded-full ' + kindBadge(t.kind).cls">
                {{ kindBadge(t.kind).label }}
              </span>
            </td>
            <td class="px-4 py-2.5 text-sm">{{ financeCategoryLabel(t.category) }}</td>
            <td :class="'px-4 py-2.5 text-sm text-right font-medium tabular-nums ' + amountClass(t.kind)">
              {{ formatMoney(t.amount_rub) }}
            </td>
            <td class="px-4 py-2.5 text-sm text-slate-500 truncate max-w-[200px]">{{ t.notes || '' }}</td>
            <td class="px-4 py-2.5 text-right">
              <button class="text-xs text-sky-500 hover:text-sky-800 mr-2" @click="openEditModal(t)">Ред.</button>
              <button class="text-xs text-red-500 hover:text-red-700" @click="onDeleteTransaction(t.id)">Удал.</button>
            </td>
          </tr>
          <tr v-if="!financeStore.transactions.length">
            <td colspan="6" class="px-4 py-8 text-center text-sm text-slate-400">Нет записей</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Finance Modal -->
    <FinanceModal
      :open="modalOpen"
      :editing-transaction="editingTxn"
      @close="modalOpen = false"
      @saved="onModalSaved"
    />
  </div>
</template>
