var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Entity, PrimaryKey, Property, Index, Enum, Unique } from "@mikro-orm/core";
import { v4 } from "uuid";
let Sale = class Sale {
    id = v4();
    user_id;
    master_card_id;
    channel;
    channel_order_id;
    channel_sku;
    product_name;
    quantity = 1;
    price_per_unit = 0;
    revenue = 0;
    unit_cogs = 0;
    total_cogs = 0;
    fee_details;
    status = "active";
    sold_at;
    currency_code = "RUB";
    notes;
    metadata;
    created_at = new Date();
    updated_at = new Date();
    deleted_at;
};
__decorate([
    PrimaryKey({ type: "text" }),
    __metadata("design:type", String)
], Sale.prototype, "id", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    Index(),
    __metadata("design:type", Object)
], Sale.prototype, "user_id", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    Index(),
    __metadata("design:type", Object)
], Sale.prototype, "master_card_id", void 0);
__decorate([
    Property({ type: "text" }),
    Index(),
    __metadata("design:type", String)
], Sale.prototype, "channel", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], Sale.prototype, "channel_order_id", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], Sale.prototype, "channel_sku", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], Sale.prototype, "product_name", void 0);
__decorate([
    Property({ type: "int", default: 1 }),
    __metadata("design:type", Number)
], Sale.prototype, "quantity", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], Sale.prototype, "price_per_unit", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], Sale.prototype, "revenue", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], Sale.prototype, "unit_cogs", void 0);
__decorate([
    Property({ type: "numeric", default: 0 }),
    __metadata("design:type", Number)
], Sale.prototype, "total_cogs", void 0);
__decorate([
    Property({ type: "json", nullable: true }),
    __metadata("design:type", Object)
], Sale.prototype, "fee_details", void 0);
__decorate([
    Enum({ items: ["active", "delivered", "returned"], default: "active" }),
    Index(),
    __metadata("design:type", String)
], Sale.prototype, "status", void 0);
__decorate([
    Property({ type: "timestamptz" }),
    Index(),
    __metadata("design:type", Date)
], Sale.prototype, "sold_at", void 0);
__decorate([
    Property({ type: "text", default: "RUB" }),
    __metadata("design:type", String)
], Sale.prototype, "currency_code", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], Sale.prototype, "notes", void 0);
__decorate([
    Property({ type: "json", nullable: true }),
    __metadata("design:type", Object)
], Sale.prototype, "metadata", void 0);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()" }),
    __metadata("design:type", Date)
], Sale.prototype, "created_at", void 0);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() }),
    __metadata("design:type", Date)
], Sale.prototype, "updated_at", void 0);
__decorate([
    Property({ type: "timestamptz", nullable: true }),
    __metadata("design:type", Object)
], Sale.prototype, "deleted_at", void 0);
Sale = __decorate([
    Entity({ tableName: "sale" }),
    Unique({
        properties: ["channel", "channel_order_id", "channel_sku"],
        expression: `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_sale_channel_channel_order_id_channel_sku_unique" ON "sale" ("channel", "channel_order_id", "channel_sku") WHERE channel_order_id IS NOT NULL AND channel_sku IS NOT NULL AND deleted_at IS NULL`,
    })
], Sale);
export { Sale };
//# sourceMappingURL=entity.js.map