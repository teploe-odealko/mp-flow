import type { ApiTool } from "./tools.js"

interface OpenApiSpec {
  openapi: string
  info: { title: string; version: string; description: string }
  servers: { url: string; description: string }[]
  paths: Record<string, any>
  components: {
    securitySchemes: Record<string, any>
  }
  security: any[]
}

/**
 * Generate OpenAPI 3.1 spec from ApiTool descriptors
 */
export function generateOpenApiSpec(tools: ApiTool[], baseUrl?: string): OpenApiSpec {
  const paths: Record<string, any> = {}

  for (const tool of tools) {
    // Convert :param to {param} for OpenAPI
    const openApiPath = tool.path.replace(/:(\w+)/g, "{$1}")

    if (!paths[openApiPath]) {
      paths[openApiPath] = {}
    }

    const method = tool.method.toLowerCase()
    const parameters: any[] = []
    const bodyProperties: Record<string, any> = {}
    const requiredBody: string[] = []

    if (tool.params) {
      for (const [key, param] of Object.entries(tool.params)) {
        if (param.in === "path" || param.in === "query") {
          const p: any = {
            name: key,
            in: param.in,
            description: param.description,
            required: param.in === "path" ? true : !!param.required,
            schema: buildJsonSchema(param),
          }
          parameters.push(p)
        } else if (param.in === "body") {
          bodyProperties[key] = buildJsonSchema(param)
          if (param.required) requiredBody.push(key)
        }
      }
    }

    const operation: any = {
      operationId: tool.name,
      summary: tool.description,
      tags: [guessTag(tool.path)],
    }

    if (parameters.length > 0) {
      operation.parameters = parameters
    }

    if (Object.keys(bodyProperties).length > 0) {
      operation.requestBody = {
        required: requiredBody.length > 0,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: bodyProperties,
              ...(requiredBody.length > 0 ? { required: requiredBody } : {}),
            },
          },
        },
      }
    }

    operation.responses = {
      "200": {
        description: "Успешный ответ",
        content: { "application/json": { schema: { type: "object" } } },
      },
      "401": { description: "Не авторизован" },
      "500": { description: "Ошибка сервера" },
    }

    paths[openApiPath][method] = operation
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "MPFlow API",
      version: "1.0.0",
      description: "API для управления маркетплейсами. Используйте Bearer токен (API ключ) для авторизации.",
    },
    servers: [
      ...(baseUrl ? [{ url: baseUrl, description: "Текущий сервер" }] : []),
      { url: "/", description: "Relative" },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "API ключ в формате mpf_...",
        },
      },
    },
    security: [{ bearerAuth: [] }],
  }
}

function buildJsonSchema(param: { type: string; enum?: string[]; description: string }) {
  const schema: any = {}

  switch (param.type) {
    case "number":
      schema.type = "number"
      break
    case "boolean":
      schema.type = "boolean"
      break
    case "object":
      schema.type = "array"
      schema.items = { type: "object" }
      break
    default:
      schema.type = "string"
  }

  if (param.enum) {
    schema.enum = param.enum
  }

  schema.description = param.description
  return schema
}

function guessTag(path: string): string {
  // /api/catalog/:id → Каталог
  const segment = path.split("/")[2] || "other"
  const tags: Record<string, string> = {
    catalog: "Каталог",
    inventory: "Склад",
    suppliers: "Поставки",
    "suppliers-registry": "Реестр поставщиков",
    sales: "Продажи",
    finance: "Финансы",
    procurement: "Закупки",
    analytics: "Аналитика",
  }
  return tags[segment] || segment
}
