import type { Context, Next } from "hono"
import type { OzonIntegrationService } from "../modules/ozon-integration/service.js"

/**
 * Hono middleware that enriches catalog responses with Ozon data.
 * Applied as post-processing: runs after the route handler.
 */
export async function ozonCatalogEnrichment(c: Context, next: Next) {
  await next()

  // Only enrich GET responses with JSON
  if (c.req.method !== "GET") return

  try {
    const body = await c.res.json()
    const container = c.get("container")
    const ozonService: OzonIntegrationService = container.resolve("ozonService")

    // List: enrich products[]
    if (body?.products && Array.isArray(body.products)) {
      for (const product of body.products) {
        try {
          const links = await ozonService.listOzonProductLinks({
            master_card_id: product.id,
          })
          if (links.length > 0) {
            product.ozon = {
              offer_id: links[0].offer_id,
              ozon_status: links[0].ozon_status,
              ozon_price: links[0].ozon_price,
            }
            const snapshots = await ozonService.listOzonStockSnapshots({
              offer_id: links[0].offer_id,
            })
            product.ozon_fbo_stock = snapshots.reduce(
              (sum: number, s: any) => sum + (s.fbo_present || 0),
              0,
            )
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
        const links = await ozonService.listOzonProductLinks({
          master_card_id: body.product.id,
        })
        if (links.length > 0) {
          const ozonLink = links[0]
          body.product.ozon = {
            ozon_product_id: ozonLink.ozon_product_id,
            offer_id: ozonLink.offer_id,
            ozon_sku: ozonLink.ozon_sku,
            ozon_fbo_sku: ozonLink.ozon_fbo_sku,
            ozon_name: ozonLink.ozon_name,
            ozon_status: ozonLink.ozon_status,
            ozon_price: ozonLink.ozon_price,
            ozon_min_price: ozonLink.ozon_min_price,
            ozon_marketing_price: ozonLink.ozon_marketing_price,
            last_synced_at: ozonLink.last_synced_at,
          }

          try {
            const snapshots = await ozonService.listOzonStockSnapshots({
              offer_id: ozonLink.offer_id,
            })
            body.product.ozon_stock = {
              fbo_present: snapshots.reduce((s: number, snap: any) => s + (snap.fbo_present || 0), 0),
              fbo_reserved: snapshots.reduce((s: number, snap: any) => s + (snap.fbo_reserved || 0), 0),
              last_synced: snapshots[0]?.synced_at || null,
            }
          } catch { /* skip */ }

          try {
            const saleService: any = container.resolve("saleService")
            const sales = await saleService.list(
              { master_card_id: body.product.id, channel: "ozon" },
              { orderBy: { sold_at: "DESC" }, limit: 50 },
            )
            body.product.recent_sales = sales.map((s: any) => ({
              id: s.id,
              channel_order_id: s.channel_order_id,
              quantity: s.quantity,
              price_per_unit: s.price_per_unit,
              revenue: s.revenue,
              fee_details: s.fee_details,
              total_cogs: s.total_cogs,
              sold_at: s.sold_at,
              status: s.status,
            }))
          } catch { /* skip */ }
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
