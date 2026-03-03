import type { ApiTool } from "../../../../src/server/mcp/tools.js"
import type { McpResourceDef } from "../../../../src/server/mcp/server.js"
import { OZON_API_CATEGORIES } from "./ozon-api-reference.js"

/**
 * MCP tool: proxy to any Ozon Seller API endpoint
 */
export const OZON_MCP_TOOLS: ApiTool[] = [
  {
    name: "ozon_api",
    description:
      "Вызвать любой метод Ozon Seller API. Передайте path (напр. /v3/product/list) и body. " +
      "Используйте ресурс ozon://categories для поиска нужного метода.",
    method: "POST",
    path: "/api/ozon-proxy",
    params: {
      path: {
        type: "string",
        description: "Путь метода Ozon API (напр. /v3/product/list, /v1/seller/info)",
        required: true,
        in: "body",
      },
      body: {
        type: "object",
        description: "Тело запроса к Ozon API (JSON объект)",
        in: "body",
      },
      method: {
        type: "string",
        description: "HTTP метод (POST по умолчанию, или GET)",
        in: "body",
      },
    },
  },
]

/**
 * Build MCP resources from the Ozon API reference
 */
export function getOzonMcpResources(): McpResourceDef[] {
  const resources: McpResourceDef[] = []

  // Category index resource
  const totalEndpoints = OZON_API_CATEGORIES.reduce((sum, c) => sum + c.endpoints.length, 0)
  let indexContent = `# Ozon Seller API — Справочник категорий\n\n`
  indexContent += `Всего: ${totalEndpoints} эндпоинтов в ${OZON_API_CATEGORIES.length} категориях\n\n`
  indexContent += `Для получения деталей по категории используйте ресурс ozon://category/{name}\n\n`
  for (const cat of OZON_API_CATEGORIES) {
    indexContent += `- ${cat.name} (${cat.endpoints.length} методов)\n`
  }

  resources.push({
    uri: "ozon://categories",
    name: "Ozon Seller API — Все категории",
    description: `Индекс всех ${OZON_API_CATEGORIES.length} категорий Ozon Seller API (${totalEndpoints} эндпоинтов)`,
    mimeType: "text/plain",
    text: indexContent,
  })

  // Per-category resources
  for (const cat of OZON_API_CATEGORIES) {
    let content = `# ${cat.name} — Ozon Seller API\n\n`
    content += `${cat.endpoints.length} методов\n\n`
    for (const ep of cat.endpoints) {
      content += `${ep.method} ${ep.path} — ${ep.summary}\n`
    }

    resources.push({
      uri: `ozon://category/${cat.name}`,
      name: `Ozon API: ${cat.name}`,
      description: `${cat.endpoints.length} методов в категории ${cat.name}`,
      mimeType: "text/plain",
      text: content,
    })
  }

  return resources
}
