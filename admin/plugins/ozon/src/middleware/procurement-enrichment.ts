import type { Context, Next } from "hono"
import type { OzonIntegrationService } from "../modules/ozon-integration/service.js"
import { isOzonEnabled } from "./plugin-check.js"

/**
 * Filter snapshots to only the latest sync (by max synced_at).
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
 * Hono middleware that enriches procurement forecast with Ozon FBO stock data.
 * Adjusts stock_breakdown and recalculates order_qty based on actual marketplace stock.
 */
export async function ozonProcurementEnrichment(c: Context, next: Next) {
  await next()

  if (c.req.method !== "GET") return
  if (!(await isOzonEnabled(c))) return

  try {
    const body: any = await c.res.json()
    const container = c.get("container")
    const ozonService: OzonIntegrationService = container.resolve("ozonService")

    if (body?.rows && Array.isArray(body.rows)) {
      for (const row of body.rows) {
        try {
          const links = await ozonService.listOzonProductLinks({
            master_card_id: row.card_id,
          })
          if (links.length === 0) continue

          // Skip if already enriched
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
            // Decrease local stock by marketplace amount
            const localEntry = row.stock_breakdown.find((e: any) => e.source === "local")
            if (localEntry) {
              localEntry.qty -= marketplaceQty
              if (localEntry.qty < 0) localEntry.qty = 0
            }

            // Add Ozon entries
            if (fboPresent > 0) {
              row.stock_breakdown.push({ source: "ozon_fbo", label: "Ozon FBO", qty: fboPresent })
            }
            if (fboReserved > 0) {
              row.stock_breakdown.push({ source: "ozon_reserved", label: "Ozon резерв", qty: fboReserved })
            }

            // Recalculate stock_total
            row.stock_total = row.stock_breakdown.reduce(
              (s: number, e: any) => s + (e.qty || 0), 0,
            )

            // Recalculate available_qty and order_qty
            row.available_qty = row.stock_total + (row.in_transit_qty || 0)
            row.order_qty = Math.max(0, (row.required_qty || 0) - row.available_qty)
            row.order_value = Math.round(row.order_qty * (row.avg_cost || 0) * 100) / 100

            // Recalculate stockout_date
            if (row.daily_rate > 0 && row.available_qty > 0) {
              const daysUntilStockout = row.available_qty / row.daily_rate
              const stockoutD = new Date(Date.now() + daysUntilStockout * 86400_000)
              row.stockout_date = stockoutD.toISOString().slice(0, 10)
            }
          }
        } catch { /* skip */ }
      }

      // Recalculate totals
      if (body.totals) {
        body.totals.need_order = body.rows.filter((r: any) => r.order_qty > 0).length
        body.totals.total_order_qty = body.rows.reduce((s: number, r: any) => s + (r.order_qty || 0), 0)
        body.totals.total_order_value = Math.round(
          body.rows.reduce((s: number, r: any) => s + (r.order_value || 0), 0) * 100,
        ) / 100
      }

      c.res = new Response(JSON.stringify(body), {
        status: c.res.status,
        headers: c.res.headers,
      })
    }
  } catch {
    // Pass through
  }
}
