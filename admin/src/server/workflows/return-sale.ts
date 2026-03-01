import type { AwilixContainer } from "awilix"
import type { SaleService } from "../modules/sale/service.js"
import type { FinanceService } from "../modules/finance/service.js"

export async function returnSale(container: AwilixContainer, input: { sale_id: string }) {
  const saleService: SaleService = container.resolve("saleService")
  const financeService: FinanceService = container.resolve("financeService")

  const sale = await saleService.retrieveSale(input.sale_id)
  if (!sale) throw new Error("Sale not found")
  if (sale.status === "returned") throw new Error("Sale already returned")

  await saleService.updateSales({ id: input.sale_id, status: "returned" })

  const revenue = Number(sale.revenue || 0)
  if (revenue > 0) {
    await financeService.createFinanceTransactions({
      user_id: sale.user_id, type: "refund", direction: "expense",
      amount: revenue, currency_code: "RUB", order_id: sale.id,
      category: "refund", description: `Refund for sale ${sale.id}`,
      transaction_date: new Date(), source: "system",
    })
  }

  return { success: true, sale_id: input.sale_id }
}
