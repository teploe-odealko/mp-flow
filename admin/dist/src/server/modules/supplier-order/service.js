import { SupplierOrder, SupplierOrderItem, Supplier } from "./entities.js";
export class SupplierOrderService {
    em;
    constructor(em) {
        this.em = em;
    }
    // ── Supplier Orders ──
    async listSupplierOrders(filters = {}, options) {
        const where = { deleted_at: null };
        if (filters.user_id)
            where.user_id = filters.user_id;
        if (filters.status)
            where.status = filters.status;
        if (filters.$or)
            where.$or = filters.$or;
        return this.em.find(SupplierOrder, where, {
            orderBy: options?.order || { created_at: "DESC" },
            offset: options?.skip,
            limit: options?.take,
        });
    }
    async retrieveSupplierOrder(id) {
        return this.em.findOneOrFail(SupplierOrder, { id, deleted_at: null });
    }
    async createSupplierOrders(data) {
        const order = this.em.create(SupplierOrder, { ...data, deleted_at: null });
        await this.em.persistAndFlush(order);
        return order;
    }
    async updateSupplierOrders(data) {
        const { id, ...rest } = data;
        const order = await this.retrieveSupplierOrder(id);
        this.em.assign(order, rest);
        await this.em.flush();
        return order;
    }
    async deleteSupplierOrders(id) {
        const order = await this.retrieveSupplierOrder(id);
        order.deleted_at = new Date();
        // Also soft-delete items
        const items = await this.em.find(SupplierOrderItem, { order: { id }, deleted_at: null });
        for (const item of items)
            item.deleted_at = new Date();
        await this.em.flush();
    }
    // ── Supplier Order Items ──
    async listSupplierOrderItems(filters = {}) {
        const where = { deleted_at: null };
        if (filters.master_card_id)
            where.master_card_id = filters.master_card_id;
        if (filters.order_id || filters.supplier_order_id) {
            where.order = { id: filters.order_id || filters.supplier_order_id };
        }
        if (filters.received_qty)
            where.received_qty = filters.received_qty;
        if (filters.ozon_account_id)
            where.ozon_account_id = filters.ozon_account_id;
        return this.em.find(SupplierOrderItem, where, { populate: ["order"] });
    }
    async createSupplierOrderItems(data) {
        const { order_id, ...rest } = data;
        const order = await this.em.findOneOrFail(SupplierOrder, { id: order_id });
        const item = this.em.create(SupplierOrderItem, { ...rest, order, deleted_at: null });
        await this.em.persistAndFlush(item);
        return item;
    }
    async updateSupplierOrderItems(data) {
        const { id, ...rest } = data;
        const item = await this.em.findOneOrFail(SupplierOrderItem, { id, deleted_at: null });
        this.em.assign(item, rest);
        await this.em.flush();
        return item;
    }
    async deleteSupplierOrderItems(id) {
        const item = await this.em.findOneOrFail(SupplierOrderItem, { id, deleted_at: null });
        item.deleted_at = new Date();
        await this.em.flush();
    }
    // ── Suppliers Registry ──
    async listSuppliers(filters = {}, options) {
        const where = { deleted_at: null };
        if (filters.user_id)
            where.user_id = filters.user_id;
        if (filters.name)
            where.name = filters.name;
        return this.em.find(Supplier, where, {
            orderBy: options?.order || { name: "ASC" },
        });
    }
    async retrieveSupplier(id) {
        return this.em.findOneOrFail(Supplier, { id, deleted_at: null });
    }
    async createSuppliers(data) {
        const supplier = this.em.create(Supplier, { ...data, deleted_at: null });
        await this.em.persistAndFlush(supplier);
        return supplier;
    }
    async updateSuppliers(data) {
        const { id, ...rest } = data;
        const supplier = await this.retrieveSupplier(id);
        this.em.assign(supplier, rest);
        await this.em.flush();
        return supplier;
    }
    async deleteSuppliers(id) {
        const supplier = await this.retrieveSupplier(id);
        supplier.deleted_at = new Date();
        await this.em.flush();
    }
}
//# sourceMappingURL=service.js.map