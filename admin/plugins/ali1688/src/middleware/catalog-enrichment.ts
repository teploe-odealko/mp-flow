import type { Context, Next } from "hono"
import type { Ali1688Service } from "../services/ali1688-service.js"

export const config = {
  paths: [
    { path: "/api/catalog", method: "GET" },
    { path: "/api/catalog/*", method: "GET" },
  ],
}

export default async function ali1688CatalogEnrichment(c: Context, next: Next) {
  await next()

  if (c.req.method !== "GET") return

  try {
    const body: any = await c.res.json()
    const container = c.get("container")
    const ali1688Service: Ali1688Service = container.resolve("ali1688Service")

    // List: enrich products[]
    if (body?.products && Array.isArray(body.products)) {
      for (const product of body.products) {
        try {
          const link = await ali1688Service.findByMasterCard(product.id)
          if (link) {
            product.ali1688 = {
              url: link.url,
              sku_price: link.sku_price != null ? Number(link.sku_price) : null,
              supplier_name: link.supplier_name || null,
              currency: "CNY",
            }
          }
        } catch { /* skip */ }
      }
      c.res = new Response(JSON.stringify(body), {
        status: c.res.status,
        headers: c.res.headers,
      })
      return
    }

    // Detail: enrich product
    if (body?.product?.id) {
      try {
        const link = await ali1688Service.findByMasterCard(body.product.id)
        if (link) {
          body.product.ali1688 = {
            id: link.id,
            url: link.url,
            item_id: link.item_id,
            sku_id: link.sku_id || null,
            sku_name: link.sku_name || null,
            sku_image: link.sku_image || null,
            sku_price: link.sku_price != null ? Number(link.sku_price) : null,
            supplier_name: link.supplier_name || null,
            title: link.title || null,
            currency: "CNY",
            images: link.images || [],
          }
        }
      } catch { /* skip */ }

      c.res = new Response(JSON.stringify(body), {
        status: c.res.status,
        headers: c.res.headers,
      })
    }
  } catch {
    // Response is not JSON or enrichment failed, pass through
  }
}
