import type { ApiTool } from "../../../../src/server/mcp/tools.js"

export const mcpTools: ApiTool[] = [
  {
    name: "photostudio_get_context",
    description: "Собрать ВСЕ данные о товаре для фото-студии: карточка, фото Ozon, фото 1688, существующие проекты. Используй перед началом работы.",
    method: "GET",
    path: "/api/photo-studio/context/:masterCardId",
    params: {
      masterCardId: { type: "string", description: "ID мастер-карточки товара", required: true, in: "path" },
    },
  },
  {
    name: "photostudio_create_project",
    description: "Создать проект фото-студии для мастер-карточки",
    method: "POST",
    path: "/api/photo-studio",
    params: {
      master_card_id: { type: "string", description: "ID мастер-карточки", required: true, in: "body" },
    },
  },
  {
    name: "photostudio_get_project",
    description: "Получить проект фото-студии со всеми фреймами, статусами и фидбеком",
    method: "GET",
    path: "/api/photo-studio/:id",
    params: {
      id: { type: "string", description: "ID проекта", required: true, in: "path" },
    },
  },
  {
    name: "photostudio_save_research",
    description: "Сохранить результаты ресерча: боли покупателей, преимущества товара, инсайты конкурентов",
    method: "POST",
    path: "/api/photo-studio/:id/research",
    params: {
      id: { type: "string", description: "ID проекта", required: true, in: "path" },
      product_title: { type: "string", description: "Название товара", in: "body" },
      product_description: { type: "string", description: "Описание товара", in: "body" },
      buyer_pain_points: { type: "object", description: "Массив болей покупателей", in: "body" },
      competitor_insights: { type: "object", description: "Массив инсайтов о конкурентах", in: "body" },
      key_selling_points: { type: "object", description: "Массив ключевых преимуществ", in: "body" },
    },
  },
  {
    name: "photostudio_save_plan",
    description: "Сохранить план фреймов (концепции фотографий). Минимум 8 фреймов для карточки маркетплейса.",
    method: "POST",
    path: "/api/photo-studio/:id/plan",
    params: {
      id: { type: "string", description: "ID проекта", required: true, in: "path" },
      frames: { type: "object", description: "Массив [{concept: 'описание концепции фото', source_images?: ['url1', ...]}]", required: true, in: "body" },
    },
  },
  {
    name: "photostudio_add_source_image",
    description: "Добавить исходное фото в проект. Сначала загрузи файл через upload_file, потом привяжи file_id к проекту.",
    method: "POST",
    path: "/api/photo-studio/:id/source-images",
    params: {
      id: { type: "string", description: "ID проекта", required: true, in: "path" },
      file_id: { type: "string", description: "ID файла из file storage", required: true, in: "body" },
    },
  },
  {
    name: "photostudio_remove_source_image",
    description: "Убрать исходное фото из проекта (также уберёт его из фреймов)",
    method: "DELETE",
    path: "/api/photo-studio/:id/source-images/:fileId",
    params: {
      id: { type: "string", description: "ID проекта", required: true, in: "path" },
      fileId: { type: "string", description: "ID файла для удаления", required: true, in: "path" },
    },
  },
  {
    name: "photostudio_set_frame_sources",
    description: "Назначить исходные фото для конкретного фрейма. Можно 0 фото (полностью генерируемый кадр) или несколько.",
    method: "POST",
    path: "/api/photo-studio/:id/frames/:index/source-images",
    params: {
      id: { type: "string", description: "ID проекта", required: true, in: "path" },
      index: { type: "number", description: "Индекс фрейма (0-based)", required: true, in: "path" },
      file_ids: { type: "object", description: "Массив ID файлов для этого фрейма (пустой массив = без фото)", required: true, in: "body" },
    },
  },
  {
    name: "photostudio_save_style_config",
    description: "Сохранить настройки единого стиля проекта: цветовая схема, акценты, типографика, настроение. SVG-превью должны следовать этим настройкам.",
    method: "POST",
    path: "/api/photo-studio/:id/style-config",
    params: {
      id: { type: "string", description: "ID проекта", required: true, in: "path" },
      color_scheme: { type: "string", description: "Цветовая схема: тёмная, светлая, яркая", in: "body" },
      accent_colors: { type: "object", description: "Массив HEX акцентных цветов", in: "body" },
      typography: { type: "string", description: "Стиль типографики", in: "body" },
      layout_style: { type: "string", description: "Стиль компоновки: с рамками, полный кадр, коллаж", in: "body" },
      mood: { type: "string", description: "Настроение: весёлый, премиальный, детский и т.д.", in: "body" },
      notes: { type: "string", description: "Дополнительные заметки по стилю", in: "body" },
    },
  },
  {
    name: "photostudio_save_frame_svg",
    description: "Сохранить SVG-превью для фрейма. SVG должен быть 900×1200px (формат Ozon). Показывает расположение элементов, текст, инфографику.",
    method: "POST",
    path: "/api/photo-studio/:id/frames/:index/svg",
    params: {
      id: { type: "string", description: "ID проекта", required: true, in: "path" },
      index: { type: "number", description: "Индекс фрейма (0-based)", required: true, in: "path" },
      svg_content: { type: "string", description: "SVG XML код", required: true, in: "body" },
    },
  },
  {
    name: "photostudio_approve_frame",
    description: "Одобрить SVG-превью фрейма (вызывается пользователем через UI или агентом)",
    method: "POST",
    path: "/api/photo-studio/:id/frames/:index/approve",
    params: {
      id: { type: "string", description: "ID проекта", required: true, in: "path" },
      index: { type: "number", description: "Индекс фрейма", required: true, in: "path" },
    },
  },
  {
    name: "photostudio_feedback_frame",
    description: "Отправить фидбек на SVG-превью фрейма для переработки",
    method: "POST",
    path: "/api/photo-studio/:id/frames/:index/feedback",
    params: {
      id: { type: "string", description: "ID проекта", required: true, in: "path" },
      index: { type: "number", description: "Индекс фрейма", required: true, in: "path" },
      feedback: { type: "string", description: "Текст фидбека", required: true, in: "body" },
    },
  },
  {
    name: "photostudio_save_generated",
    description: "Привязать сгенерированное изображение к фрейму. Сначала используй generate_image для генерации, потом этот инструмент.",
    method: "POST",
    path: "/api/photo-studio/:id/frames/:index/generated",
    params: {
      id: { type: "string", description: "ID проекта", required: true, in: "path" },
      index: { type: "number", description: "Индекс фрейма", required: true, in: "path" },
      file_id: { type: "string", description: "ID файла из file storage", required: true, in: "body" },
    },
  },
  {
    name: "photostudio_request_regen",
    description: "Запросить перегенерацию изображения для фрейма с указанием фидбека",
    method: "POST",
    path: "/api/photo-studio/:id/frames/:index/regen",
    params: {
      id: { type: "string", description: "ID проекта", required: true, in: "path" },
      index: { type: "number", description: "Индекс фрейма", required: true, in: "path" },
      feedback: { type: "string", description: "Что нужно изменить", required: true, in: "body" },
    },
  },
]
