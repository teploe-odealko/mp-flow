export async function returnSale(container, input) {
    const saleService = container.resolve("saleService");
    const financeService = container.resolve("financeService");
    const sale = await saleService.retrieveSale(input.sale_id);
    if (!sale)
        throw new Error("Sale not found");
    if (sale.status === "returned")
        throw new Error("Sale already returned");
    await saleService.updateSales({ id: input.sale_id, status: "returned" });
    const revenue = Number(sale.revenue || 0);
    if (revenue > 0) {
        await financeService.createFinanceTransactions({
            user_id: sale.user_id, type: "refund", direction: "expense",
            amount: revenue, currency_code: "RUB", order_id: sale.id,
            category: "refund", description: `Refund for sale ${sale.id}`,
            transaction_date: new Date(), source: "system",
        });
    }
    return { success: true, sale_id: input.sale_id };
}
//# sourceMappingURL=return-sale.js.map