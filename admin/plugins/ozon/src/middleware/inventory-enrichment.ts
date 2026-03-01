import type { Context, Next } from "hono"
import type { OzonIntegrationService } from "../modules/ozon-integration/service.js"

/**
 * Filter snapshots to only the latest sync (by max synced_at).
 * Each sync creates one snapshot per warehouse — we want only the latest set.
 */
function getLatestSnapshots(snapshots: any[]): any[] {
  if (snapshots.length === 0) return []
  let maxTime = 0
  for (const s of snapshots) {
    const t = new Date(s.synced_at).getTime()
    if (t > maxTime) maxTime = t
  }
  return snapshots.filter((s) => new Date(s.synced_at).getTime() === maxTime)
}

/**
 * Hono middleware that enriches inventory responses with Ozon stock data.
 * Adds Ozon FBO/reserved entries to stock_breakdown and adjusts "local" stock.
 */
export async function ozonInventoryEnrichment(c: Context, next: Next) {
  await next()

  if (c.req.method !== "GET") return

  try {
    const body: any = await c.res.json()
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
          const allSnapshots = await ozonService.listOzonStockSnapshots({
            offer_id: offerId,
          })
          const snapshots = getLatestSnapshots(allSnapshots)

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
            const allSnapshots = await ozonService.listOzonStockSnapshots({
              offer_id: ozonLink.offer_id,
            })
            const snapshots = getLatestSnapshots(allSnapshots)
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
