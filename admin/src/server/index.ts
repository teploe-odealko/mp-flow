import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { createApp } from "./app.js"
import { initORM, closeORM } from "./core/mikro-orm.js"
import { createAppContainer, asValue } from "./core/container.js"
import { loadPlugins } from "./core/plugin-loader.js"
import { stopAllJobs, setSchedulerContainer } from "./core/scheduler.js"
import { MasterCard } from "./modules/master-card/entity.js"
import { MasterCardService } from "./modules/master-card/service.js"
import { SupplierOrder, SupplierOrderItem, Supplier } from "./modules/supplier-order/entities.js"
import { SupplierOrderService } from "./modules/supplier-order/service.js"
import { FinanceTransaction } from "./modules/finance/entity.js"
import { FinanceService } from "./modules/finance/service.js"
import { Sale } from "./modules/sale/entity.js"
import { SaleService } from "./modules/sale/service.js"
import catalogRoutes from "./routes/catalog.js"
import suppliersRoutes from "./routes/suppliers.js"
import suppliersRegistryRoutes from "./routes/suppliers-registry.js"
import salesRoutes from "./routes/sales.js"
import financeRoutes from "./routes/finance.js"
import inventoryRoutes from "./routes/inventory.js"
import analyticsRoutes from "./routes/analytics.js"
import authRoutes from "./routes/auth.js"

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://mpflow:mpflow@localhost:5432/mpflow"
const COOKIE_SECRET = process.env.COOKIE_SECRET || "mpflow-dev-secret-change-in-production"
const PORT = Number(process.env.PORT) || 3000

async function main() {
  console.log("[mpflow] Starting admin server...")

  // Initialize ORM with core entities (plugin entities added after load)
  const coreEntities = [MasterCard, SupplierOrder, SupplierOrderItem, Supplier, FinanceTransaction, Sale]

  const orm = await initORM({
    url: DATABASE_URL,
    entities: coreEntities,
    migrations: {
      path: "./dist/src/server/migrations",
      pathTs: "./src/server/migrations",
    },
  })

  console.log("[mpflow] ORM connected")

  // Run pending migrations
  try {
    const migrator = orm.getMigrator()
    const pending = await migrator.getPendingMigrations()
    if (pending.length > 0) {
      console.log(`[mpflow] Running ${pending.length} pending migration(s)...`)
      await migrator.up()
      console.log("[mpflow] Migrations complete")
    } else {
      console.log("[mpflow] No pending migrations")
    }
  } catch (err) {
    console.error("[mpflow] Migration error:", err)
  }

  // Create DI container
  const container = createAppContainer(orm, {
    database: { url: DATABASE_URL },
    auth: { cookieSecret: COOKIE_SECRET },
    plugins: [{ resolve: "./plugins/ozon" }],
  })

  // Register EntityManager and core services
  const em = orm.em.fork()
  container.register({
    em: asValue(em),
    masterCardService: asValue(new MasterCardService(em)),
    supplierOrderService: asValue(new SupplierOrderService(em)),
    financeService: asValue(new FinanceService(em)),
    saleService: asValue(new SaleService(em)),
  })

  // Create Hono app
  const app = createApp(COOKIE_SECRET)

  // Inject container + ORM into context
  app.use("*", async (c, next) => {
    c.set("container", container)
    c.set("orm", orm)
    await next()
  })

  // Load plugins (entities, services, routes, middleware, jobs)
  setSchedulerContainer(container)
  const pluginResult = await loadPlugins(
    [{ resolve: "./plugins/ozon" }],
    app,
    container,
    orm,
  )

  // Register plugin entities with ORM discovery
  if (pluginResult.entities.length > 0) {
    console.log(`[mpflow] Registered ${pluginResult.entities.length} plugin entities`)
  }

  // Register core routes
  app.route("/api/catalog", catalogRoutes)
  app.route("/api/suppliers", suppliersRoutes)
  app.route("/api/suppliers-registry", suppliersRegistryRoutes)
  app.route("/api/sales", salesRoutes)
  app.route("/api/finance", financeRoutes)
  app.route("/api/inventory", inventoryRoutes)
  app.route("/api/analytics", analyticsRoutes)
  app.route("/auth", authRoutes)

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok", time: new Date().toISOString() }))

  // Serve static frontend (production)
  if (process.env.NODE_ENV === "production") {
    app.use("/*", serveStatic({ root: "./dist/client" }))
    // SPA fallback
    app.get("/*", serveStatic({ path: "./dist/client/index.html" }))
  }

  // Start server
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`[mpflow] Admin server running on http://localhost:${PORT}`)
  })

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[mpflow] Shutting down...")
    stopAllJobs()
    await closeORM()
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

main().catch((err) => {
  console.error("[mpflow] Fatal error:", err)
  process.exit(1)
})
