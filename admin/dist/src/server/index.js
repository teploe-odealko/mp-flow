import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { initORM, closeORM } from "./core/mikro-orm.js";
import { createAppContainer } from "./core/container.js";
import { createRequestScope } from "./core/request-scope.js";
import { collectPluginEntities, loadPlugins, getLoadedPlugins } from "./core/plugin-loader.js";
import { stopAllJobs, setSchedulerContext } from "./core/scheduler.js";
import { MasterCard } from "./modules/master-card/entity.js";
import { SupplierOrder, SupplierOrderItem, Supplier } from "./modules/supplier-order/entities.js";
import { FinanceTransaction } from "./modules/finance/entity.js";
import { Sale } from "./modules/sale/entity.js";
import { PluginSetting } from "./modules/plugin-setting/entity.js";
import catalogRoutes from "./routes/catalog.js";
import suppliersRoutes from "./routes/suppliers.js";
import suppliersRegistryRoutes from "./routes/suppliers-registry.js";
import salesRoutes from "./routes/sales.js";
import financeRoutes from "./routes/finance.js";
import inventoryRoutes from "./routes/inventory.js";
import analyticsRoutes from "./routes/analytics.js";
import authRoutes from "./routes/auth.js";
import pluginsRoutes from "./routes/plugins.js";
import { getSession } from "./core/session.js";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://mpflow:mpflow@localhost:5432/mpflow";
const PORT = Number(process.env.PORT) || 3000;
if (!process.env.COOKIE_SECRET) {
    throw new Error("COOKIE_SECRET env var is required. Set it to a random 32+ char string.");
}
const COOKIE_SECRET = process.env.COOKIE_SECRET;
async function main() {
    console.log("[mpflow] Starting admin server...");
    // Collect ALL entities (core + plugins) before ORM init
    const coreEntities = [MasterCard, SupplierOrder, SupplierOrderItem, Supplier, FinanceTransaction, Sale, PluginSetting];
    const pluginPaths = [{ resolve: "./plugins/ozon" }];
    const pluginEntities = await collectPluginEntities(pluginPaths);
    const allEntities = [...coreEntities, ...pluginEntities];
    if (pluginEntities.length > 0) {
        console.log(`[mpflow] Collected ${pluginEntities.length} plugin entities`);
    }
    const orm = await initORM({
        url: DATABASE_URL,
        entities: allEntities,
        migrations: {
            path: "./dist/src/server/migrations",
            pathTs: "./src/server/migrations",
            glob: "Migration_*.{js,ts}",
        },
    });
    console.log("[mpflow] ORM connected");
    // Run pending migrations
    try {
        const migrator = orm.getMigrator();
        const pending = await migrator.getPendingMigrations();
        if (pending.length > 0) {
            console.log(`[mpflow] Running ${pending.length} pending migration(s)...`);
            await migrator.up();
            console.log("[mpflow] Migrations complete");
        }
        else {
            console.log("[mpflow] No pending migrations");
        }
    }
    catch (err) {
        console.error("[mpflow] Migration error:", err);
    }
    // Auto-apply safe schema changes from plugin entities (create tables, add columns — no drops)
    try {
        const generator = orm.getSchemaGenerator();
        const diff = await generator.getUpdateSchemaSQL({ safe: true, wrap: false });
        if (diff.trim()) {
            console.log("[mpflow] Applying auto-schema updates for plugin entities...");
            await generator.updateSchema({ safe: true, wrap: false });
            console.log("[mpflow] Schema updated");
        }
    }
    catch (err) {
        console.error("[mpflow] Schema update error:", err);
    }
    // Create DI container
    const container = createAppContainer(orm, {
        database: { url: DATABASE_URL },
        auth: { cookieSecret: COOKIE_SECRET },
        plugins: [{ resolve: "./plugins/ozon" }],
    });
    // Create Hono app
    const app = createApp(COOKIE_SECRET);
    // Request-scoped middleware: each request gets fresh EM + services
    app.use("/api/*", async (c, next) => {
        const { scope, em } = createRequestScope(container, orm);
        c.set("container", scope);
        c.set("orm", orm);
        await next();
        em.clear();
    });
    app.use("/auth/*", async (c, next) => {
        c.set("orm", orm);
        await next();
    });
    // Middleware: block API requests to disabled plugins
    app.use("/api/*", async (c, next) => {
        const session = getSession(c);
        const userId = session.userId;
        if (!userId)
            return next();
        const path = c.req.path;
        const loaded = getLoadedPlugins();
        for (const plugin of loaded) {
            if (plugin.apiPrefixes?.some((prefix) => path.startsWith(prefix))) {
                const settingService = c.get("container").resolve("pluginSettingService");
                const enabled = await settingService.isPluginEnabled(plugin.name, userId);
                if (!enabled) {
                    return c.json({ error: "Plugin disabled" }, 403);
                }
                break;
            }
        }
        await next();
    });
    // Load plugins (services, routes, middleware, jobs — entities already registered)
    setSchedulerContext(container, orm);
    await loadPlugins(pluginPaths, app, container, orm);
    // Register core routes
    app.route("/api/catalog", catalogRoutes);
    app.route("/api/suppliers", suppliersRoutes);
    app.route("/api/suppliers-registry", suppliersRegistryRoutes);
    app.route("/api/sales", salesRoutes);
    app.route("/api/finance", financeRoutes);
    app.route("/api/inventory", inventoryRoutes);
    app.route("/api/analytics", analyticsRoutes);
    app.route("/api/plugins", pluginsRoutes);
    app.route("/auth", authRoutes);
    // Health check
    app.get("/api/health", (c) => c.json({ status: "ok", time: new Date().toISOString() }));
    // Serve static frontend (production)
    if (process.env.NODE_ENV === "production") {
        app.use("/*", serveStatic({ root: "./dist/client" }));
        // SPA fallback
        app.get("/*", serveStatic({ path: "./dist/client/index.html" }));
    }
    // Start server
    serve({ fetch: app.fetch, port: PORT }, () => {
        console.log(`[mpflow] Admin server running on http://localhost:${PORT}`);
    });
    // Graceful shutdown
    const shutdown = async () => {
        console.log("[mpflow] Shutting down...");
        stopAllJobs();
        await closeORM();
        process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}
main().catch((err) => {
    console.error("[mpflow] Fatal error:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map