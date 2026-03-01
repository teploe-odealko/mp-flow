export async function initialBalance(container, input) {
    const supplierService = container.resolve("supplierOrderService");
    const order = await supplierService.createSupplierOrders({
        user_id: input.user_id || null,
        supplier_name: "Начальный остаток",
        order_number: `INIT-${Date.now()}`,
        type: "manual", status: "received",
        received_at: new Date(), order_date: new Date(),
        notes: "Оприходование начального остатка",
    });
    const results = [];
    for (const item of input.items) {
        const totalCost = item.unit_cost_rub * item.quantity;
        const orderItem = await supplierService.createSupplierOrderItems({
            order_id: order.id, master_card_id: item.master_card_id,
            ordered_qty: item.quantity, received_qty: item.quantity,
            purchase_price_rub: item.unit_cost_rub, unit_cost: item.unit_cost_rub,
            total_cost: totalCost, status: "received",
        });
        results.push({ itemId: orderItem.id, masterCardId: item.master_card_id });
    }
    return { order_id: order.id, items: results };
}
//# sourceMappingURL=initial-balance.js.map