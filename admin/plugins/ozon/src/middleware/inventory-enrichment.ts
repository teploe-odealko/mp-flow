import type { Context, Next } from "hono"
import type { OzonIntegrationService } from "../services/ozon-service.js"
import { isOzonEnabled } from "./plugin-check.js"

export const config = {
  paths: [
    { path: "/api/inventory", method: "GET" },
    { path: "/api/inventory/*", method: "GET" },
  ],
}

export default async function ozonInventoryEnrichment(c: Context, next: Next) {
  await next()

  if (c.req.method !== "GET") return
  if (!(await isOzonEnabled(c))) return

  let body: any
  try {
    body = await c.res.json()
  } catch {
    return // not JSON, pass through
  }

  try {
    const container = c.get("container")
    const ozonService: OzonIntegrationService = container.resolve("ozonService")

    // List: enrich rows[] stock_breakdown
    if (body?.rows && Array.isArray(body.rows)) {
      for (const row of body.rows) {
        try {
          const links = await ozonService.listOzonProductLinks({
            master_card_id: row.card_id,
          })
          if (links.length === 0) continue

          // Skip if already enriched (middleware may fire twice)
          if (Array.isArray(row.stock_breakdown) &&
            row.stock_breakdown.some((e: any) => e.source === "ozon_fbo")) continue

          const offerId = links[0].offer_id
          const snapshots = await ozonService.listOzonStockSnapshots({
            offer_id: offerId,
          })

          const fboPresent = snapshots.reduce(
            (s: number, snap: any) => s + (snap.fbo_present || 0), 0,
          )
          const fboReserved = snapshots.reduce(
            (s: number, snap: any) => s + (snap.fbo_reserved || 0), 0,
          )
          const marketplaceQty = fboPresent + fboReserved

          if (marketplaceQty > 0 && Array.isArray(row.stock_breakdown)) {
            // Decrease "local" stock by marketplace amount
            const localEntry = row.stock_breakdown.find((e: any) => e.source === "local")
            if (localEntry) {
              localEntry.qty -= marketplaceQty
              if (localEntry.qty < 0) {
                row.discrepancy = Math.abs(localEntry.qty)
                localEntry.qty = 0
              }
            }

            // Add Ozon breakdown entries
            if (fboPresent > 0) {
              row.stock_breakdown.push({ source: "ozon_fbo", label: "Ozon FBO", qty: fboPresent })
            }
            if (fboReserved > 0) {
              row.stock_breakdown.push({ source: "ozon_reserved", label: "Ozon резерв", qty: fboReserved })
            }

            // Recalculate stock_total as sum of all breakdown entries
            row.stock_total = row.stock_breakdown.reduce(
              (s: number, e: any) => s + (e.qty || 0), 0,
            )

            // Recalculate discrepancy after enrichment
            row.discrepancy = Math.max(0,
              (row.sold_total || 0) + (row.delivering_total || 0) +
              (row.written_off_qty || 0) + row.stock_total - (row.received_qty || 0),
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

    // Detail: enrich card + summary with Ozon data
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
                  updated_at: s.updated_at,
                })),
              }
              if (body.summary) {
                body.summary.ozon_fbo = body.ozon_stock.fbo_present
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }

      c.res = new Response(JSON.stringify(body), {
        status: c.res.status,
        headers: c.res.headers,
      })
    }
  } catch { /* enrichment failed, pass through */ }

  // Always restore the response since we consumed the body above
  c.res = new Response(JSON.stringify(body), {
    status: c.res.status,
    headers: c.res.headers,
  })
}
