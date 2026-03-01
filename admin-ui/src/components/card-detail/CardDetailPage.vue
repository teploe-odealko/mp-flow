<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useCardDetailStore } from '@/stores/card-detail'
import { useCatalogStore } from '@/stores/catalog'
import { usePluginsStore } from '@/stores/plugins'
import CardInfoTab from '@/components/card-detail/CardInfoTab.vue'
import CardFifoTab from '@/components/card-detail/CardFifoTab.vue'
import { computeFifoFallback } from '@/composables/useFifo'

const props = defineProps<{
  cardId: string
}>()

const router = useRouter()
const route = useRoute()
const cardDetailStore = useCardDetailStore()
const catalogStore = useCatalogStore()
const pluginsStore = usePluginsStore()

const activeTab = ref('info')

/** Plugin tabs contributed by the plugin system */
const pluginTabs = computed(() =>
  pluginsStore.contributions.cardTabs.map((t) => ({
    id: t.id,
    label: t.label,
    pluginName: t.pluginName,
  })),
)

const detail = computed(() => cardDetailStore.selectedCardDetail)
const item = computed(() => detail.value?.item ?? null)
const cardTitle = computed(() => item.value?.title || 'Без названия')
const cardSubtitle = computed(() => {
  const sku = item.value?.sku || '\u2014'
  const offerId = item.value?.ozon_offer_id || '\u2014'
  return `SKU: ${sku} \u00b7 Offer ID: ${offerId}`
})
const archiveButtonText = computed(() =>
  item.value?.status === 'archived' ? 'Восстановить' : 'Архивировать',
)

onMounted(async () => {
  await loadCard()
})

watch(
  () => props.cardId,
  async () => {
    cardDetailStore.clearDetail()
    await loadCard()
  },
)

async function loadCard() {
  await cardDetailStore.loadCardPage(props.cardId)
  // Run FIFO fallback if needed
  if (detail.value) {
    const lots = detail.value.lots || []
    const sales = detail.value.sales || []
    const needsFallback = sales.some(
      (s) => Number(s.cogs_rub || 0) === 0 && Number(s.quantity || 0) > 0,
    )
    if (needsFallback && lots.length) {
      computeFifoFallback(lots, sales)
    }
  }
}

function navigateBack() {
  router.back()
}

async function toggleArchive() {
  if (!item.value) return
  await catalogStore.archiveCard(item.value.id, item.value.status)
  // Reload detail
  cardDetailStore.clearDetail()
  await loadCard()
}

async function switchTab(tabName: string) {
  activeTab.value = tabName

  // If it's a plugin tab, activate the plugin and render
  const pt = pluginsStore.contributions.cardTabs.find((t) => t.id === tabName)
  if (pt) {
    await pluginsStore.activatePlugin(pt.pluginName)
    // After activation, render plugin content into the pane
    await nextTick()
    const pane = document.getElementById(pt.id)
    if (pane && pt.renderFn) {
      await pt.renderFn(pane, cardDetailStore.selectedCardDetail)
    }
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center gap-4 flex-wrap">
      <button
        class="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        @click="navigateBack"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
        Назад
      </button>

      <div class="flex-1 min-w-0">
        <h1 class="text-xl font-bold text-slate-900 dark:text-white truncate">
          {{ cardTitle }}
        </h1>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          {{ cardSubtitle }}
        </p>
      </div>

      <button
        class="px-4 py-2 text-sm font-medium border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        @click="toggleArchive"
      >
        {{ archiveButtonText }}
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="cardDetailStore.isLoading" class="text-sm text-slate-400 py-8 text-center">
      Загрузка карточки...
    </div>

    <!-- Tabs -->
    <template v-if="!cardDetailStore.isLoading && detail">
      <div class="border-b border-slate-200 dark:border-slate-800 flex gap-0 overflow-x-auto">
        <button
          class="card-page-tab"
          :class="{ active: activeTab === 'info' }"
          @click="switchTab('info')"
        >
          Инфо
        </button>
        <button
          class="card-page-tab"
          :class="{ active: activeTab === 'fifo' }"
          @click="switchTab('fifo')"
        >
          FIFO
        </button>
        <!-- Plugin tabs -->
        <button
          v-for="pt in pluginTabs"
          :key="pt.id"
          class="card-page-tab plugin-card-tab"
          :class="{ active: activeTab === pt.id }"
          @click="switchTab(pt.id)"
        >
          {{ pt.label }}
        </button>
      </div>

      <!-- Tab panes -->
      <div v-show="activeTab === 'info'">
        <CardInfoTab :card-id="cardId" />
      </div>
      <div v-show="activeTab === 'fifo'">
        <CardFifoTab :card-id="cardId" />
      </div>
      <!-- Plugin tab panes -->
      <div
        v-for="pt in pluginTabs"
        :key="pt.id"
        v-show="activeTab === pt.id"
        :id="pt.id"
        class="space-y-4 p-4"
      >
        <div class="text-sm text-slate-400">Загрузка...</div>
      </div>
    </template>
  </div>
</template>
