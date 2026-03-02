import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import type { Context } from "hono"
import { CORE_TOOLS, type ApiTool, type ApiToolParam } from "./tools.js"

type AppFetch = (request: Request) => Response | Promise<Response>

/**
 * Build Zod shape from ApiTool params descriptor
 */
function buildInputShape(params: Record<string, ApiToolParam>): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [key, param] of Object.entries(params)) {
    let schema: z.ZodTypeAny

    switch (param.type) {
      case "number":
        schema = z.number().describe(param.description)
        break
      case "boolean":
        schema = z.boolean().describe(param.description)
        break
      case "object":
        schema = z.any().describe(param.description)
        break
      default:
        if (param.enum) {
          schema = z.enum(param.enum as [string, ...string[]]).describe(param.description)
        } else {
          schema = z.string().describe(param.description)
        }
    }

    if (!param.required) {
      schema = schema.optional()
    }

    shape[key] = schema
  }

  return shape
}

/**
 * Execute an API call via in-process app.fetch()
 */
async function callApi(
  tool: ApiTool,
  args: Record<string, any>,
  token: string | undefined,
  appFetch: AppFetch,
): Promise<{ content: { type: "text"; text: string }[]; isError: boolean }> {
  let path = tool.path
  const queryParams: string[] = []
  const bodyObj: Record<string, any> = {}

  if (tool.params) {
    for (const [key, param] of Object.entries(tool.params)) {
      const value = args[key]
      if (value === undefined) continue

      if (param.in === "path") {
        path = path.replace(`:${key}`, encodeURIComponent(String(value)))
      } else if (param.in === "query") {
        queryParams.push(`${key}=${encodeURIComponent(String(value))}`)
      } else if (param.in === "body") {
        bodyObj[key] = value
      }
    }
  }

  const url = `http://localhost${path}${queryParams.length ? "?" + queryParams.join("&") : ""}`

  const headers: Record<string, string> = {}
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const init: RequestInit = { method: tool.method, headers }

  if (tool.method !== "GET" && Object.keys(bodyObj).length > 0) {
    headers["Content-Type"] = "application/json"
    init.body = JSON.stringify(bodyObj)
  }

  const response = await appFetch(new Request(url, init))
  const text = await response.text()

  return {
    content: [{ type: "text", text }],
    isError: !response.ok,
  }
}

/**
 * Register all API tools on the MCP server
 */
function registerTools(server: McpServer, tools: ApiTool[], appFetch: AppFetch) {
  for (const tool of tools) {
    const hasParams = tool.params && Object.keys(tool.params).length > 0

    if (hasParams) {
      const shape = buildInputShape(tool.params!)
      server.tool(tool.name, tool.description, shape, async (args, extra) => {
        return callApi(tool, args as Record<string, any>, extra.authInfo?.token, appFetch)
      })
    } else {
      server.tool(tool.name, tool.description, async (extra) => {
        return callApi(tool, {}, extra.authInfo?.token, appFetch)
      })
    }
  }
}

// Session management for stateful MCP connections
const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()

function extractToken(req: Request): string | undefined {
  const auth = req.headers.get("authorization")
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7)
  }
  return undefined
}

/**
 * Create a Hono handler for the /mcp endpoint (Streamable HTTP transport)
 */
export function createMcpHandler(appFetch: AppFetch, extraTools?: ApiTool[]) {
  const allTools = [...CORE_TOOLS, ...(extraTools || [])]

  return async (c: Context): Promise<Response> => {
    const sessionId = c.req.header("mcp-session-id")

    // Existing session — reuse transport
    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)!
      const token = extractToken(c.req.raw)
      const options = token ? { authInfo: { token, clientId: "mcp", scopes: [] } } : {}
      return transport.handleRequest(c.req.raw, options)
    }

    // New session — create MCP server + transport
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, transport)
      },
      onsessionclosed: (id) => {
        sessions.delete(id)
      },
    })

    const server = new McpServer(
      { name: "mpflow", version: "1.0.0" },
      { capabilities: { tools: {} } },
    )

    registerTools(server, allTools, appFetch)
    await server.connect(transport)

    const token = extractToken(c.req.raw)
    const options = token ? { authInfo: { token, clientId: "mcp", scopes: [] } } : {}
    return transport.handleRequest(c.req.raw, options)
  }
}
