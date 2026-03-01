var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Entity, PrimaryKey, Property, Index, Unique } from "@mikro-orm/core";
import { v4 } from "uuid";
let PluginSetting = class PluginSetting {
    id = v4();
    plugin_name;
    user_id;
    is_enabled = true;
    created_at = new Date();
    updated_at = new Date();
};
__decorate([
    PrimaryKey({ type: "text" }),
    __metadata("design:type", String)
], PluginSetting.prototype, "id", void 0);
__decorate([
    Property({ type: "text" }),
    Index(),
    __metadata("design:type", String)
], PluginSetting.prototype, "plugin_name", void 0);
__decorate([
    Property({ type: "text" }),
    Index(),
    __metadata("design:type", String)
], PluginSetting.prototype, "user_id", void 0);
__decorate([
    Property({ type: "boolean", default: true }),
    __metadata("design:type", Boolean)
], PluginSetting.prototype, "is_enabled", void 0);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()" }),
    __metadata("design:type", Date)
], PluginSetting.prototype, "created_at", void 0);
__decorate([
    Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() }),
    __metadata("design:type", Date)
], PluginSetting.prototype, "updated_at", void 0);
PluginSetting = __decorate([
    Entity({ tableName: "plugin_setting" }),
    Unique({ properties: ["plugin_name", "user_id"] })
], PluginSetting);
export { PluginSetting };
//# sourceMappingURL=entity.js.map