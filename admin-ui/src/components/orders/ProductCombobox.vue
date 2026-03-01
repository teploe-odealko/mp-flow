<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useCatalogStore, type MasterCard } from '@/stores/catalog'

const props = defineProps<{
  modelValue: string // master_card_id
}>()

const emit = defineEmits<{
  'update:modelValue': [id: string]
  select: [card: MasterCard]
}>()

const catalogStore = useCatalogStore()

const query = ref('')
const isOpen = ref(false)
const highlightedIndex = ref(-1)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLUListElement | null>(null)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const cards = catalogStore.cards.filter((c) => c.status !== 'archived')
  if (!q) return cards.slice(0, 30)
  return cards.filter(
    (c) =>
      (c.sku && c.sku.toLowerCase().includes(q)) ||
      (c.title && c.title.toLowerCase().includes(q)) ||
      (c.ozon_offer_id && c.ozon_offer_id.toLowerCase().includes(q)),
  )
})

const selectedCard = computed(() =>
  props.modelValue
    ? catalogStore.cards.find((c) => c.id === props.modelValue) ?? null
    : null,
)

const displayValue = computed(() => {
  if (isOpen.value) return query.value
  if (selectedCard.value) {
    const c = selectedCard.value
    return `${c.sku || ''} — ${c.title || ''}`
  }
  return ''
})

function onFocus() {
  isOpen.value = true
  query.value = ''
  highlightedIndex.value = -1
}

function onBlur() {
  // Delay to allow click on dropdown item
  setTimeout(() => {
    isOpen.value = false
  }, 150)
}

function onInput(e: Event) {
  query.value = (e.target as HTMLInputElement).value
  highlightedIndex.value = -1
  if (!isOpen.value) isOpen.value = true
}

function pickCard(card: MasterCard) {
  emit('update:modelValue', card.id)
  emit('select', card)
  isOpen.value = false
  query.value = ''
}

function onKeydown(e: KeyboardEvent) {
  const len = filtered.value.length
  if (!len) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlightedIndex.value = (highlightedIndex.value + 1) % len
    scrollToHighlighted()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlightedIndex.value = (highlightedIndex.value - 1 + len) % len
    scrollToHighlighted()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (highlightedIndex.value >= 0 && highlightedIndex.value < len) {
      pickCard(filtered.value[highlightedIndex.value])
    }
  } else if (e.key === 'Escape') {
    isOpen.value = false
    inputRef.value?.blur()
  }
}

function scrollToHighlighted() {
  nextTick(() => {
    const list = listRef.value
    if (!list) return
    const el = list.children[highlightedIndex.value] as HTMLElement
    if (el) el.scrollIntoView({ block: 'nearest' })
  })
}

function cardLabel(c: MasterCard): string {
  return `${c.sku || 'NO-SKU'} — ${c.title || ''}`
}
</script>

<template>
  <div class="relative">
    <input
      ref="inputRef"
      type="text"
      class="form-input w-full"
      :value="displayValue"
      placeholder="Поиск товара..."
      autocomplete="off"
      @focus="onFocus"
      @blur="onBlur"
      @input="onInput"
      @keydown="onKeydown"
    />
    <ul
      v-if="isOpen && filtered.length"
      ref="listRef"
      class="absolute z-50 left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800"
    >
      <li
        v-for="(card, idx) in filtered"
        :key="card.id"
        class="cursor-pointer px-3 py-1.5 text-xs transition-colors"
        :class="[
          idx === highlightedIndex
            ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
            : 'hover:bg-slate-50 dark:hover:bg-slate-700/50',
        ]"
        @mousedown.prevent="pickCard(card)"
      >
        <span class="font-medium text-slate-500 dark:text-slate-400">{{ card.sku || 'NO-SKU' }}</span>
        <span class="ml-1.5 text-slate-700 dark:text-slate-200">{{ card.title || '' }}</span>
      </li>
    </ul>
    <div
      v-if="isOpen && !filtered.length && query.length > 0"
      class="absolute z-50 left-0 right-0 top-full mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400 shadow-lg dark:border-slate-600 dark:bg-slate-800"
    >
      Ничего не найдено
    </div>
  </div>
</template>
