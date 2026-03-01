import type { Context, Next } from "hono"
import type { OzonIntegrationService } from "../modules/ozon-integration/service.js"

/**
 * Hono middleware that enriches inventory responses with Ozon stock data.
 */
export async function ozonInventoryEnrichment(c: Context, next: Next) {
  await next()

  if (c.req.method !== "GET") return

  try {
    const body: any = await c.res.json()
    const container = c.get("container")
    const ozonService: OzonIntegrationService = container.resolve("ozonService")
    const saleService: any = container.resolve("saleService")

    // List: enrich rows[]
    if (body?.rows && Array.isArray(body.rows)) {
      for (const row of body.rows) {
        try {
          const links = await ozonService.listOzonProductLinks({
            master_card_id: row.card_id,
          })
          if (links.length > 0) {
            const offerId = links[0].offer_id
            const snapshots = await ozonService.listOzonStockSnapshots({
              offer_id: offerId,
            })
            row.ozon_fbo = snapshots.reduce(
              (s: number, snap: any) => s + (snap.fbo_present || 0),
              0,
            )

            const sales = await saleService.listSales({
              master_card_id: row.card_id,
              channel: "ozon",
            })
            row.sold_qty = sales
              .filter((s: any) => s.status === "active" || s.status === "delivered")
              .reduce((s: number, sale: any) => s + (sale.quantity || 0), 0)
          }
        } catch { /* skip */ }
      }

      let totalOzonStock = 0
      for (const row of body.rows) {
        totalOzonStock += row.ozon_fbo || 0
      }
      if (body.totals) {
        body.totals.ozon_fbo = totalOzonStock
      }

      c.res = new Response(JSON.stringify(body), {
        status: c.res.status,
        headers: c.res.headers,
      })
      return
    }

    // Detail: enrich card + summary
    if (body?.card?.id) {
      const cardId = body.card.id
      try {
        const links = await ozonService.listOzonProductLinks({
          master_card_id: cardId,
        })
        if (links.length > 0) {
          const ozonLink = links[0]
          body.ozon = {
            ozon_product_id: ozonLink.ozon_product_id,
            offer_id: ozonLink.offer_id,
            ozon_sku: ozonLink.ozon_sku,
            ozon_name: ozonLink.ozon_name,
            ozon_status: ozonLink.ozon_status,
            ozon_price: ozonLink.ozon_price,
          }

          try {
            const snapshots = await ozonService.listOzonStockSnapshots({
              offer_id: ozonLink.offer_id,
            })
            if (snapshots.length > 0) {
              body.ozon_stock = {
                fbo_present: snapshots.reduce((s: number, snap: any) => s + (snap.fbo_present || 0), 0),
                fbo_reserved: snapshots.reduce((s: number, snap: any) => s + (snap.fbo_reserved || 0), 0),
                warehouses: snapshots.map((s: any) => ({
                  warehouse_name: s.warehouse_name,
                  fbo_present: s.fbo_present,
                  fbo_reserved: s.fbo_reserved,
                  synced_at: s.synced_at,
                })),
              }
              if (body.summary) {
                body.summary.ozon_fbo = body.ozon_stock.fbo_present
              }
            }
          } catch { /* skip */ }

          try {
            const sales = await saleService.listSales(
              { master_card_id: cardId, channel: "ozon" },
              { order: { sold_at: "DESC" }, take: 50 },
            )
            body.recent_sales = sales.map((s: any) => ({
              id: s.id,
              channel_order_id: s.channel_order_id,
              channel_sku: s.channel_sku,
              quantity: s.quantity,
              price_per_unit: s.price_per_unit,
              revenue: s.revenue,
              fee_details: s.fee_details,
              total_cogs: s.total_cogs,
              sold_at: s.sold_at,
              status: s.status,
            }))

            if (body.summary) {
              body.summary.total_sold = sales.reduce(
                (s: number, sale: any) => s + (sale.quantity || 0), 0,
              )
              body.summary.total_revenue = Math.round(
                sales.reduce((s: number, sale: any) => s + Number(sale.revenue || 0), 0) * 100,
              ) / 100
            }
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
