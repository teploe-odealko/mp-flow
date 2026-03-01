import { Hono } from "hono";
import { getUserId } from "../core/auth.js";
import { getLoadedPlugins } from "../core/plugin-loader.js";
import { stopJobsByPlugin, startJobsByPlugin } from "../core/scheduler.js";
import { execSync } from "child_process";
const plugins = new Hono();
// GET /api/plugins — list all loaded plugins with enabled/disabled state
plugins.get("/", async (c) => {
    const userId = getUserId(c);
    const settingService = c.get("container").resolve("pluginSettingService");
    const loaded = getLoadedPlugins();
    const settings = await settingService.listByUser(userId);
    const settingsMap = new Map(settings.map((s) => [s.plugin_name, s.is_enabled]));
    const list = loaded.map((p) => ({
        name: p.name,
        label: p.label,
        description: p.description || "",
        is_enabled: settingsMap.get(p.name) ?? true,
        adminNav: p.adminNav || [],
        apiPrefixes: p.apiPrefixes || [],
    }));
    const mode = process.env.MPFLOW_CLOUD === "true" ? "cloud" : "selfhosted";
    return c.json({ plugins: list, mode });
});
// POST /api/plugins/:name/toggle — enable/disable a plugin for the current user
plugins.post("/:name/toggle", async (c) => {
    const userId = getUserId(c);
    const pluginName = c.req.param("name");
    const { is_enabled } = await c.req.json();
    // Verify plugin exists
    const loaded = getLoadedPlugins();
    const plugin = loaded.find((p) => p.name === pluginName);
    if (!plugin) {
        return c.json({ error: "Plugin not found" }, 404);
    }
    const settingService = c.get("container").resolve("pluginSettingService");
    const setting = await settingService.upsert(pluginName, userId, is_enabled);
    // Stop/start cron jobs for this plugin
    if (is_enabled) {
        startJobsByPlugin(pluginName);
    }
    else {
        stopJobsByPlugin(pluginName);
    }
    return c.json({
        name: pluginName,
        is_enabled: setting.is_enabled,
    });
});
// POST /api/plugins/install — install a plugin from npm (self-hosted only)
plugins.post("/install", async (c) => {
    if (process.env.MPFLOW_CLOUD === "true") {
        return c.json({ error: "Plugin installation is not available in cloud mode" }, 403);
    }
    const { package: packageName } = await c.req.json();
    if (!packageName || !/^(@[\w-]+\/)?[\w.-]+$/.test(packageName)) {
        return c.json({ error: "Invalid package name" }, 400);
    }
    try {
        execSync(`npm install ${packageName}`, {
            cwd: process.cwd(),
            stdio: "pipe",
            timeout: 120_000,
        });
        return c.json({ success: true, restart_required: true });
    }
    catch (err) {
        return c.json({ error: `Installation failed: ${err.message}` }, 500);
    }
});
export default plugins;
//# sourceMappingURL=plugins.js.map