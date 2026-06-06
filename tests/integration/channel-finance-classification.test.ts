import { describe, expect, it } from "vitest";
import { classifyChannelFinancePayload } from "../../src/shared/channel-finance";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

describe("channel finance classification", () => {
  it("classifies ad spend as channel operating expense", async () => {
    const classified = classifyChannelFinancePayload({
      operationType: "services",
      operationTypeName: "Рекламное продвижение товара",
      amountRub: 450
    });

    expect(classified.eventKind).toBe("commission");
    expect(classified.category).toBe("ads");
    expect(classified.treatment).toBe("channel_operating");
  });

  it("classifies sale-linked logistics as variable marketplace expense", async () => {
    const classified = classifyChannelFinancePayload({
      operationType: "delivery",
      operationTypeName: "Последняя миля по заказу",
      postingNumber: "12345-0001",
      amountRub: 280
    });

    expect(classified.eventKind).toBe("logistics");
    expect(classified.category).toBe("last_mile_logistics");
    expect(classified.treatment).toBe("sale_variable");
  });

  it("classifies Ozon cost per click as marketing expense", async () => {
    const classified = classifyChannelFinancePayload({
      operationType: "OperationMarketplaceCostPerClick",
      operationTypeName: "Оплата за клик",
      amountRub: 120.5
    });

    expect(classified.eventKind).toBe("commission");
    expect(classified.category).toBe("ads");
    expect(classified.treatment).toBe("channel_operating");
  });

  it("classifies Ozon FBO handling as channel operating expense even with posting number", async () => {
    const classified = classifyChannelFinancePayload({
      operationType: "OperationMarketplaceSupplyAdditional",
      operationTypeName: "Обработка товара в составе грузоместа на FBO",
      postingNumber: "2000040854716",
      amountRub: 400
    });

    expect(classified.eventKind).toBe("logistics");
    expect(classified.category).toBe("inbound_handling");
    expect(classified.treatment).toBe("channel_operating");
  });

  it("classifies Ozon acquiring by exact operation type", async () => {
    const classified = classifyChannelFinancePayload({
      operationType: "MarketplaceRedistributionOfAcquiringOperation",
      operationTypeName: "Оплата эквайринга",
      postingNumber: "0165433140-0115",
      amountRub: 5.6
    });

    expect(classified.eventKind).toBe("commission");
    expect(classified.category).toBe("acquiring");
    expect(classified.treatment).toBe("sale_variable");
  });

  it("defaults manually linked finance event to sale variable treatment", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "QA", accountingStartDate: "2026-01-01" });
    const channel = await app.createSalesChannel({ name: "Marketplace", channelType: "marketplace" });
    const sale = await app.recordSale({
      channelId: channel.id,
      saleDate: "2026-01-02",
      post: false,
      lines: []
    });

    const event = await app.recordChannelFee({
      channelId: channel.id,
      eventKind: "commission",
      occurredAt: "2026-01-03",
      amountRub: 100,
      linkedSaleId: sale.id,
      post: false
    });

    expect(event.treatment).toBe("sale_variable");
  });

  it("allows zero-amount channel finance events", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "QA", accountingStartDate: "2026-01-01" });
    const channel = await app.createSalesChannel({ name: "Marketplace", channelType: "marketplace" });

    const event = await app.recordChannelFee({
      channelId: channel.id,
      eventKind: "commission",
      occurredAt: "2026-01-03",
      amountRub: 0,
      post: false
    });

    expect(event.amountRub).toBe(0);
  });
});
