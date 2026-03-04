import type { ApiTool } from "../../../../src/server/mcp/tools.js"

export const mcpTools: ApiTool[] = [
  {
    name: "ali1688_preview",
    description:
      "Получить превью товара с 1688.com по URL. Возвращает название, цены, SKU-варианты, фото. " +
      "Тарифицируется: 1 токен за вызов.",
    method: "POST",
    path: "/api/ali1688/preview",
    params: {
      url: {
        type: "string",
        description: "URL товара на 1688.com (напр. https://detail.1688.com/offer/...)",
        required: true,
        in: "body",
      },
    },
  },
  {
    name: "ali1688_link",
    description:
      "Привязать товар из каталога к товару на 1688.com. Сначала используй ali1688_preview для получения данных, " +
      "затем этот инструмент для сохранения привязки. Также обновляет закупочные цены в мастер-карточке.",
    method: "POST",
    path: "/api/ali1688/link",
    params: {
      master_card_id: {
        type: "string",
        description: "ID мастер-карточки товара",
        required: true,
        in: "body",
      },
      url: {
        type: "string",
        description: "URL товара на 1688",
        required: true,
        in: "body",
      },
      item_id: {
        type: "string",
        description: "ID товара на 1688",
        required: true,
        in: "body",
      },
      sku_id: {
        type: "string",
        description: "ID выбранного SKU-варианта",
        in: "body",
      },
      sku_name: {
        type: "string",
        description: "Название SKU-варианта",
        in: "body",
      },
      sku_image: {
        type: "string",
        description: "URL изображения SKU",
        in: "body",
      },
      sku_price: {
        type: "number",
        description: "Цена выбранного SKU (CNY)",
        in: "body",
      },
      supplier_name: {
        type: "string",
        description: "Название поставщика",
        in: "body",
      },
      title: {
        type: "string",
        description: "Название товара на 1688",
        in: "body",
      },
      images: {
        type: "object",
        description: "Массив URL изображений товара",
        in: "body",
      },
      price_tiers: {
        type: "object",
        description: "Ценовые пороги [{min_qty, price}]",
        in: "body",
      },
      currency: {
        type: "string",
        description: "Валюта (по умолчанию CNY)",
        in: "body",
      },
      raw_data: {
        type: "object",
        description: "Полные данные из превью (необязательно)",
        in: "body",
      },
    },
  },
  {
    name: "ali1688_unlink",
    description: "Отвязать товар от поставщика на 1688.com",
    method: "DELETE",
    path: "/api/ali1688/link/:id",
    params: {
      id: {
        type: "string",
        description: "ID привязки (не master_card_id, а id самой привязки)",
        required: true,
        in: "path",
      },
    },
  },
  {
    name: "ali1688_refresh",
    description:
      "Обновить цены привязанного товара с 1688.com. Загружает свежие данные, сохраняет обновлённые цены. " +
      "Тарифицируется: 1 токен за вызов.",
    method: "POST",
    path: "/api/ali1688/refresh/:masterCardId",
    params: {
      masterCardId: {
        type: "string",
        description: "ID мастер-карточки товара",
        required: true,
        in: "path",
      },
    },
  },
]
