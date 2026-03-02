import { definePlugin } from "../../src/server/core/plugin-loader.js"
import { OzonAccount, OzonProductLink, OzonStockSnapshot } from "./src/modules/ozon-integration/entities.js"
import { OzonIntegrationService } from "./src/modules/ozon-integration/service.js"
import ozonAccountsRoutes from "./src/routes/ozon-accounts.js"
import ozonSyncRoutes from "./src/routes/ozon-sync.js"
import { ozonCatalogEnrichment } from "./src/middleware/catalog-enrichment.js"
import { ozonInventoryEnrichment } from "./src/middleware/inventory-enrichment.js"
import { ozonProcurementEnrichment } from "./src/middleware/procurement-enrichment.js"
import { asClass, Lifetime, InjectionMode } from "awilix"

export default definePlugin({
  name: "mpflow-plugin-ozon",
  label: "Ozon",
  description: "Интеграция с маркетплейсом Ozon (FBO)",
  apiPrefixes: ["/api/ozon-accounts", "/api/ozon-sync"],
  adminNav: [{ path: "/ozon", label: "Ozon" }],

  entities: [OzonAccount, OzonProductLink, OzonStockSnapshot],

  services: {
    ozonService: asClass(OzonIntegrationService, { lifetime: Lifetime.SCOPED, injectionMode: InjectionMode.CLASSIC }),
  },

  routes: (app, _container) => {
    app.route("/api/ozon-accounts", ozonAccountsRoutes)
    app.route("/api/ozon-sync", ozonSyncRoutes)
  },

  columnDocs: [
    {
      pageId: "warehouse",
      columnKey: "stock_total",
      pluginLabel: "Ozon",
      description: "Остатки со складов Ozon FBO (present), без учёта зарезервированных. Данные из раздела [Управление остатками](https://seller.ozon.ru/app/fbo-stocks/stocks-management) личного кабинета Ozon.",
    },
    {
      pageId: "warehouse",
      columnKey: "sold_total",
      pluginLabel: "Ozon",
      description: "Доставленные заказы из [FBO-отправлений](https://seller.ozon.ru/app/postings/fbo) минус [возвраты](https://seller.ozon.ru/app/returns/supply/common) после успешной доставки.",
    },
    {
      pageId: "warehouse",
      columnKey: "delivering_total",
      pluginLabel: "Ozon",
      description: "Сумма [FBO-отправлений](https://seller.ozon.ru/app/postings/fbo) в статусах «Ожидает сборки», «Готов к отгрузке» и «Доставляется».",
    },
    {
      pageId: "catalog",
      columnKey: "stock",
      pluginLabel: "Ozon",
      description: "Для привязанных товаров отображается остаток FBO из раздела [Управление остатками](https://seller.ozon.ru/app/fbo-stocks/stocks-management).",
    },
  ],

  middleware: [
    { path: "/api/catalog", method: "GET", handler: ozonCatalogEnrichment },
    { path: "/api/catalog/*", method: "GET", handler: ozonCatalogEnrichment },
    { path: "/api/inventory", method: "GET", handler: ozonInventoryEnrichment },
    { path: "/api/inventory/*", method: "GET", handler: ozonInventoryEnrichment },
    { path: "/api/procurement", method: "GET", handler: ozonProcurementEnrichment },
  ],
})
