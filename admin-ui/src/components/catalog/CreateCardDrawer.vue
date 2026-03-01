<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useCatalogStore } from '@/stores/catalog'
import BaseDrawer from '@/components/shared/BaseDrawer.vue'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  created: []
}>()

const catalogStore = useCatalogStore()

const form = reactive({
  title: '',
  sku: '',
  brand: '',
  ozon_offer_id: '',
  description: '',
})

const isSaving = ref(false)

async function onSubmit() {
  if (!form.title.trim()) return
  isSaving.value = true
  try {
    await catalogStore.createCard({
      title: form.title.trim(),
      sku: form.sku.trim() || null,
      ozon_offer_id: form.ozon_offer_id.trim() || null,
      brand: form.brand.trim() || null,
      description: form.description.trim() || null,
    })
    // Reset form
    form.title = ''
    form.sku = ''
    form.brand = ''
    form.ozon_offer_id = ''
    form.description = ''
    emit('created')
    emit('close')
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <BaseDrawer :open="open" @close="$emit('close')">
    <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
      <h2 class="text-lg font-semibold text-slate-900 dark:text-white">Новая карточка</h2>
      <button
        class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        @click="$emit('close')"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <form class="flex-1 overflow-y-auto px-6 py-4 space-y-4" @submit.prevent="onSubmit">
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Название <span class="text-red-500">*</span>
        </label>
        <input
          v-model="form.title"
          type="text"
          class="form-input"
          placeholder="Название товара"
          required
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">SKU</label>
        <input
          v-model="form.sku"
          type="text"
          class="form-input"
          placeholder="Артикул"
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Бренд</label>
        <input
          v-model="form.brand"
          type="text"
          class="form-input"
          placeholder="Бренд"
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Ozon Offer ID</label>
        <input
          v-model="form.ozon_offer_id"
          type="text"
          class="form-input"
          placeholder="Offer ID"
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Описание</label>
        <textarea
          v-model="form.description"
          class="form-input"
          rows="3"
          placeholder="Описание товара"
        />
      </div>

      <div class="pt-2">
        <button
          type="submit"
          class="w-full px-4 py-2.5 text-sm font-medium text-white bg-sky-500 rounded-lg hover:bg-sky-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!form.title.trim() || isSaving"
        >
          {{ isSaving ? 'Создание...' : 'Создать карточку' }}
        </button>
      </div>
    </form>
  </BaseDrawer>
</template>
