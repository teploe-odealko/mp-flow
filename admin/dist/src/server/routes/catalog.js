import { Hono } from "hono";
import { getUserId } from "../core/auth.js";
import { calculateAvgCost, getAvailableStock } from "../utils/cost-stock.js";
const catalog = new Hono();
// GET /api/catalog
catalog.get("/", async (c) => {
    const cardService = c.get("container").resolve("masterCardService");
    const supplierService = c.get("container").resolve("supplierOrderService");
    const saleService = c.get("container").resolve("saleService");
    const userId = getUserId(c);
    const { q, status, limit = "50", offset = "0" } = c.req.query();
    const filters = {};
    if (userId)
        filters.user_id = userId;
    if (status)
        filters.status = status;
    if (q) {
        filters.$or = [
            { title: { $ilike: `%${q}%` } },
            { sku: { $ilike: `%${q}%` } },
        ];
    }
    const cards = await cardService.list(filters, {
        order: { created_at: "DESC" },
        skip: Number(offset),
        take: Number(limit),
    });
    const enriched = await Promise.all(cards.map(async (card) => {
        let warehouseStock = 0, avgCost = 0;
        try {
            warehouseStock = await getAvailableStock(supplierService, saleService, card.id);
            avgCost = await calculateAvgCost(supplierService, card.id);
        }
        catch { /* no data */ }
        return { ...card, warehouse_stock: warehouseStock, avg_cost: avgCost };
    }));
    return c.json({ products: enriched, count: enriched.length, offset: Number(offset), limit: Number(limit) });
});
// POST /api/catalog
catalog.post("/", async (c) => {
    const cardService = c.get("container").resolve("masterCardService");
    const userId = getUserId(c);
    const body = await c.req.json();
    const card = await cardService.create({
        title: body.title,
        sku: body.sku || null,
        description: body.description || null,
        status: body.status || "draft",
        thumbnail: body.thumbnail || null,
        metadata: body.metadata || null,
        user_id: userId || null,
    });
    return c.json({ product: card }, 201);
});
// GET /api/catalog/:id
catalog.get("/:id", async (c) => {
    const { id } = c.req.param();
    const cardService = c.get("container").resolve("masterCardService");
    const supplierService = c.get("container").resolve("supplierOrderService");
    const saleService = c.get("container").resolve("saleService");
    const userId = getUserId(c);
    let card;
    try {
        card = await cardService.retrieve(id);
    }
    catch {
        return c.json({ error: "Product not found" }, 404);
    }
    if (userId && card.user_id && card.user_id !== userId) {
        return c.json({ error: "Product not found" }, 404);
    }
    let warehouseStock = 0, avgCost = 0;
    try {
        warehouseStock = await getAvailableStock(supplierService, saleService, id);
        avgCost = await calculateAvgCost(supplierService, id);
    }
    catch { /* no data */ }
    let supplierItems = [];
    try {
        supplierItems = await supplierService.listSupplierOrderItems({ master_card_id: id });
    }
    catch { }
    return c.json({
        product: {
            ...card, warehouse_stock: warehouseStock, avg_cost: avgCost,
            supplier_orders: supplierItems.map((item) => ({
                id: item.id, supplier_order_id: item.supplier_order_id,
                ordered_qty: item.ordered_qty, received_qty: item.received_qty,
                unit_cost: item.unit_cost, status: item.status,
            })),
        },
    });
});
// PUT /api/catalog/:id
catalog.put("/:id", async (c) => {
    const { id } = c.req.param();
    const cardService = c.get("container").resolve("masterCardService");
    const userId = getUserId(c);
    let existing;
    try {
        existing = await cardService.retrieve(id);
    }
    catch {
        return c.json({ error: "Product not found" }, 404);
    }
    if (userId && existing.user_id && existing.user_id !== userId)
        return c.json({ error: "Product not found" }, 404);
    const body = await c.req.json();
    const updateData = {};
    if (body.title !== undefined)
        updateData.title = body.title;
    if (body.sku !== undefined)
        updateData.sku = body.sku;
    if (body.description !== undefined)
        updateData.description = body.description;
    if (body.status !== undefined)
        updateData.status = body.status;
    if (body.thumbnail !== undefined)
        updateData.thumbnail = body.thumbnail;
    if (body.metadata !== undefined)
        updateData.metadata = body.metadata;
    const card = await cardService.update(id, updateData);
    return c.json({ product: card });
});
// DELETE /api/catalog/:id
catalog.delete("/:id", async (c) => {
    const { id } = c.req.param();
    const cardService = c.get("container").resolve("masterCardService");
    const userId = getUserId(c);
    let existing;
    try {
        existing = await cardService.retrieve(id);
    }
    catch {
        return c.json({ error: "Product not found" }, 404);
    }
    if (userId && existing.user_id && existing.user_id !== userId)
        return c.json({ error: "Product not found" }, 404);
    await cardService.delete(id);
    return c.json({ id, deleted: true });
});
export default catalog;
//# sourceMappingURL=catalog.js.map