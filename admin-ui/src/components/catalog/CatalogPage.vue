<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCatalogStore } from '@/stores/catalog'
import CreateCardDrawer from '@/components/catalog/CreateCardDrawer.vue'

const router = useRouter()
const catalogStore = useCatalogStore()

const drawerOpen = ref(false)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  catalogStore.loadCards()
})

function onSearchInput(e: Event) {
  const value = (e.target as HTMLInputElement).value
  catalogStore.searchQuery = value
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    catalogStore.loadCards()
  }, 300)
}

function onSortClick(field: string) {
  catalogStore.toggleSort(field)
  catalogStore.loadCards()
}

function onArchivedToggle(e: Event) {
  catalogStore.showArchived = (e.target as HTMLInputElement).checked
  catalogStore.loadCards()
}

function onRowClick(cardId: string) {
  router.push(`/card/${cardId}`)
}

function sortArrow(field: string): string {
  if (catalogStore.cardSort.field !== field) return ''
  return catalogStore.cardSort.dir === 'asc' ? '\u25B2' : '\u25BC'
}

function sortArrowClass(field: string): string {
  return catalogStore.cardSort.field === field ? 'sort-arrow active' : 'sort-arrow'
}

function getPurchaseText(card: any): string {
  const attrs = card?.attributes
  const raw = attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? attrs : {}
  const pp = raw.purchase
  if (pp && pp.price) return `${pp.price} ${pp.currency || 'CNY'}`
  return '\u2014'
}

function onCardCreated() {
  catalogStore.loadCards()
}
</script>

<template>
  <div class="space-y-4">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-3">
      <!-- Search -->
      <div class="relative flex-1 min-w-[200px] max-w-[360px]">
        <svg
          class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          class="list-search-input"
          placeholder="Поиск по SKU, названию..."
          :value="catalogStore.searchQuery"
          @input="onSearchInput"
        />
      </div>

      <!-- Show archived toggle -->
      <label class="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 cursor-pointer select-none">
        <input
          type="checkbox"
          class="rounded"
          :checked="catalogStore.showArchived"
          @change="onArchivedToggle"
        />
        Показать архивные
      </label>

      <div class="flex-1" />

      <!-- Create button -->
      <button
        class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-500 rounded-lg hover:bg-sky-600 transition-colors"
        @click="drawerOpen = true"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Создать карточку
      </button>
    </div>

    <!-- Table -->
    <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table class="w-full text-left">
        <thead>
          <tr class="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
            <th
              class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
              data-sort="sku"
              @click="onSortClick('sku')"
            >
              SKU
              <span :class="sortArrowClass('sku')">{{ sortArrow('sku') }}</span>
            </th>
            <th
              class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
              data-sort="title"
              @click="onSortClick('title')"
            >
              Название
              <span :class="sortArrowClass('title')">{{ sortArrow('title') }}</span>
            </th>
            <th
              class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
            >
              Закупочная цена
            </th>
            <th
              class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
              data-sort="ozon_offer_id"
              @click="onSortClick('ozon_offer_id')"
            >
              Ozon Offer ID
              <span :class="sortArrowClass('ozon_offer_id')">{{ sortArrow('ozon_offer_id') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="card in catalogStore.cards"
            :key="card.id"
            class="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800/50"
            :class="{ 'archived-row': card.status === 'archived' }"
            @click="onRowClick(card.id)"
          >
            <td class="px-4 py-2.5 text-sm">{{ card.sku || '\u2014' }}</td>
            <td class="px-4 py-2.5 text-sm">{{ card.title || '\u2014' }}</td>
            <td class="px-4 py-2.5 text-sm">{{ getPurchaseText(card) }}</td>
            <td class="px-4 py-2.5 text-sm">{{ card.ozon_offer_id || '\u2014' }}</td>
          </tr>
          <tr v-if="!catalogStore.cards.length">
            <td colspan="4" class="muted text-center py-8">
              {{ catalogStore.searchQuery ? 'Ничего не найдено' : 'Карточек пока нет' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Create Card Drawer -->
    <CreateCardDrawer
      :open="drawerOpen"
      @close="drawerOpen = false"
      @created="onCardCreated"
    />
  </div>
</template>
