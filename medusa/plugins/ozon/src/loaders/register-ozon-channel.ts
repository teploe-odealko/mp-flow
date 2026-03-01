import type { MedusaContainer } from "@medusajs/framework"

const SALE_MODULE = "saleModuleService"

export default async function registerOzonChannel(container: MedusaContainer) {
  try {
    const saleService: any = container.resolve(SALE_MODULE)

    // Check if channel already exists
    const existing = await saleService.listSalesChannels({ code: "ozon" })
    if (existing.length > 0) return

    await saleService.createSalesChannels({
      code: "ozon",
      name: "Ozon",
      icon: "🟦",
      is_marketplace: true,
      is_active: true,
    })
  } catch {
    // Sale module may not be available yet — skip silently
  }
}
