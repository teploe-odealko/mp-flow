import { Hono } from "hono"
import { getSession } from "../core/session.js"
import { getLoadedPlugins } from "../core/plugin-loader.js"
import { CORE_COLUMN_DOCS, type PageColumnDocsWithPlugins, type ColumnDocWithPlugins } from "../../shared/column-docs.js"
import type { PluginSettingService } from "../modules/plugin-setting/service.js"

const columnDocs = new Hono<{ Variables: Record<string, any> }>()

columnDocs.get("/", async (c) => {
  const session = getSession(c)
  const userId = session.userId

  // Deep clone core docs
  const pages: PageColumnDocsWithPlugins[] = CORE_COLUMN_DOCS.map((p) => ({
    pageId: p.pageId,
    pageLabel: p.pageLabel,
    columns: p.columns.map((col) => ({ ...col } as ColumnDocWithPlugins)),
  }))

  // Merge plugin contributions if user is authenticated
  if (userId) {
    const loadedPlugins = getLoadedPlugins()
    const settingService: PluginSettingService = c.get("container").resolve("pluginSettingService")

    for (const plugin of loadedPlugins) {
      if (!plugin.columnDocs?.length) continue

      const isEnabled = await settingService.isPluginEnabled(plugin.name, userId)
      if (!isEnabled) continue

      for (const contrib of plugin.columnDocs) {
        const page = pages.find((p) => p.pageId === contrib.pageId)
        if (!page) continue
        const col = page.columns.find((c) => c.key === contrib.columnKey)
        if (!col) continue

        if (!col.pluginContributions) col.pluginContributions = []
        col.pluginContributions.push({
          pluginLabel: contrib.pluginLabel,
          description: contrib.description,
          links: contrib.links,
        })
      }
    }
  }

  return c.json({ pages })
})

export default columnDocs
