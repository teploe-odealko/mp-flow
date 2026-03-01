import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { apiRequest } from '@/composables/useApi'

export interface FinanceTransaction {
  id: string
  kind: 'income' | 'expense'
  category: string
  amount_rub: number
  notes: string | null
  happened_at: string | null
  source: string
  created_at: string | null
}

export interface FinanceCategory {
  value: string
  label: string
}

export const FINANCE_CATEGORIES: Record<string, FinanceCategory[]> = {
  expense: [
    { value: 'rent', label: 'Аренда' },
    { value: 'salary', label: 'Зарплата' },
    { value: 'ads', label: 'Реклама (внешняя)' },
    { value: 'packaging', label: 'Упаковка' },
    { value: 'logistics', label: 'Логистика' },
    { value: 'tools', label: 'Инструменты и сервисы' },
    { value: 'tax', label: 'Налоги и взносы' },
    { value: 'inventory_loss', label: 'Потери / расхождения' },
    { value: 'other_expense', label: 'Прочие расходы' },
  ],
  income: [
    { value: 'refund', label: 'Возврат средств' },
    { value: 'subsidy', label: 'Субсидия / грант' },
    { value: 'other_income', label: 'Прочие доходы' },
  ],
}

export function financeCategoryLabel(value: string): string {
  for (const cats of Object.values(FINANCE_CATEGORIES)) {
    const found = cats.find((c) => c.value === value)
    if (found) return found.label
  }
  return value || '—'
}

function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const useFinanceStore = defineStore('finance', () => {
  const financeLoaded = ref(false)
  const transactions = ref<FinanceTransaction[]>([])
  const financeSearchQuery = ref('')
  const financeSort = reactive<{ field: string; dir: 'asc' | 'desc' }>({
    field: 'happened_at',
    dir: 'desc',
  })

  // Filter defaults: current month
  const today = new Date()
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
  const filterFrom = ref(localDateStr(firstDay))
  const filterTo = ref(localDateStr(today))
  const filterKind = ref('')
  const filterCategory = ref('')

  const editingTxn = ref<FinanceTransaction | null>(null)

  const pagination = reactive({
    total: 0,
    limit: 200,
    offset: 0,
  })

  async function loadFinanceTransactions() {
    financeLoaded.value = true
    const params = new URLSearchParams({ limit: '200', source: 'manual' })
    if (filterFrom.value) params.set('date_from', filterFrom.value)
    if (filterTo.value) params.set('date_to', filterTo.value)
    if (filterKind.value) params.set('kind', filterKind.value)
    if (filterCategory.value) params.set('category', filterCategory.value)
    if (financeSearchQuery.value) params.set('q', financeSearchQuery.value)
    params.set('sort', `${financeSort.field}:${financeSort.dir}`)

    const data = await apiRequest<{
      items: FinanceTransaction[]
      total?: number
    }>(`/finance/transactions?${params}`)
    transactions.value = data.items || []
    pagination.total = data.total || data.items?.length || 0
  }

  async function createTransaction(payload: {
    kind: string
    category: string
    amount_rub: number
    notes?: string | null
    happened_at?: string
  }) {
    await apiRequest('/finance/transactions', {
      method: 'POST',
      body: payload,
    })
    await loadFinanceTransactions()
  }

  async function updateTransaction(
    id: string,
    payload: {
      kind: string
      category: string
      amount_rub: number
      notes?: string | null
      happened_at?: string
    },
  ) {
    await apiRequest(`/finance/transactions/${id}`, {
      method: 'PUT',
      body: payload,
    })
    await loadFinanceTransactions()
  }

  async function deleteTransaction(id: string) {
    await apiRequest(`/finance/transactions/${id}`, { method: 'DELETE' })
    await loadFinanceTransactions()
  }

  function toggleSort(field: string) {
    if (financeSort.field === field) {
      financeSort.dir = financeSort.dir === 'asc' ? 'desc' : 'asc'
    } else {
      financeSort.field = field
      financeSort.dir = 'asc'
    }
  }

  return {
    financeLoaded,
    transactions,
    financeSearchQuery,
    financeSort,
    filterFrom,
    filterTo,
    filterKind,
    filterCategory,
    editingTxn,
    pagination,
    loadFinanceTransactions,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    toggleSort,
  }
})
