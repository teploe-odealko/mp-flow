import type { EntityManager } from "@mikro-orm/core"
import { PluginSetting } from "./entity.js"

export class PluginSettingService {
  constructor(private em: EntityManager) {}

  async listByUser(userId: string): Promise<PluginSetting[]> {
    return this.em.find(PluginSetting, { user_id: userId })
  }

  async findOne(pluginName: string, userId: string): Promise<PluginSetting | null> {
    return this.em.findOne(PluginSetting, { plugin_name: pluginName, user_id: userId })
  }

  async upsert(pluginName: string, userId: string, isEnabled: boolean): Promise<PluginSetting> {
    let setting = await this.findOne(pluginName, userId)
    if (setting) {
      setting.is_enabled = isEnabled
    } else {
      setting = this.em.create(PluginSetting, {
        plugin_name: pluginName,
        user_id: userId,
        is_enabled: isEnabled,
      } as any)
      this.em.persist(setting)
    }
    await this.em.flush()
    return setting
  }

  async isPluginEnabled(pluginName: string, userId: string): Promise<boolean> {
    const setting = await this.findOne(pluginName, userId)
    return setting ? setting.is_enabled : true // enabled by default
  }

  async getDisabledPlugins(userId: string): Promise<string[]> {
    const settings = await this.em.find(PluginSetting, {
      user_id: userId,
      is_enabled: false,
    })
    return settings.map((s) => s.plugin_name)
  }
}
