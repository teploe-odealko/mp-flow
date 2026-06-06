import type { MarketplacePlugin } from "./types";

export const wildberriesPlugin: MarketplacePlugin = {
  code: "wildberries",
  displayName: "Wildberries",
  capabilities: ["products", "sales", "returns", "finance_events", "observed_stock"],
  validateCredentials(credentials) {
    if (!credentials.token) {
      return { ok: false, message: "Для Wildberries нужен API token" };
    }
    return { ok: true };
  },
  async sync({ app, channelId }) {
    const product = app.state.products[1] ?? app.state.products[0];
    if (!product) {
      return { pluginCode: "wildberries", channelId, status: "completed", stats: { products: 0, events: 0, stocks: 0 }, errors: [] };
    }
    const external = app.createExternalProduct({
      channelId,
      externalSku: `WB-${product.sku}`,
      externalName: `${product.name} / карточка WB`
    });
    app.linkExternalProduct({ externalProductId: external.id, productId: product.id });
    app.recordObservedStock({
      channelId,
      externalProductId: external.id,
      observedAt: "2026-06-19T12:05:00.000Z",
      qtyObserved: 97
    });
    await app.ingestExternalEvent({
      channelId,
      eventType: "sale",
      externalId: "wb-sale-demo-1",
      occurredAt: "2026-06-19T14:00:00.000Z",
      payload: {
        sku: external.externalSku,
        qty: 2,
        amountRub: 980,
        source: "wildberries-demo-adapter"
      }
    });
    return { pluginCode: "wildberries", channelId, status: "completed", stats: { products: 1, events: 1, stocks: 1 }, errors: [] };
  }
};
