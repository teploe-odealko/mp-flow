import { definePlugin } from "../../src/server/core/plugin-loader.js"

export default definePlugin({
  name: "mpflow-plugin-ali1688",
  label: "1688",
  description: "Привязка товаров к поставщикам на 1688.com, обновление закупочных цен в юанях, выгрузка заявки поставщику в формате XLSX.",
  docsUrl: "https://docs.mp-flow.ru/docs/plugins/ali1688",
})
