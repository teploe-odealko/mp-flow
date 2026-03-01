var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Entity, Property, PrimaryKey, Index, Unique } from "@mikro-orm/core";
import { v4 } from "uuid";
let OzonAccount = class OzonAccount {
    id = v4();
    user_id;
    name;
    client_id;
    api_key;
    is_active = true;
    last_sync_at;
    last_error;
    total_products = 0;
    total_stocks = 0;
    auto_sync = false;
    sync_interval_minutes = 60;
    metadata;
    created_at = new Date();
    updated_at = new Date();
    deleted_at;
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", String)
], OzonAccount.prototype, "id", void 0);
__decorate([
    Property({ nullable: true }),
    Index(),
    __metadata("design:type", String)
], OzonAccount.prototype, "user_id", void 0);
__decorate([
    Property(),
    __metadata("design:type", String)
], OzonAccount.prototype, "name", void 0);
__decorate([
    Property(),
    __metadata("design:type", String)
], OzonAccount.prototype, "client_id", void 0);
__decorate([
    Property(),
    __metadata("design:type", String)
], OzonAccount.prototype, "api_key", void 0);
__decorate([
    Property({ default: true }),
    __metadata("design:type", Boolean)
], OzonAccount.prototype, "is_active", void 0);
__decorate([
    Property({ nullable: true }),
    __metadata("design:type", Date)
], OzonAccount.prototype, "last_sync_at", void 0);
__decorate([
    Property({ nullable: true, type: "text" }),
    __metadata("design:type", String)
], OzonAccount.prototype, "last_error", void 0);
__decorate([
    Property({ default: 0 }),
    __metadata("design:type", Number)
], OzonAccount.prototype, "total_products", void 0);
__decorate([
    Property({ default: 0 }),
    __metadata("design:type", Number)
], OzonAccount.prototype, "total_stocks", void 0);
__decorate([
    Property({ default: false }),
    __metadata("design:type", Boolean)
], OzonAccount.prototype, "auto_sync", void 0);
__decorate([
    Property({ default: 60 }),
    __metadata("design:type", Number)
], OzonAccount.prototype, "sync_interval_minutes", void 0);
__decorate([
    Property({ type: "jsonb", nullable: true }),
    __metadata("design:type", Object)
], OzonAccount.prototype, "metadata", void 0);
__decorate([
    Property({ defaultRaw: "now()" }),
    __metadata("design:type", Date)
], OzonAccount.prototype, "created_at", void 0);
__decorate([
    Property({ defaultRaw: "now()", onUpdate: () => new Date() }),
    __metadata("design:type", Date)
], OzonAccount.prototype, "updated_at", void 0);
__decorate([
    Property({ nullable: true }),
    __metadata("design:type", Date)
], OzonAccount.prototype, "deleted_at", void 0);
OzonAccount = __decorate([
    Entity({ tableName: "ozon_account" })
], OzonAccount);
export { OzonAccount };
let OzonProductLink = class OzonProductLink {
    id = v4();
    ozon_account_id;
    ozon_product_id;
    ozon_sku;
    ozon_fbo_sku;
    ozon_fbs_sku;
    offer_id;
    master_card_id;
    ozon_name;
    ozon_barcode;
    ozon_category_id;
    ozon_status;
    ozon_price;
    ozon_marketing_price;
    ozon_min_price;
    last_synced_at;
    raw_data;
    created_at = new Date();
    updated_at = new Date();
    deleted_at;
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", String)
], OzonProductLink.prototype, "id", void 0);
__decorate([
    Property(),
    Index(),
    __metadata("design:type", String)
], OzonProductLink.prototype, "ozon_account_id", void 0);
__decorate([
    Property({ type: "bigint" }),
    Unique(),
    __metadata("design:type", String)
], OzonProductLink.prototype, "ozon_product_id", void 0);
__decorate([
    Property({ type: "bigint", nullable: true }),
    __metadata("design:type", String)
], OzonProductLink.prototype, "ozon_sku", void 0);
__decorate([
    Property({ type: "bigint", nullable: true }),
    __metadata("design:type", String)
], OzonProductLink.prototype, "ozon_fbo_sku", void 0);
__decorate([
    Property({ type: "bigint", nullable: true }),
    __metadata("design:type", String)
], OzonProductLink.prototype, "ozon_fbs_sku", void 0);
__decorate([
    Property(),
    Index(),
    __metadata("design:type", String)
], OzonProductLink.prototype, "offer_id", void 0);
__decorate([
    Property({ nullable: true }),
    Index(),
    __metadata("design:type", String)
], OzonProductLink.prototype, "master_card_id", void 0);
__decorate([
    Property({ nullable: true }),
    __metadata("design:type", String)
], OzonProductLink.prototype, "ozon_name", void 0);
__decorate([
    Property({ nullable: true }),
    __metadata("design:type", String)
], OzonProductLink.prototype, "ozon_barcode", void 0);
__decorate([
    Property({ type: "bigint", nullable: true }),
    __metadata("design:type", String)
], OzonProductLink.prototype, "ozon_category_id", void 0);
__decorate([
    Property({ nullable: true }),
    __metadata("design:type", String)
], OzonProductLink.prototype, "ozon_status", void 0);
__decorate([
    Property({ type: "numeric", nullable: true }),
    __metadata("design:type", String)
], OzonProductLink.prototype, "ozon_price", void 0);
__decorate([
    Property({ type: "numeric", nullable: true }),
    __metadata("design:type", String)
], OzonProductLink.prototype, "ozon_marketing_price", void 0);
__decorate([
    Property({ type: "numeric", nullable: true }),
    __metadata("design:type", String)
], OzonProductLink.prototype, "ozon_min_price", void 0);
__decorate([
    Property({ nullable: true }),
    __metadata("design:type", Date)
], OzonProductLink.prototype, "last_synced_at", void 0);
__decorate([
    Property({ type: "jsonb", nullable: true }),
    __metadata("design:type", Object)
], OzonProductLink.prototype, "raw_data", void 0);
__decorate([
    Property({ defaultRaw: "now()" }),
    __metadata("design:type", Date)
], OzonProductLink.prototype, "created_at", void 0);
__decorate([
    Property({ defaultRaw: "now()", onUpdate: () => new Date() }),
    __metadata("design:type", Date)
], OzonProductLink.prototype, "updated_at", void 0);
__decorate([
    Property({ nullable: true }),
    __metadata("design:type", Date)
], OzonProductLink.prototype, "deleted_at", void 0);
OzonProductLink = __decorate([
    Entity({ tableName: "ozon_product_link" })
], OzonProductLink);
export { OzonProductLink };
let OzonStockSnapshot = class OzonStockSnapshot {
    id = v4();
    ozon_account_id;
    master_card_id;
    offer_id;
    ozon_sku;
    fbo_present = 0;
    fbo_reserved = 0;
    fbs_present = 0;
    fbs_reserved = 0;
    warehouse_name;
    synced_at;
    created_at = new Date();
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", String)
], OzonStockSnapshot.prototype, "id", void 0);
__decorate([
    Property(),
    Index(),
    __metadata("design:type", String)
], OzonStockSnapshot.prototype, "ozon_account_id", void 0);
__decorate([
    Property({ nullable: true }),
    Index(),
    __metadata("design:type", String)
], OzonStockSnapshot.prototype, "master_card_id", void 0);
__decorate([
    Property(),
    Index(),
    __metadata("design:type", String)
], OzonStockSnapshot.prototype, "offer_id", void 0);
__decorate([
    Property({ type: "bigint", nullable: true }),
    __metadata("design:type", String)
], OzonStockSnapshot.prototype, "ozon_sku", void 0);
__decorate([
    Property({ default: 0 }),
    __metadata("design:type", Number)
], OzonStockSnapshot.prototype, "fbo_present", void 0);
__decorate([
    Property({ default: 0 }),
    __metadata("design:type", Number)
], OzonStockSnapshot.prototype, "fbo_reserved", void 0);
__decorate([
    Property({ default: 0 }),
    __metadata("design:type", Number)
], OzonStockSnapshot.prototype, "fbs_present", void 0);
__decorate([
    Property({ default: 0 }),
    __metadata("design:type", Number)
], OzonStockSnapshot.prototype, "fbs_reserved", void 0);
__decorate([
    Property({ nullable: true }),
    __metadata("design:type", String)
], OzonStockSnapshot.prototype, "warehouse_name", void 0);
__decorate([
    Property(),
    __metadata("design:type", Date)
], OzonStockSnapshot.prototype, "synced_at", void 0);
__decorate([
    Property({ defaultRaw: "now()" }),
    __metadata("design:type", Date)
], OzonStockSnapshot.prototype, "created_at", void 0);
OzonStockSnapshot = __decorate([
    Entity({ tableName: "ozon_stock_snapshot" })
], OzonStockSnapshot);
export { OzonStockSnapshot };
//# sourceMappingURL=entities.js.map