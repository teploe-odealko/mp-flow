import { definePlugin } from "../../src/server/core/plugin-loader.js"

export default definePlugin({
  name: "mpflow-plugin-ozon",
  label: "Ozon",
  description: "Синхронизация товаров, остатков, продаж и финансов с Ozon в MPFlow. Управление магазином через AI-агента по MCP протоколу.",
  docsUrl: "https://docs.mp-flow.ru/docs/plugins/ozon",
})
