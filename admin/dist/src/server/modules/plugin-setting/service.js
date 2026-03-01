import { PluginSetting } from "./entity.js";
export class PluginSettingService {
    em;
    constructor(em) {
        this.em = em;
    }
    async listByUser(userId) {
        return this.em.find(PluginSetting, { user_id: userId });
    }
    async findOne(pluginName, userId) {
        return this.em.findOne(PluginSetting, { plugin_name: pluginName, user_id: userId });
    }
    async upsert(pluginName, userId, isEnabled) {
        let setting = await this.findOne(pluginName, userId);
        if (setting) {
            setting.is_enabled = isEnabled;
        }
        else {
            setting = this.em.create(PluginSetting, {
                plugin_name: pluginName,
                user_id: userId,
                is_enabled: isEnabled,
            });
            this.em.persist(setting);
        }
        await this.em.flush();
        return setting;
    }
    async isPluginEnabled(pluginName, userId) {
        const setting = await this.findOne(pluginName, userId);
        return setting ? setting.is_enabled : true; // enabled by default
    }
    async getDisabledPlugins(userId) {
        const settings = await this.em.find(PluginSetting, {
            user_id: userId,
            is_enabled: false,
        });
        return settings.map((s) => s.plugin_name);
    }
}
//# sourceMappingURL=service.js.map