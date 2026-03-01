import { Hono } from "hono";
import { getUserId } from "../core/auth.js";
import { calculateAvgCost, getAvailableStock } from "../utils/cost-stock.js";
import { initialBalance } from "../workflows/initial-balance.js";
import { writeOff } from "../workflows/write-off.js";
const inventory = new Hono();
// GET /api/inventory
inventory.get("/", async (c) => {
    const cardService = c.get("container").resolve("masterCardService");
    const supplierService = c.get("container").resolve("supplierOrderService");
    const saleService = c.get("container").resolve("saleService");
    const userId = getUserId(c);
    const { q, limit = "50", offset = "0" } = c.req.query();
    const filters = {};
    if (userId)
        filters.user_id = userId;
    if (q) {
        filters.$or = [{ title: { $ilike: `%${q}%` } }, { sku: { $ilike: `%${q}%` } }];
    }
    const cards = await cardService.list(filters, {
        order: { title: "ASC" }, skip: Number(offset), take: Number(limit),
    });
    let totalWarehouseStock = 0, totalStockValue = 0;
    const rows = [];
    for (const card of cards) {
        let orderedQty = 0, receivedQty = 0;
        try {
            const items = await supplierService.listSupplierOrderItems({ master_card_id: card.id });
            orderedQty = items.reduce((s, i) => s + (i.ordered_qty || 0), 0);
            receivedQty = items.reduce((s, i) => s + (i.received_qty || 0), 0);
        }
        catch { }
        let warehouseStock = 0, avgCost = 0;
        try {
            warehouseStock = await getAvailableStock(supplierService, saleService, card.id);
            avgCost = await calculateAvgCost(supplierService, card.id);
        }
        catch { }
        totalWarehouseStock += warehouseStock;
        totalStockValue += warehouseStock * avgCost;
        rows.push({
            card_id: card.id, product_title: card.title, sku: card.sku,
            ordered_qty: orderedQty, received_qty: receivedQty,
            warehouse_stock: warehouseStock, avg_cost: avgCost,
        });
    }
    return c.json({
        rows, totals: { products: rows.length, warehouse_stock: totalWarehouseStock, stock_value: Math.round(totalStockValue * 100) / 100 },
        count: rows.length, offset: Number(offset), limit: Number(limit),
    });
});
// GET /api/inventory/sku/:cardId
inventory.get("/sku/:cardId", async (c) => {
    const { cardId } = c.req.param();
    const cardService = c.get("container").resolve("masterCardService");
    const supplierService = c.get("container").resolve("supplierOrderService");
    const saleService = c.get("container").resolve("saleService");
    const financeService = c.get("container").resolve("financeService");
    const userId = getUserId(c);
    let card;
    try {
        card = await cardService.retrieve(cardId);
    }
    catch {
        return c.json({ error: "Card not found" }, 404);
    }
    if (userId && card.user_id && card.user_id !== userId)
        return c.json({ error: "Card not found" }, 404);
    const supplierItems = await supplierService.listSupplierOrderItems({ master_card_id: cardId });
    const supplierItemsEnriched = await Promise.all(supplierItems.map(async (item) => {
        let orderInfo = null;
        try {
            orderInfo = await supplierService.retrieveSupplierOrder(item.supplier_order_id);
        }
        catch { }
        return { ...item, order_number: orderInfo?.order_number, supplier_name: orderInfo?.supplier_name, order_status: orderInfo?.status, order_type: orderInfo?.type };
    }));
    const saleList = await saleService.listSales({ master_card_id: cardId });
    const transactions = await financeService.listFinanceTransactions({ master_card_id: cardId });
    const warehouseStock = await getAvailableStock(supplierService, saleService, cardId);
    const avgCost = await calculateAvgCost(supplierService, cardId);
    return c.json({
        card: { id: card.id, title: card.title, sku: card.sku },
        summary: { warehouse_stock: warehouseStock, avg_cost: avgCost, stock_value: Math.round(warehouseStock * avgCost * 100) / 100 },
        supplier_orders: supplierItemsEnriched,
        sales: saleList.map((s) => ({
            id: s.id, channel: s.channel, channel_order_id: s.channel_order_id,
            quantity: s.quantity, revenue: s.revenue, total_cogs: s.total_cogs,
            fee_details: s.fee_details, status: s.status, sold_at: s.sold_at,
        })),
        finance_movements: transactions.map((t) => ({
            id: t.id, type: t.type, direction: t.direction, amount: t.amount,
            category: t.category, description: t.description, transaction_date: t.transaction_date,
        })),
    });
});
// POST /api/inventory — actions
inventory.post("/", async (c) => {
    const body = await c.req.json();
    const container = c.get("container");
    const userId = getUserId(c);
    if (body.action === "initial-balance") {
        if (!body.items?.length)
            return c.json({ error: "Items required" }, 400);
        const result = await initialBalance(container, { items: body.items, user_id: userId });
        return c.json({ success: true, result });
    }
    else if (body.action === "write-off") {
        if (!body.master_card_id || !body.quantity)
            return c.json({ error: "master_card_id and quantity required" }, 400);
        const result = await writeOff(container, { master_card_id: body.master_card_id, quantity: body.quantity, reason: body.reason, user_id: userId });
        return c.json({ success: true, result });
    }
    return c.json({ error: `Unknown action: ${body.action}` }, 400);
});
export default inventory;
//# sourceMappingURL=inventory.js.map