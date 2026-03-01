import { definePlugin } from "../../src/server/core/plugin-loader.js"
import { OzonAccount, OzonProductLink, OzonStockSnapshot } from "./src/modules/ozon-integration/entities.js"
import { OzonIntegrationService } from "./src/modules/ozon-integration/service.js"
import ozonAccountsRoutes from "./src/routes/ozon-accounts.js"
import ozonSyncRoutes from "./src/routes/ozon-sync.js"
import { ozonCatalogEnrichment } from "./src/middleware/catalog-enrichment.js"
import { ozonInventoryEnrichment } from "./src/middleware/inventory-enrichment.js"
import { asClass, Lifetime } from "awilix"

export default definePlugin({
  name: "mpflow-plugin-ozon",
  label: "Ozon",
  description: "Интеграция с маркетплейсом Ozon (FBO)",
  apiPrefixes: ["/api/ozon-accounts", "/api/ozon-sync"],

  entities: [OzonAccount, OzonProductLink, OzonStockSnapshot],

  services: {
    ozonService: asClass(OzonIntegrationService, { lifetime: Lifetime.SCOPED }),
  },

  routes: (app, _container) => {
    app.route("/api/ozon-accounts", ozonAccountsRoutes)
    app.route("/api/ozon-sync", ozonSyncRoutes)
  },

  middleware: [
    { path: "/api/catalog", method: "GET", handler: ozonCatalogEnrichment },
    { path: "/api/catalog/*", method: "GET", handler: ozonCatalogEnrichment },
    { path: "/api/inventory", method: "GET", handler: ozonInventoryEnrichment },
    { path: "/api/inventory/*", method: "GET", handler: ozonInventoryEnrichment },
  ],

  jobs: [
    {
      name: "sync-ozon-products",
      schedule: "0 */2 * * *", // every 2 hours
      handler: async (container) => {
        const { syncOzonProducts } = await import("./src/workflows/sync-ozon-products.js")
        const ozonService: OzonIntegrationService = container.resolve("ozonService")
        const accounts = await ozonService.listOzonAccounts({ is_active: true, auto_sync: true })
        for (const account of accounts) {
          try {
            await syncOzonProducts(container, account.id)
          } catch (err: any) {
            console.error(`[sync-ozon-products] Failed for ${account.name}:`, err.message)
            await ozonService.updateOzonAccount(account.id, { last_error: err.message })
          }
        }
      },
    },
    {
      name: "sync-ozon-stocks",
      schedule: "*/30 * * * *", // every 30 minutes
      handler: async (container) => {
        const { syncOzonStocks } = await import("./src/workflows/sync-ozon-stocks.js")
        const ozonService: OzonIntegrationService = container.resolve("ozonService")
        const accounts = await ozonService.listOzonAccounts({ is_active: true, auto_sync: true })
        for (const account of accounts) {
          try {
            await syncOzonStocks(container, account.id)
          } catch (err: any) {
            console.error(`[sync-ozon-stocks] Failed for ${account.name}:`, err.message)
            await ozonService.updateOzonAccount(account.id, { last_error: err.message })
          }
        }
      },
    },
    {
      name: "sync-ozon-sales",
      schedule: "0 */1 * * *", // every hour
      handler: async (container) => {
        const { syncOzonSales } = await import("./src/workflows/sync-ozon-sales.js")
        const ozonService: OzonIntegrationService = container.resolve("ozonService")
        const accounts = await ozonService.listOzonAccounts({ is_active: true, auto_sync: true })
        for (const account of accounts) {
          try {
            await syncOzonSales(container, account.id)
          } catch (err: any) {
            console.error(`[sync-ozon-sales] Failed for ${account.name}:`, err.message)
            await ozonService.updateOzonAccount(account.id, { last_error: err.message })
          }
        }
      },
    },
  ],
})
