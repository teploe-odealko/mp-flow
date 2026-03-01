<script setup lang="ts">
import { computed, ref, reactive } from 'vue'
import { useCardDetailStore } from '@/stores/card-detail'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{
  cardId: string
}>()

const cardDetailStore = useCardDetailStore()

const detail = computed(() => cardDetailStore.selectedCardDetail)
const item = computed(() => detail.value?.item ?? null)

const source1688Status = ref('')
const source1688StatusError = ref(false)
const sourceTab = ref<'1688' | 'manual'>('1688')

// 1688 form
const source1688Url = ref('')
const source1688OverwriteTitle = ref(false)
const preview1688Data = ref<any>(null)
const selected1688Sku = ref<any>(null)
const showSkuPicker = ref(false)

// Manual source form
const manualForm = reactive({
  provider: '',
  kind: 'marketplace',
  externalRef: '',
  note: '',
})

function getCardAttributes(card: any): Record<string, any> {
  const raw = card?.attributes
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw }
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw)
      if (p && typeof p === 'object') return p
    } catch { /* ignore */ }
  }
  return {}
}

interface SourceEntry {
  key: string
  provider: string
  kind: string
  external_ref: string
  updated_at: string | null
  data: Record<string, any>
}

const sourceEntries = computed<SourceEntry[]>(() => {
  if (!item.value) return []
  const attrs = getCardAttributes(item.value)
  const sources = attrs?.sources
  const entries: SourceEntry[] = []

  if (sources && typeof sources === 'object') {
    for (const [key, source] of Object.entries(sources) as [string, any][]) {
      entries.push({
        key,
        provider: (source.provider || 'source').toLowerCase(),
        kind: source.kind || 'unknown',
        external_ref: source.external_ref || '',
        updated_at: source.updated_at || null,
        data: source?.data && typeof source.data === 'object' ? source.data : {},
      })
    }
  }

  // Auto-inject virtual Ozon source if card has ozon_product_id but no explicit ozon source
  if (
    item.value.ozon_product_id &&
    !entries.some((e) => e.provider === 'ozon')
  ) {
    entries.push({
      key: 'ozon:' + item.value.ozon_product_id,
      provider: 'ozon',
      kind: 'marketplace',
      external_ref: item.value.ozon_offer_id || item.value.ozon_product_id || '',
      updated_at: item.value.updated_at,
      data: {
        title: item.value.title,
        url: `https://www.ozon.ru/product/${item.value.ozon_product_id}`,
        images: item.value.ozon_main_image ? [item.value.ozon_main_image] : [],
      },
    })
  }

  return entries
})

function getLinkUrl(source: SourceEntry): string | null {
  let linkUrl = source.data.url || null
  if (!linkUrl && source.external_ref) {
    if (source.provider === '1688') {
      linkUrl = `https://detail.1688.com/offer/${source.external_ref}.html`
    } else if (source.provider === 'ozon') {
      linkUrl = `https://www.ozon.ru/product/${source.data.sku || source.external_ref}`
    } else if (String(source.external_ref).startsWith('http')) {
      linkUrl = source.external_ref
    }
  }
  return linkUrl
}

function getTitleText(source: SourceEntry): string {
  return source.data.title || source.data.name || getLinkUrl(source) || 'Без названия'
}

function getThumbnail(source: SourceEntry): string | null {
  const images = source.data.images || []
  return images.length ? images[0] : null
}

function getPrice(source: SourceEntry): string | null {
  const price = source.data.selected_sku_price || source.data.price_min
  return price ? `${price} CNY` : null
}

function getMetaParts(source: SourceEntry): string[] {
  const parts: string[] = []
  if (source.data.selected_sku_id) parts.push(`SKU: ${source.data.selected_sku_id}`)
  if (source.data.note) parts.push(source.data.note)
  return parts
}

function badgeClass(provider: string): string {
  if (provider === '1688') return 'badge badge-1688'
  if (provider === 'ozon') return 'badge badge-ozon'
  return 'badge badge-muted'
}

async function onDeleteSource(sourceKey: string) {
  if (!confirm(`Удалить источник ${sourceKey}?`)) return
  try {
    await cardDetailStore.removeSource(props.cardId, sourceKey)
    // Reload detail
    cardDetailStore.clearDetail()
    await cardDetailStore.loadCardPage(props.cardId)
  } catch (err: any) {
    source1688Status.value = `Ошибка: ${err.message}`
    source1688StatusError.value = true
  }
}

function showSourceMessage(text: string, isError = false) {
  source1688Status.value = text
  source1688StatusError.value = isError
}

async function onPreview1688() {
  const url = source1688Url.value.trim()
  if (!url) {
    showSourceMessage('Введите URL 1688', true)
    return
  }
  showSourceMessage('Загрузка превью...')
  try {
    const data = await cardDetailStore.preview1688(url)
    preview1688Data.value = data
    selected1688Sku.value = null
    showSkuPicker.value = true
    const skuCount = (data.skus || []).length
    showSourceMessage(`${data.title || 'Товар'} \u2014 ${skuCount} SKU`)
    // Auto-select first if only one
    if (data.skus?.length === 1) {
      selected1688Sku.value = data.skus[0]
    }
  } catch (err: any) {
    showSourceMessage(`Ошибка: ${err.message}`, true)
  }
}

function onSelectSku(sku: any) {
  selected1688Sku.value = sku
}

async function onAttach1688() {
  const url = source1688Url.value.trim()
  if (!url) {
    showSourceMessage('Введите URL 1688', true)
    return
  }
  showSourceMessage('Прикрепление источника...')
  try {
    const body: any = {
      url,
      overwrite_title: source1688OverwriteTitle.value,
    }
    if (selected1688Sku.value) {
      body.selected_sku_id = selected1688Sku.value.sku_id
      body.selected_sku_price = selected1688Sku.value.price
    }
    await cardDetailStore.attachSource1688(props.cardId, body)
    showSourceMessage('Источник 1688 прикреплён')
    // Reset
    source1688Url.value = ''
    showSkuPicker.value = false
    preview1688Data.value = null
    selected1688Sku.value = null
    // Reload
    cardDetailStore.clearDetail()
    await cardDetailStore.loadCardPage(props.cardId)
  } catch (err: any) {
    showSourceMessage(`Ошибка: ${err.message}`, true)
  }
}

async function onManualSourceSubmit() {
  if (!manualForm.provider.trim()) return
  try {
    await cardDetailStore.attachManualSource(
      props.cardId,
      manualForm.provider.trim(),
      manualForm.kind,
      manualForm.externalRef.trim(),
      manualForm.note.trim(),
    )
    // Reset form
    manualForm.provider = ''
    manualForm.kind = 'marketplace'
    manualForm.externalRef = ''
    manualForm.note = ''
    // Reload
    cardDetailStore.clearDetail()
    await cardDetailStore.loadCardPage(props.cardId)
  } catch (err: any) {
    showSourceMessage(`Ошибка: ${err.message}`, true)
  }
}
</script>

<template>
  <div class="mt-6">
    <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">
      Источники
      <span
        v-if="sourceEntries.length"
        class="badge badge-muted ml-2"
      >
        {{ sourceEntries.length }}
      </span>
    </h3>

    <!-- Source cards -->
    <div v-if="!sourceEntries.length" class="muted" style="padding: 4px">
      Нет источников
    </div>
    <div v-else class="space-y-3">
      <div
        v-for="source in sourceEntries"
        :key="source.key"
        class="source-card"
      >
        <!-- Header -->
        <div class="source-card-header">
          <span :class="badgeClass(source.provider)">{{ source.provider }}</span>
          <span class="badge badge-muted">{{ source.kind }}</span>
          <span class="source-card-date">{{ formatDateTime(source.updated_at) }}</span>
        </div>

        <!-- Body -->
        <div class="source-card-body">
          <div class="source-card-thumb">
            <img
              v-if="getThumbnail(source)"
              :src="getThumbnail(source)!"
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
            />
            <div v-else class="source-card-thumb-empty">--</div>
          </div>
          <div class="source-card-info">
            <a
              v-if="getLinkUrl(source)"
              :href="getLinkUrl(source)!"
              target="_blank"
              rel="noopener"
              class="source-card-title"
            >
              {{ getTitleText(source) }}
            </a>
            <span v-else class="source-card-title">{{ getTitleText(source) }}</span>
            <div v-if="getPrice(source)" class="source-card-price">{{ getPrice(source) }}</div>
            <div v-if="getMetaParts(source).length" class="source-card-meta">
              {{ getMetaParts(source).join(' | ') }}
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="source-card-actions">
          <button
            class="ghost-btn source-delete-btn"
            style="font-size: 12px; padding: 4px 8px"
            @click="onDeleteSource(source.key)"
          >
            Удалить
          </button>
        </div>
      </div>
    </div>

    <!-- Add source accordion -->
    <details class="mt-4" :open="sourceEntries.length === 0 ? true : undefined">
      <summary
        class="cursor-pointer text-sm font-medium text-sky-500 dark:text-sky-400 hover:text-sky-600 dark:hover:text-sky-300 select-none"
      >
        + Добавить источник
      </summary>

      <div class="mt-3 add-source-content">
        <!-- Source type tabs -->
        <div class="flex gap-0 border-b border-slate-200 dark:border-slate-800 mb-3">
          <button
            class="source-tab"
            :class="{ active: sourceTab === '1688' }"
            @click="sourceTab = '1688'"
          >
            1688 TMAPI
          </button>
          <button
            class="source-tab"
            :class="{ active: sourceTab === 'manual' }"
            @click="sourceTab = 'manual'"
          >
            Вручную
          </button>
        </div>

        <!-- 1688 source pane -->
        <div v-show="sourceTab === '1688'" class="space-y-3">
          <div class="flex gap-2 items-end">
            <div class="flex-1">
              <label class="block text-xs font-medium text-slate-500 dark:text-slate-400">URL товара на 1688</label>
              <input
                v-model="source1688Url"
                type="text"
                class="form-input"
                placeholder="https://detail.1688.com/offer/..."
              />
            </div>
            <button
              class="px-3 py-2 text-sm font-medium text-sky-500 border border-sky-200 dark:border-sky-800 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950 transition-colors"
              @click="onPreview1688"
            >
              Превью
            </button>
          </div>

          <label class="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 cursor-pointer">
            <input v-model="source1688OverwriteTitle" type="checkbox" class="rounded" />
            Перезаписать название карточки
          </label>

          <!-- Status -->
          <p
            v-if="source1688Status"
            class="text-xs"
            :class="source1688StatusError ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'"
          >
            {{ source1688Status }}
          </p>

          <!-- SKU picker -->
          <div v-if="showSkuPicker && preview1688Data" class="space-y-2">
            <div
              v-if="!preview1688Data.skus || !preview1688Data.skus.length"
              class="muted"
              style="padding: 8px"
            >
              Нет вариантов SKU — будет прикреплён весь товар
            </div>
            <div v-else class="sku-grid">
              <div
                v-for="sku in preview1688Data.skus"
                :key="sku.sku_id"
                class="sku-card"
                :class="{ selected: selected1688Sku?.sku_id === sku.sku_id }"
                @click="onSelectSku(sku)"
              >
                <img
                  v-if="sku.image"
                  :src="sku.image"
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                />
                <div v-else class="sku-no-img">нет фото</div>
                <div class="sku-name">{{ sku.name || sku.sku_id || '\u2014' }}</div>
                <div v-if="sku.price != null" class="sku-price">{{ sku.price }} CNY</div>
              </div>
            </div>

            <button
              class="px-4 py-2 text-sm font-medium text-white bg-sky-500 rounded-lg hover:bg-sky-600 transition-colors"
              @click="onAttach1688"
            >
              Прикрепить
            </button>
          </div>
        </div>

        <!-- Manual source pane -->
        <div v-show="sourceTab === 'manual'">
          <form class="space-y-3" @submit.prevent="onManualSourceSubmit">
            <div>
              <label class="block text-xs font-medium text-slate-500 dark:text-slate-400">Провайдер</label>
              <input
                v-model="manualForm.provider"
                type="text"
                class="form-input"
                placeholder="Название источника"
                required
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 dark:text-slate-400">Тип</label>
              <select v-model="manualForm.kind" class="form-input">
                <option value="marketplace">marketplace</option>
                <option value="supplier">supplier</option>
                <option value="manufacturer">manufacturer</option>
                <option value="other">other</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 dark:text-slate-400">URL / Ссылка</label>
              <input
                v-model="manualForm.externalRef"
                type="text"
                class="form-input"
                placeholder="https://..."
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 dark:text-slate-400">Заметка</label>
              <input
                v-model="manualForm.note"
                type="text"
                class="form-input"
                placeholder="Комментарий"
              />
            </div>
            <button
              type="submit"
              class="px-4 py-2 text-sm font-medium text-white bg-sky-500 rounded-lg hover:bg-sky-600 transition-colors disabled:opacity-50"
              :disabled="!manualForm.provider.trim()"
            >
              Добавить источник
            </button>
          </form>
        </div>
      </div>
    </details>
  </div>
</template>
