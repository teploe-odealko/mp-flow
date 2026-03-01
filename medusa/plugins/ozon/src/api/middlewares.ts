import { defineMiddlewares } from "@medusajs/framework/http"
import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework"
import { OZON_MODULE } from "../modules/ozon-integration"

const SALE_MODULE = "saleModuleService"

/**
 * Middleware that enriches /admin/catalog GET response with Ozon data.
 * Handles both list (body.products[]) and detail (body.product) responses.
 */
async function ozonCatalogEnrichmentMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (req.method !== "GET") {
    return next()
  }

  const originalJson = res.json.bind(res)

  res.json = (body: any) => {
    const ozonService: any = req.scope.resolve(OZON_MODULE)

    // List: enrich body.products[]
    if (body?.products && Array.isArray(body.products)) {
      Promise.all(
        body.products.map(async (product: any) => {
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
                0
              )
            }
          } catch {
            // Plugin data unavailable, skip enrichment
          }
          return product
        })
      ).then((enrichedProducts) => {
        body.products = enrichedProducts
        return originalJson(body)
      }).catch(() => {
        return originalJson(body)
      })

      return res
    }

    // Detail: enrich body.product
    if (body?.product && body.product.id) {
      enrichProductDetail(ozonService, req, body.product).then((enriched) => {
        body.product = enriched
        return originalJson(body)
      }).catch(() => {
        return originalJson(body)
      })

      return res
    }

    return originalJson(body)
  }

  next()
}

/**
 * Enrich a single product detail with Ozon link, stock, and sales.
 */
async function enrichProductDetail(ozonService: any, req: MedusaRequest, product: any) {
  try {
    const links = await ozonService.listOzonProductLinks({
      master_card_id: product.id,
    })
    if (links.length > 0) {
      const ozonLink = links[0]
      product.ozon = {
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
        product.ozon_stock = {
          fbo_present: snapshots.reduce((s: number, snap: any) => s + (snap.fbo_present || 0), 0),
          fbo_reserved: snapshots.reduce((s: number, snap: any) => s + (snap.fbo_reserved || 0), 0),
          last_synced: snapshots[0]?.synced_at || null,
        }
      } catch { /* skip */ }

      // Recent sales from core Sale module (channel=ozon)
      try {
        const saleService: any = req.scope.resolve(SALE_MODULE)
        const sales = await saleService.listSales(
          { master_card_id: product.id, channel: "ozon" },
          { order: { sold_at: "DESC" }, take: 50 }
        )
        product.recent_sales = sales.map((s: any) => ({
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
  } catch {
    // Plugin data unavailable, skip
  }
  return product
}

/**
 * Middleware that enriches /admin/inventory GET response with Ozon data.
 */
async function ozonInventoryEnrichmentMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (req.method !== "GET") {
    return next()
  }

  const originalJson = res.json.bind(res)

  res.json = (body: any) => {
    if (!body?.rows || !Array.isArray(body.rows)) {
      return originalJson(body)
    }

    const ozonService: any = req.scope.resolve(OZON_MODULE)
    const saleService: any = req.scope.resolve(SALE_MODULE)

    Promise.all(
      body.rows.map(async (row: any) => {
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
              0
            )

            // Sold qty from core Sale module
            const sales = await saleService.listSales({
              master_card_id: row.card_id,
              channel: "ozon",
              status: { $in: ["active", "delivered"] },
            })
            row.sold_qty = sales.reduce(
              (s: number, sale: any) => s + (sale.quantity || 0),
              0
            )
          }
        } catch {
          // Plugin data unavailable, skip
        }
        return row
      })
    ).then((enrichedRows) => {
      body.rows = enrichedRows
      let totalOzonStock = 0
      for (const row of enrichedRows) {
        totalOzonStock += row.ozon_fbo || 0
      }
      if (body.totals) {
        body.totals.ozon_fbo = totalOzonStock
      }
      return originalJson(body)
    }).catch(() => {
      return originalJson(body)
    })

    return res
  }

  next()
}

/**
 * Middleware that enriches /admin/inventory/sku/:cardId detail with Ozon data.
 */
async function ozonInventoryDetailMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (req.method !== "GET") {
    return next()
  }

  const originalJson = res.json.bind(res)

  res.json = (body: any) => {
    if (!body?.card) {
      return originalJson(body)
    }

    const ozonService: any = req.scope.resolve(OZON_MODULE)
    const saleService: any = req.scope.resolve(SALE_MODULE)
    const cardId = body.card.id

    ;(async () => {
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
                fbo_present: snapshots.reduce(
                  (s: number, snap: any) => s + (snap.fbo_present || 0), 0
                ),
                fbo_reserved: snapshots.reduce(
                  (s: number, snap: any) => s + (snap.fbo_reserved || 0), 0
                ),
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

          // Recent sales from core Sale module
          try {
            const sales = await saleService.listSales(
              { master_card_id: cardId, channel: "ozon" },
              { order: { sold_at: "DESC" }, take: 50 }
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
                (s: number, sale: any) => s + (sale.quantity || 0), 0
              )
              body.summary.total_revenue = Math.round(
                sales.reduce(
                  (s: number, sale: any) => s + Number(sale.revenue || 0), 0
                ) * 100
              ) / 100
            }
          } catch { /* skip */ }
        }
      } catch {
        // Plugin data unavailable, skip
      }

      return originalJson(body)
    })()

    return res
  }

  next()
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/catalog",
      method: ["GET"],
      middlewares: [ozonCatalogEnrichmentMiddleware],
    },
    {
      matcher: "/admin/catalog/:id",
      method: ["GET"],
      middlewares: [ozonCatalogEnrichmentMiddleware],
    },
    {
      matcher: "/admin/inventory",
      method: ["GET"],
      middlewares: [ozonInventoryEnrichmentMiddleware],
    },
    {
      matcher: "/admin/inventory/sku/:cardId",
      method: ["GET"],
      middlewares: [ozonInventoryDetailMiddleware],
    },
  ],
})
