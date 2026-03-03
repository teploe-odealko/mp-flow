import type { Hono } from "hono"
import type { AwilixContainer } from "awilix"
import type { MikroORM } from "@mikro-orm/core"
import type { PluginColumnDocContribution } from "../../shared/column-docs.js"
import type { ApiTool } from "../mcp/tools.js"
import type { McpResourceDef } from "../mcp/server.js"
import { asClass, Lifetime, InjectionMode } from "awilix"
import { readdirSync, existsSync } from "node:fs"
import { join, basename } from "node:path"

export interface PluginMiddleware {
  path: string
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "ALL"
  handler: (c: any, next: () => Promise<void>) => Promise<any>
}

export interface BillableOperation {
  name: string
  description: string
  creditCost: number
}

export interface PluginBilling {
  operations: BillableOperation[]
}

export interface PluginDefinition {
  name: string
  label: string
  description?: string
  entities?: any[]
  services?: Record<string, any>
  routes?: (app: Hono, container: AwilixContainer) => void
  middleware?: PluginMiddleware[]
  adminNav?: Array<{ path: string; label: string }>
  apiPrefixes?: string[]
  columnDocs?: PluginColumnDocContribution[]
  mcpTools?: ApiTool[]
  mcpResources?: McpResourceDef[]
  billing?: PluginBilling
}

const loadedPlugins = new Map<string, PluginDefinition>()

export function getLoadedPlugins(): PluginDefinition[] {
  return Array.from(loadedPlugins.values())
}

export function definePlugin(def: PluginDefinition): PluginDefinition {
  return def
}

// ── Helpers ──

function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

interface ResolvedPlugin {
  pluginPath: string
  pluginDir: string
}

function resolvePlugin(resolve: string): ResolvedPlugin {
  if (resolve.startsWith(".")) {
    const pluginName = resolve.replace(/^\.\/plugins\//, "")
    const distDir = join(process.cwd(), "dist", "plugins", pluginName)
    const srcDir = join(process.cwd(), "plugins", pluginName)
    if (existsSync(join(distDir, "plugin.js"))) {
      return { pluginPath: join(distDir, "plugin.js"), pluginDir: distDir }
    }
    return { pluginPath: join(srcDir, "plugin.ts"), pluginDir: srcDir }
  }
  return { pluginPath: resolve, pluginDir: "" }
}

function scanDir(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => (f.endsWith(".js") || f.endsWith(".ts")) && !f.endsWith(".d.ts"))
    .map((f) => join(dir, f))
}

async function resolveFile(basePath: string): Promise<string | null> {
  for (const ext of [".js", ".ts"]) {
    const p = basePath + ext
    if (existsSync(p)) return p
  }
  return null
}

function fileExt(file: string): string {
  return file.endsWith(".ts") ? ".ts" : ".js"
}

// ── Discovery ──

async function discoverEntities(pluginDir: string): Promise<any[]> {
  const files = scanDir(join(pluginDir, "src", "entities"))
  const entities: any[] = []
  for (const file of files) {
    const mod = await import(file)
    for (const val of Object.values(mod)) {
      if (typeof val === "function" && val.prototype) entities.push(val)
    }
  }
  return entities
}

async function discoverServices(pluginDir: string): Promise<Record<string, any>> {
  const files = scanDir(join(pluginDir, "src", "services"))
  const services: Record<string, any> = {}
  for (const file of files) {
    const mod = await import(file)
    const diKey = kebabToCamel(basename(file, fileExt(file)))
    const Cls =
      mod.default ||
      Object.values(mod).find((v) => typeof v === "function" && v.prototype)
    if (Cls) {
      services[diKey] = asClass(Cls as any, {
        lifetime: Lifetime.SCOPED,
        injectionMode: InjectionMode.CLASSIC,
      })
    }
  }
  return services
}

async function discoverRoutes(pluginDir: string): Promise<{
  register: (app: Hono<any>) => void
  apiPrefixes: string[]
}> {
  const files = scanDir(join(pluginDir, "src", "routes"))
  const entries: Array<{ prefix: string; handler: any }> = []
  for (const file of files) {
    const mod = await import(file)
    if (!mod.default) continue
    const prefix = `/api/${basename(file, fileExt(file))}`
    entries.push({ prefix, handler: mod.default })
  }
  return {
    register: (app) => {
      for (const { prefix, handler } of entries) app.route(prefix, handler)
    },
    apiPrefixes: entries.map((e) => e.prefix),
  }
}

async function discoverMiddleware(pluginDir: string): Promise<PluginMiddleware[]> {
  const files = scanDir(join(pluginDir, "src", "middleware"))
  const middleware: PluginMiddleware[] = []
  for (const file of files) {
    const mod = await import(file)
    if (!mod.config || !mod.default) continue
    for (const p of mod.config.paths || []) {
      middleware.push({
        path: p.path,
        method: p.method || "ALL",
        handler: mod.default,
      })
    }
  }
  return middleware
}

async function discoverNav(
  pluginDir: string,
): Promise<Array<{ path: string; label: string }> | undefined> {
  const file = await resolveFile(join(pluginDir, "src", "nav"))
  if (!file) return undefined
  const mod = await import(file)
  return mod.default
}

async function discoverColumnDocs(
  pluginDir: string,
): Promise<PluginColumnDocContribution[] | undefined> {
  const file = await resolveFile(join(pluginDir, "src", "column-docs"))
  if (!file) return undefined
  const mod = await import(file)
  return mod.default
}

async function discoverMcp(
  pluginDir: string,
): Promise<{ mcpTools?: ApiTool[]; mcpResources?: McpResourceDef[] } | undefined> {
  // Look for src/mcp/*-mcp.ts or src/mcp/index.ts
  const mcpDir = join(pluginDir, "src", "mcp")
  if (!existsSync(mcpDir)) return undefined
  const files = scanDir(mcpDir).filter((f) => !f.includes("api-reference"))
  let tools: ApiTool[] = []
  let resources: McpResourceDef[] = []
  for (const file of files) {
    const mod = await import(file)
    if (mod.OZON_MCP_TOOLS || mod.mcpTools) tools.push(...(mod.OZON_MCP_TOOLS || mod.mcpTools || []))
    if (mod.getOzonMcpResources) resources.push(...mod.getOzonMcpResources())
    if (mod.getMcpResources) resources.push(...mod.getMcpResources())
    if (mod.mcpResources) resources.push(...mod.mcpResources)
  }
  if (tools.length === 0 && resources.length === 0) return undefined
  return {
    mcpTools: tools.length > 0 ? tools : undefined,
    mcpResources: resources.length > 0 ? resources : undefined,
  }
}

// ── Registration helper ──

function registerMiddleware(app: Hono<any>, middleware: PluginMiddleware[]) {
  for (const mw of middleware) {
    const method = mw.method.toLowerCase() as any
    if (method === "all") {
      app.use(mw.path, mw.handler)
    } else {
      app.use(mw.path, async (c, next) => {
        if (c.req.method === mw.method) {
          return mw.handler(c, next)
        }
        await next()
      })
    }
  }
}

// ── Public API ──

/**
 * Collect entities from plugins WITHOUT loading routes/middleware.
 * Used before ORM init so all entities are registered in metadata.
 */
export async function collectPluginEntities(
  pluginPaths: Array<{ resolve: string }>,
): Promise<any[]> {
  const allEntities: any[] = []
  for (const pluginRef of pluginPaths) {
    try {
      const { pluginPath, pluginDir } = resolvePlugin(pluginRef.resolve)
      const mod = await import(pluginPath)
      const plugin: PluginDefinition = mod.default || mod

      if (plugin.entities) {
        allEntities.push(...plugin.entities)
      } else if (pluginDir) {
        allEntities.push(...(await discoverEntities(pluginDir)))
      }
    } catch (err) {
      console.error(`[plugin] Failed to collect entities from ${pluginRef.resolve}:`, err)
    }
  }
  return allEntities
}

export async function loadPlugins(
  pluginPaths: Array<{ resolve: string }>,
  app: Hono<any>,
  container: AwilixContainer,
  _orm: MikroORM,
): Promise<{ entities: any[] }> {
  const allEntities: any[] = []

  for (const pluginRef of pluginPaths) {
    try {
      const { pluginPath, pluginDir } = resolvePlugin(pluginRef.resolve)
      const mod = await import(pluginPath)
      const plugin: PluginDefinition = mod.default || mod

      console.log(`[plugin] Loading: ${plugin.name}`)

      // ── Entities ──
      if (plugin.entities) {
        allEntities.push(...plugin.entities)
      } else if (pluginDir) {
        const entities = await discoverEntities(pluginDir)
        allEntities.push(...entities)
      }

      // ── Services ──
      if (plugin.services) {
        container.register(plugin.services)
      } else if (pluginDir) {
        const services = await discoverServices(pluginDir)
        if (Object.keys(services).length) container.register(services)
      }

      // ── Routes ──
      let discoveredApiPrefixes: string[] | undefined
      if (plugin.routes) {
        plugin.routes(app, container)
      } else if (pluginDir) {
        const discovered = await discoverRoutes(pluginDir)
        discovered.register(app)
        discoveredApiPrefixes = discovered.apiPrefixes
      }

      // ── Middleware ──
      if (plugin.middleware) {
        registerMiddleware(app, plugin.middleware)
      } else if (pluginDir) {
        const middleware = await discoverMiddleware(pluginDir)
        if (middleware.length) {
          plugin.middleware = middleware
          registerMiddleware(app, middleware)
        }
      }

      // ── Admin Nav ──
      if (!plugin.adminNav && pluginDir) {
        plugin.adminNav = await discoverNav(pluginDir)
      }

      // ── Column Docs ──
      if (!plugin.columnDocs && pluginDir) {
        plugin.columnDocs = await discoverColumnDocs(pluginDir)
      }

      // ── MCP Tools & Resources ──
      if (!plugin.mcpTools && !plugin.mcpResources && pluginDir) {
        const mcp = await discoverMcp(pluginDir)
        if (mcp) {
          plugin.mcpTools = mcp.mcpTools
          plugin.mcpResources = mcp.mcpResources
          if (mcp.mcpTools) console.log(`[plugin] ${plugin.name}: ${mcp.mcpTools.length} MCP tools`)
          if (mcp.mcpResources) console.log(`[plugin] ${plugin.name}: ${mcp.mcpResources.length} MCP resources`)
        }
      }

      // ── Billing ──
      if (!plugin.billing && pluginDir) {
        const billingFile = await resolveFile(join(pluginDir, "src", "billing"))
        if (billingFile) {
          try {
            const billingMod = await import(billingFile)
            plugin.billing = billingMod.billing || billingMod.default
            if (plugin.billing) {
              console.log(`[plugin] ${plugin.name}: ${plugin.billing.operations.length} billable operations`)
            }
          } catch (err) {
            console.error(`[plugin] ${plugin.name}: failed to load billing:`, err)
          }
        }
      }

      // ── API Prefixes ──
      if (!plugin.apiPrefixes) {
        plugin.apiPrefixes = discoveredApiPrefixes
      }

      loadedPlugins.set(plugin.name, plugin)
      console.log(`[plugin] Loaded: ${plugin.name}`)
    } catch (err) {
      console.error(`[plugin] Failed to load ${pluginRef.resolve}:`, err)
    }
  }

  return { entities: allEntities }
}
