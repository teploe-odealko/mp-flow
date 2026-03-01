var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Entity, PrimaryKey, Property, Index, Enum } from "@mikro-orm/core";
import { v4 } from "uuid";
let FinanceTransaction = class FinanceTransaction {
    id = v4();
    user_id;
    type;
    order_id;
    supplier_order_id;
    master_card_id;
    amount;
    currency_code = "RUB";
    direction;
    category;
    description;
    transaction_date;
    source;
    metadata;
    created_at = new Date();
    updated_at = new Date();
    deleted_at;
};
__decorate([
    PrimaryKey({ type: "text" }),
    __metadata("design:type", String)
], FinanceTransaction.prototype, "id", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    Index(),
    __metadata("design:type", Object)
], FinanceTransaction.prototype, "user_id", void 0);
__decorate([
    Enum({
        items: [
            "sale_revenue", "sale_commission", "sale_logistics",
            "cogs", "supplier_payment", "shipping_cost",
            "refund", "adjustment", "other",
        ],
    }),
    Index(),
    __metadata("design:type", String)
], FinanceTransaction.prototype, "type", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    Index(),
    __metadata("design:type", Object)
], FinanceTransaction.prototype, "order_id", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], FinanceTransaction.prototype, "supplier_order_id", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    Index(),
    __metadata("design:type", Object)
], FinanceTransaction.prototype, "master_card_id", void 0);
__decorate([
    Property({ type: "numeric" }),
    __metadata("design:type", Number)
], FinanceTransaction.prototype, "amount", void 0);
__decorate([
    Property({ type: "text", default: "RUB" }),
    __metadata("design:type", String)
], FinanceTransaction.prototype, "currency_code", void 0);
__decorate([
    Enum({ items: ["income", "expense"] }),
    Index(),
    __metadata("design:type", String)
], FinanceTransaction.prototype, "direction", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], FinanceTransaction.prototype, "category", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], FinanceTransaction.prototype, "description", void 0);
__decorate([
    Property({ type: "timestamptz" }),
    Index(),
    __metadata("design:type", Date)
], FinanceTransaction.prototype, "transaction_date", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], FinanceTransaction.prototype, "source", void 0);
__decorate([
    Property({ type: "json", nullable: true }),
    __metadata("design:type", Object)
], FinanceTransaction.prototype, "metadata", void 0);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()" }),
    __metadata("design:type", Date)
], FinanceTransaction.prototype, "created_at", void 0);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() }),
    __metadata("design:type", Date)
], FinanceTransaction.prototype, "updated_at", void 0);
__decorate([
    Property({ type: "timestamptz", nullable: true }),
    __metadata("design:type", Object)
], FinanceTransaction.prototype, "deleted_at", void 0);
FinanceTransaction = __decorate([
    Entity({ tableName: "finance_transaction" })
], FinanceTransaction);
export { FinanceTransaction };
//# sourceMappingURL=entity.js.map