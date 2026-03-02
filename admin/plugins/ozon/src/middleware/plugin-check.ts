import type { Context } from "hono"

const PLUGIN_NAME = "mpflow-plugin-ozon"

/**
 * Check if the Ozon plugin is enabled for the current user.
 * Returns false (skip enrichment) if plugin is disabled or no user session.
 */
export async function isOzonEnabled(c: Context): Promise<boolean> {
  try {
    const container = c.get("container")
    const session: any = c.get("session")
    const userId = session?.userId
    if (!userId) return false

    const settingService: any = container.resolve("pluginSettingService")
    return settingService.isPluginEnabled(PLUGIN_NAME, userId)
  } catch {
    return true // if check fails, default to enabled (don't break enrichment)
  }
}
