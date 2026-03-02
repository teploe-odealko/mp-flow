export async function unreceiveOrder(container, input) {
    const supplierService = container.resolve("supplierOrderService");
    const financeService = container.resolve("financeService");
    const order = await supplierService.retrieveSupplierOrder(input.supplier_order_id);
    if (order.status !== "received")
        throw new Error("Можно отменить приёмку только для принятых заказов");
    const items = await supplierService.listSupplierOrderItems({ order_id: input.supplier_order_id });
    // Reset items
    for (const item of items) {
        await supplierService.updateSupplierOrderItems({ id: item.id, received_qty: 0, status: "pending" });
    }
    await supplierService.updateSupplierOrders({ id: input.supplier_order_id, status: "draft", received_at: null });
    // Delete finance transactions
    const txs = await financeService.listFinanceTransactions({ supplier_order_id: input.supplier_order_id, type: "supplier_payment" });
    for (const tx of txs)
        await financeService.deleteFinanceTransactions(tx.id);
    return { success: true };
}
//# sourceMappingURL=unreceive-order.js.map