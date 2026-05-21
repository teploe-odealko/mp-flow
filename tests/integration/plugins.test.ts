import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";
import { expandOzonFinanceEvents } from "../../src/plugins/ozon";

async function post<T>(api: ReturnType<typeof createApi>, path: string, body: unknown = {}): Promise<T> {
  const response = await api.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const payload = await response.json() as { ok: boolean; data: T; error?: { code: string; message: string } };
  if (!payload.ok) throw new Error(`${payload.error?.code}: ${payload.error?.message}`);
  return payload.data;
}

async function get<T>(api: ReturnType<typeof createApi>, path: string): Promise<T> {
  const response = await api.request(path);
  const payload = await response.json() as { ok: boolean; data: T };
  return payload.data;
}

describe("marketplace plugins", () => {
  it("expands Ozon sale settlement into commission and logistics components", () => {
    const events = expandOzonFinanceEvents({
      operation_id: 50944820885,
      operation_type: "OperationAgentDeliveredToCustomer",
      operation_type_name: "Доставка покупателю",
      operation_date: "2026-05-09 00:00:00",
      accruals_for_sale: 725,
      sale_commission: -319,
      amount: 323.87,
      posting: { posting_number: "49917343-0273-1" },
      services: [
        { name: "MarketplaceServiceItemDirectFlowLogistic", price: -77 },
        { name: "MarketplaceServiceItemRedistributionLastMileCourier", price: -5.13 }
      ],
      items: [{ name: "Фильтр для кофе, многоразовая воронка", sku: 3403055719 }]
    });

    expect(events).toHaveLength(4);
    expect(events[0].eventType).toBe("sale_accrual");
    expect(events[0].externalId).toBe("ozon-finance-50944820885-sale-accrual");
    expect(events[1].externalId).toBe("ozon-finance-50944820885-commission");
    expect(events[2].externalId).toBe("ozon-finance-50944820885-service-marketplaceserviceitemdirectflowlogistic-1");
    expect(events[3].externalId).toContain("ozon-finance-50944820885-service-marketplaceserviceitemredistributionlastmilecour");
    expect(events.map((event) => event.payload.amountRub)).toEqual([725, 319, 77, 5.13]);
    expect(events[0].payload.componentTreatment).toBe("sale_variable");
    expect(events[1].payload.componentCategory).toBe("commission");
    expect(events[1].payload.componentTreatment).toBe("sale_variable");
  });

  it("routes positive acquiring operation to fee instead of payout", () => {
    const events = expandOzonFinanceEvents({
      operation_id: 50502872424,
      operation_type: "MarketplaceRedistributionOfAcquiringOperation",
      operation_type_name: "Оплата эквайринга",
      operation_date: "2026-05-03 00:00:00",
      amount: 4.78,
      posting: { posting_number: "47687952-0073-1" },
      services: [{ name: "MarketplaceRedistributionOfAcquiringOperation", price: 4.78 }],
      items: [{ name: "Фильтр для кофе, многоразовая воронка", sku: 3403055719 }]
    });

    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("fee");
    expect(events[0].payload.operationType).toBe("MarketplaceRedistributionOfAcquiringOperation");
  });

  it("no longer routes payout-like finance operations into payout sync events", () => {
    const events = expandOzonFinanceEvents({
      operation_id: 60000000001,
      operation_type: "SellerPayoutSettlement",
      operation_type_name: "Перечисление продавцу",
      operation_date: "2026-05-10 00:00:00",
      amount: 15234.55
    });

    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("fee");
  });

  it("validates credentials and legacy sync still loads raw channel facts", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/dev/demo");
    const state = await get<any>(api, "/api/state");
    const channel = state.salesChannels.find((candidate: any) => candidate.name.includes("Ozon"));

    const result = await post<any>(api, `/api/channels/${channel.id}/sync`, {
      credentials: { clientId: "demo-client", apiKey: "demo-key" },
      streams: ["products", "stocks", "sales", "finance_events"]
    });
    const after = await get<any>(api, "/api/state");

    expect(result.stats.events).toBe(2);
    expect(after.externalEvents.some((event: any) => event.externalId === "ozon-sale-demo-1")).toBe(true);
    expect(after.observedStocks.length).toBeGreaterThan(0);
    expect(after.externalEvents.find((event: any) => event.externalId === "ozon-sale-demo-1").status).toBe("ready_for_processing");
  });
});
