import type { MedusaContainer } from "@medusajs/framework"
import { SALE_MODULE } from "../modules/sale"

export default async function registerManualChannel(container: MedusaContainer) {
  try {
    const saleService: any = container.resolve(SALE_MODULE)

    const existing = await saleService.listSalesChannels({ code: "manual" })
    if (existing.length > 0) return

    await saleService.createSalesChannels({
      code: "manual",
      name: "Ручная продажа",
      is_marketplace: false,
      is_active: true,
    })
  } catch {
    // Sale module may not be available yet
  }
}
