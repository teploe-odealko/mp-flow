import { scheduleJob } from "./scheduler.js";
const loadedPlugins = new Map();
export function getLoadedPlugins() {
    return Array.from(loadedPlugins.values());
}
export function definePlugin(def) {
    return def;
}
async function resolvePluginPath(resolve) {
    if (resolve.startsWith(".")) {
        const pluginName = resolve.replace(/^\.\/plugins\//, "");
        const distPath = `${process.cwd()}/dist/plugins/${pluginName}/plugin.js`;
        const srcPath = `${process.cwd()}/plugins/${pluginName}/plugin.ts`;
        try {
            await import(distPath);
            return distPath;
        }
        catch {
            return srcPath;
        }
    }
    return resolve;
}
/**
 * Collect entities from plugins WITHOUT loading routes/middleware/jobs.
 * Used before ORM init so all entities are registered in metadata.
 */
export async function collectPluginEntities(pluginPaths) {
    const allEntities = [];
    for (const pluginRef of pluginPaths) {
        try {
            const pluginPath = await resolvePluginPath(pluginRef.resolve);
            const mod = await import(pluginPath);
            const plugin = mod.default || mod;
            if (plugin.entities)
                allEntities.push(...plugin.entities);
        }
        catch (err) {
            console.error(`[plugin] Failed to collect entities from ${pluginRef.resolve}:`, err);
        }
    }
    return allEntities;
}
export async function loadPlugins(pluginPaths, app, container, _orm) {
    const allEntities = [];
    for (const pluginRef of pluginPaths) {
        try {
            const pluginPath = await resolvePluginPath(pluginRef.resolve);
            const mod = await import(pluginPath);
            const plugin = mod.default || mod;
            console.log(`[plugin] Loading: ${plugin.name}`);
            // Register in plugin registry
            loadedPlugins.set(plugin.name, plugin);
            // Collect entities
            if (plugin.entities) {
                allEntities.push(...plugin.entities);
            }
            // Register services in container (accepts awilix resolvers or raw values)
            if (plugin.services) {
                const registrations = {};
                for (const [name, svc] of Object.entries(plugin.services)) {
                    registrations[name] = svc;
                }
                container.register(registrations);
            }
            // Register routes
            if (plugin.routes) {
                plugin.routes(app, container);
            }
            // Register middleware
            if (plugin.middleware) {
                for (const mw of plugin.middleware) {
                    const method = mw.method.toLowerCase();
                    if (method === "all") {
                        app.use(mw.path, mw.handler);
                    }
                    else {
                        app.use(mw.path, async (c, next) => {
                            if (c.req.method === mw.method) {
                                return mw.handler(c, next);
                            }
                            await next();
                        });
                    }
                }
            }
            // Schedule jobs
            if (plugin.jobs) {
                for (const job of plugin.jobs) {
                    scheduleJob(job, plugin.name);
                }
            }
            console.log(`[plugin] Loaded: ${plugin.name}`);
        }
        catch (err) {
            console.error(`[plugin] Failed to load ${pluginRef.resolve}:`, err);
        }
    }
    return { entities: allEntities };
}
//# sourceMappingURL=plugin-loader.js.map