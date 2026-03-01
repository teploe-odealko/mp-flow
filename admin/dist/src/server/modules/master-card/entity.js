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
let MasterCard = class MasterCard {
    id = v4();
    user_id;
    title;
    sku;
    description;
    status = "draft";
    thumbnail;
    metadata;
    created_at = new Date();
    updated_at = new Date();
    deleted_at;
};
__decorate([
    PrimaryKey({ type: "text" }),
    __metadata("design:type", String)
], MasterCard.prototype, "id", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    Index(),
    __metadata("design:type", Object)
], MasterCard.prototype, "user_id", void 0);
__decorate([
    Property({ type: "text" }),
    __metadata("design:type", String)
], MasterCard.prototype, "title", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    Index(),
    __metadata("design:type", Object)
], MasterCard.prototype, "sku", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], MasterCard.prototype, "description", void 0);
__decorate([
    Enum({ items: ["active", "draft", "archived"], default: "draft" }),
    Index(),
    __metadata("design:type", String)
], MasterCard.prototype, "status", void 0);
__decorate([
    Property({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], MasterCard.prototype, "thumbnail", void 0);
__decorate([
    Property({ type: "json", nullable: true }),
    __metadata("design:type", Object)
], MasterCard.prototype, "metadata", void 0);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()" }),
    __metadata("design:type", Date)
], MasterCard.prototype, "created_at", void 0);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() }),
    __metadata("design:type", Date)
], MasterCard.prototype, "updated_at", void 0);
__decorate([
    Property({ type: "timestamptz", nullable: true }),
    __metadata("design:type", Object)
], MasterCard.prototype, "deleted_at", void 0);
MasterCard = __decorate([
    Entity({ tableName: "master_card" })
], MasterCard);
export { MasterCard };
//# sourceMappingURL=entity.js.map