var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Entity, PrimaryKey, Property, Index, Enum, ManyToOne, OneToMany, Collection, Cascade } from "@mikro-orm/core";
import { v4 } from "uuid";
let Supplier = class Supplier {
    id = v4();
    user_id;
    name;
    contact;
    phone;
    notes;
    metadata;
    created_at = new Date();
    updated_at = new Date();
    deleted_at;
};
__decorate([
    PrimaryKey({ type: "text" }),
    __metadata("design:type", String)
], Supplier.prototype, "id", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    Index(),
    __metadata("design:type", Object)
], Supplier.prototype, "user_id", void 0);
__decorate([
    Property({ type: "text" }),
    __metadata("design:type", String)
], Supplier.prototype, "name", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], Supplier.prototype, "contact", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], Supplier.prototype, "phone", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], Supplier.prototype, "notes", void 0);
__decorate([
    Property({ type: "json", nullable: true }),
    __metadata("design:type", Object)
], Supplier.prototype, "metadata", void 0);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()" }),
    __metadata("design:type", Date)
], Supplier.prototype, "created_at", void 0);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() }),
    __metadata("design:type", Date)
], Supplier.prototype, "updated_at", void 0);
__decorate([
    Property({ type: "timestamptz", nullable: true }),
    __metadata("design:type", Object)
], Supplier.prototype, "deleted_at", void 0);
Supplier = __decorate([
    Entity({ tableName: "supplier" })
], Supplier);
export { Supplier };
let SupplierOrder = class SupplierOrder {
    id = v4();
    user_id;
    supplier_id;
    supplier_name;
    supplier_contact;
    order_number;
    type = "purchase";
    status = "draft";
    total_amount = 0;
    currency_code = "RUB";
    shipping_cost = 0;
    tracking_number;
    shared_costs = [];
    order_date;
    ordered_at;
    expected_at;
    received_at;
    notes;
    metadata;
    items = new Collection(this);
    created_at = new Date();
    updated_at = new Date();
    deleted_at;
};
__decorate([
    PrimaryKey({ type: "text" }),
    __metadata("design:type", String)
], SupplierOrder.prototype, "id", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    Index(),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "user_id", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "supplier_id", void 0);
__decorate([
    Property({ type: "text" }),
    __metadata("design:type", String)
], SupplierOrder.prototype, "supplier_name", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "supplier_contact", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "order_number", void 0);
__decorate([
    Enum({ items: ["purchase", "manual"], default: "purchase" }),
    __metadata("design:type", String)
], SupplierOrder.prototype, "type", void 0);
__decorate([
    Enum({ items: ["draft", "ordered", "shipped", "received", "cancelled"], default: "draft" }),
    Index(),
    __metadata("design:type", String)
], SupplierOrder.prototype, "status", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], SupplierOrder.prototype, "total_amount", void 0);
__decorate([
    Property({ type: "text", default: "RUB" }),
    __metadata("design:type", String)
], SupplierOrder.prototype, "currency_code", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], SupplierOrder.prototype, "shipping_cost", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "tracking_number", void 0);
__decorate([
    Property({ type: "json", default: "[]" }),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "shared_costs", void 0);
__decorate([
    Property({ type: "timestamptz", nullable: true }),
    Index(),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "order_date", void 0);
__decorate([
    Property({ type: "timestamptz", nullable: true }),
    Index(),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "ordered_at", void 0);
__decorate([
    Property({ type: "timestamptz", nullable: true }),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "expected_at", void 0);
__decorate([
    Property({ type: "timestamptz", nullable: true }),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "received_at", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "notes", void 0);
__decorate([
    Property({ type: "json", nullable: true }),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "metadata", void 0);
__decorate([
    OneToMany(() => SupplierOrderItem, (item) => item.order, { cascade: [Cascade.ALL], orphanRemoval: true }),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "items", void 0);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()" }),
    __metadata("design:type", Date)
], SupplierOrder.prototype, "created_at", void 0);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() }),
    __metadata("design:type", Date)
], SupplierOrder.prototype, "updated_at", void 0);
__decorate([
    Property({ type: "timestamptz", nullable: true }),
    __metadata("design:type", Object)
], SupplierOrder.prototype, "deleted_at", void 0);
SupplierOrder = __decorate([
    Entity({ tableName: "supplier_order" })
], SupplierOrder);
export { SupplierOrder };
let SupplierOrderItem = class SupplierOrderItem {
    id = v4();
    master_card_id;
    ordered_qty;
    received_qty = 0;
    cny_price_per_unit = 0;
    purchase_price_rub = 0;
    packaging_cost_rub = 0;
    logistics_cost_rub = 0;
    customs_cost_rub = 0;
    extra_cost_rub = 0;
    unit_cost = 0;
    total_cost = 0;
    currency_code = "RUB";
    allocations = [];
    status = "pending";
    order;
    get supplier_order_id() {
        return this.order?.id || this.order_id;
    }
    created_at = new Date();
    updated_at = new Date();
    deleted_at;
};
__decorate([
    PrimaryKey({ type: "text" }),
    __metadata("design:type", String)
], SupplierOrderItem.prototype, "id", void 0);
__decorate([
    Property({ type: "text" }),
    Index(),
    __metadata("design:type", String)
], SupplierOrderItem.prototype, "master_card_id", void 0);
__decorate([
    Property({ type: "int" }),
    __metadata("design:type", Number)
], SupplierOrderItem.prototype, "ordered_qty", void 0);
__decorate([
    Property({ type: "int", default: 0 }),
    __metadata("design:type", Number)
], SupplierOrderItem.prototype, "received_qty", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], SupplierOrderItem.prototype, "cny_price_per_unit", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], SupplierOrderItem.prototype, "purchase_price_rub", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], SupplierOrderItem.prototype, "packaging_cost_rub", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], SupplierOrderItem.prototype, "logistics_cost_rub", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], SupplierOrderItem.prototype, "customs_cost_rub", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], SupplierOrderItem.prototype, "extra_cost_rub", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], SupplierOrderItem.prototype, "unit_cost", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], SupplierOrderItem.prototype, "total_cost", void 0);
__decorate([
    Property({ type: "text", default: "RUB" }),
    __metadata("design:type", String)
], SupplierOrderItem.prototype, "currency_code", void 0);
__decorate([
    Property({ type: "json", default: "[]" }),
    __metadata("design:type", Object)
], SupplierOrderItem.prototype, "allocations", void 0);
__decorate([
    Enum({ items: ["pending", "partial", "received", "cancelled"], default: "pending" }),
    __metadata("design:type", String)
], SupplierOrderItem.prototype, "status", void 0);
__decorate([
    ManyToOne(() => SupplierOrder, { fieldName: "order_id" }),
    __metadata("design:type", SupplierOrder)
], SupplierOrderItem.prototype, "order", void 0);
__decorate([
    Property({ type: "text", persist: false }),
    __metadata("design:type", String),
    __metadata("design:paramtypes", [])
], SupplierOrderItem.prototype, "supplier_order_id", null);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()" }),
    __metadata("design:type", Date)
], SupplierOrderItem.prototype, "created_at", void 0);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() }),
    __metadata("design:type", Date)
], SupplierOrderItem.prototype, "updated_at", void 0);
__decorate([
    Property({ type: "timestamptz", nullable: true }),
    __metadata("design:type", Object)
], SupplierOrderItem.prototype, "deleted_at", void 0);
SupplierOrderItem = __decorate([
    Entity({ tableName: "supplier_order_item" })
], SupplierOrderItem);
export { SupplierOrderItem };
//# sourceMappingURL=entities.js.map