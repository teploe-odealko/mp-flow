import { calculateAvgCost } from "../utils/cost-stock.js";
export async function writeOff(container, input) {
    const saleService = container.resolve("saleService");
    const supplierService = container.resolve("supplierOrderService");
    const financeService = container.resolve("financeService");
    const avgCost = await calculateAvgCost(supplierService, input.master_card_id);
    const totalCost = Math.round(avgCost * input.quantity * 100) / 100;
    const sale = await saleService.createSales({
        user_id: input.user_id || null, master_card_id: input.master_card_id,
        channel: "write-off", quantity: input.quantity,
        price_per_unit: 0, revenue: 0, unit_cogs: avgCost, total_cogs: totalCost,
        fee_details: [], status: "delivered", sold_at: new Date(),
        currency_code: "RUB", notes: input.reason || "Списание",
    });
    const tx = await financeService.createFinanceTransactions({
        user_id: input.user_id || null, type: "adjustment", direction: "expense",
        amount: totalCost, currency_code: "RUB", master_card_id: input.master_card_id,
        category: "inventory_loss",
        description: input.reason || `Write-off: ${input.quantity} units`,
        transaction_date: new Date(), source: "system",
    });
    return { sale_id: sale.id, transaction: tx, cost_written_off: totalCost };
}
//# sourceMappingURL=write-off.js.map