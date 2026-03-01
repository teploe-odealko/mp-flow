<script setup lang="ts">
import { reactive, computed, ref, watch } from 'vue'
import { useCardDetailStore } from '@/stores/card-detail'
import CardSourcesList from '@/components/card-detail/CardSourcesList.vue'

const props = defineProps<{
  cardId: string
}>()

const cardDetailStore = useCardDetailStore()
const statusMessage = ref('')
const statusError = ref(false)
const isSaving = ref(false)

const detail = computed(() => cardDetailStore.selectedCardDetail)
const item = computed(() => detail.value?.item ?? null)

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

function getDimensions(attributes: Record<string, any>): Record<string, any> {
  const d = attributes?.dimensions
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {}
}

function toNumberOrNull(value: string | number): number | null {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Number(num.toFixed(3)) : null
}

const form = reactive({
  sku: '',
  title: '',
  brand: '',
  status: 'draft',
  ozon_product_id: '',
  ozon_offer_id: '',
  description: '',
  package_length_cm: '',
  package_width_cm: '',
  package_height_cm: '',
  package_weight_kg: '',
  purchase_price: '',
  purchase_currency: 'CNY',
})

// Populate form when detail loads
watch(
  () => item.value,
  (newItem) => {
    if (!newItem) return
    const attrs = getCardAttributes(newItem)
    const dims = getDimensions(attrs)
    const purchase = attrs.purchase || {}

    form.sku = newItem.sku || ''
    form.title = newItem.title || ''
    form.brand = newItem.brand || ''
    form.status = newItem.status || 'draft'
    form.ozon_product_id = newItem.ozon_product_id || ''
    form.ozon_offer_id = newItem.ozon_offer_id || ''
    form.description = newItem.description || ''
    form.package_length_cm = String(dims.package_length_cm ?? dims.length_cm ?? '')
    form.package_width_cm = String(dims.package_width_cm ?? dims.width_cm ?? '')
    form.package_height_cm = String(dims.package_height_cm ?? dims.height_cm ?? '')
    form.package_weight_kg = String(dims.package_weight_kg ?? dims.weight_kg ?? '')
    form.purchase_price = purchase.price != null ? String(purchase.price) : ''
    form.purchase_currency = purchase.currency || 'CNY'
  },
  { immediate: true },
)

function showMessage(text: string, isError = false) {
  statusMessage.value = text
  statusError.value = isError
  if (!isError) {
    setTimeout(() => {
      statusMessage.value = ''
    }, 3000)
  }
}

async function onSave() {
  if (!item.value) return
  const cardId = item.value.id
  const attrs = getCardAttributes(item.value)

  // Dimensions
  const dims = {
    package_length_cm: toNumberOrNull(form.package_length_cm),
    package_width_cm: toNumberOrNull(form.package_width_cm),
    package_height_cm: toNumberOrNull(form.package_height_cm),
    package_weight_kg: toNumberOrNull(form.package_weight_kg),
  }

  const requiredDims = ['package_length_cm', 'package_width_cm', 'package_height_cm', 'package_weight_kg'] as const
  const allDimsFilled = requiredDims.every((k) => dims[k] !== null)
  if (!allDimsFilled) {
    showMessage('Заполните обязательные размеры.', true)
    return
  }

  // Merge dimensions — remove legacy keys
  attrs.dimensions = {
    ...(attrs.dimensions || {}),
    ...Object.fromEntries(Object.entries(dims).filter(([, v]) => v !== null)),
  }
  for (const k of ['length_cm', 'width_cm', 'height_cm', 'weight_kg']) {
    delete attrs.dimensions[k]
  }

  // Purchase price
  const ppVal = parseFloat(form.purchase_price)
  if (Number.isFinite(ppVal) && ppVal > 0) {
    attrs.purchase = { price: ppVal, currency: form.purchase_currency || 'CNY' }
  } else {
    delete attrs.purchase
  }

  const payload = {
    sku: form.sku.trim() || null,
    title: form.title.trim(),
    brand: form.brand.trim() || null,
    status: form.status.trim() || 'draft',
    ozon_product_id: form.ozon_product_id.trim() || null,
    ozon_offer_id: form.ozon_offer_id.trim() || null,
    description: form.description.trim() || null,
    attributes: attrs,
  }

  isSaving.value = true
  try {
    await cardDetailStore.updateCard(cardId, payload)
    showMessage('Карточка сохранена')
    // Reload detail
    cardDetailStore.clearDetail()
    await cardDetailStore.loadCardPage(cardId)
  } catch (err: any) {
    showMessage(`Ошибка: ${err.message}`, true)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="space-y-6 py-4">
    <form @submit.prevent="onSave">
      <!-- Basic fields -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">SKU</label>
          <input v-model="form.sku" type="text" class="form-input" placeholder="Артикул" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Название</label>
          <input v-model="form.title" type="text" class="form-input" placeholder="Название товара" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Бренд</label>
          <input v-model="form.brand" type="text" class="form-input" placeholder="Бренд" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Статус</label>
          <select v-model="form.status" class="form-input">
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="archived">archived</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Ozon Product ID</label>
          <input v-model="form.ozon_product_id" type="text" class="form-input" placeholder="Product ID" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Ozon Offer ID</label>
          <input v-model="form.ozon_offer_id" type="text" class="form-input" placeholder="Offer ID" />
        </div>
      </div>

      <div class="mt-4">
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Описание</label>
        <textarea v-model="form.description" class="form-input" rows="3" placeholder="Описание товара" />
      </div>

      <!-- Dimensions -->
      <div class="mt-6">
        <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Габариты упаковки</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label class="block text-xs font-medium text-slate-500 dark:text-slate-400">Длина (см)</label>
            <input
              v-model="form.package_length_cm"
              type="number"
              step="0.1"
              min="0"
              class="form-input"
              placeholder="0"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 dark:text-slate-400">Ширина (см)</label>
            <input
              v-model="form.package_width_cm"
              type="number"
              step="0.1"
              min="0"
              class="form-input"
              placeholder="0"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 dark:text-slate-400">Высота (см)</label>
            <input
              v-model="form.package_height_cm"
              type="number"
              step="0.1"
              min="0"
              class="form-input"
              placeholder="0"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 dark:text-slate-400">Вес (кг)</label>
            <input
              v-model="form.package_weight_kg"
              type="number"
              step="0.001"
              min="0"
              class="form-input"
              placeholder="0"
            />
          </div>
        </div>
      </div>

      <!-- Purchase price -->
      <div class="mt-6">
        <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Закупочная цена</h3>
        <div class="flex gap-3 items-end">
          <div class="flex-1 max-w-[200px]">
            <label class="block text-xs font-medium text-slate-500 dark:text-slate-400">Цена</label>
            <input
              v-model="form.purchase_price"
              type="number"
              step="0.01"
              min="0"
              class="form-input"
              placeholder="0.00"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 dark:text-slate-400">Валюта</label>
            <select v-model="form.purchase_currency" class="form-input">
              <option value="CNY">CNY</option>
              <option value="RUB">RUB</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Status message -->
      <p
        v-if="statusMessage"
        class="mt-3 text-sm"
        :class="statusError ? 'text-red-500' : 'text-green-600'"
      >
        {{ statusMessage }}
      </p>

      <!-- Save button -->
      <div class="mt-6">
        <button
          type="submit"
          class="px-6 py-2.5 text-sm font-medium text-white bg-sky-500 rounded-lg hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="isSaving"
        >
          {{ isSaving ? 'Сохранение...' : 'Сохранить' }}
        </button>
      </div>
    </form>

    <!-- Sources list -->
    <CardSourcesList :card-id="cardId" />
  </div>
</template>
