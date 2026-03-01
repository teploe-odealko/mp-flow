import { createContainer, asClass, asValue, asFunction } from "awilix";
let container = null;
export function createAppContainer(orm, config) {
    container = createContainer();
    container.register({
        orm: asValue(orm),
        config: asValue(config),
    });
    return container;
}
export function getContainer() {
    if (!container)
        throw new Error("Container not initialized");
    return container;
}
export { asClass, asValue, asFunction };
//# sourceMappingURL=container.js.map