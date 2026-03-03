import type { PluginBilling } from "../../../src/server/core/plugin-loader.js"

export const billing: PluginBilling = {
  operations: [
    {
      name: "tmapi_item_detail",
      description: "Поиск товара на 1688.com",
      creditCost: 1,
    },
  ],
}
