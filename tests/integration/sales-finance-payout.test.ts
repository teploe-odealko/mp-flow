import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

async function request<T>(api: ReturnType<typeof createApi>, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const response = await api.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" }
  });
  const payload = await response.json() as { ok: boolean; data: T; error?: { code: string; message: string } };
  if (!payload.ok) throw new Error(`${payload.error?.code}: ${payload.error?.message}`);
  return payload.data;
}

const get = <T>(api: ReturnType<typeof createApi>, path: string) => request<T>(api, "GET", path);
const post = <T>(api: ReturnType<typeof createApi>, path: string, body?: unknown) => request<T>(api, "POST", path, body);
const remove = <T>(api: ReturnType<typeof createApi>, path: string) => request<T>(api, "DELETE", path);

describe("sales, returns, finance events and payouts", () => {
  it("keeps manual sale as draft until explicit post and then consumes FIFO cost", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Sales QA", accountingStartDate: "2026-01-01" });

    const product = await post<any>(api, "/api/products", { sku: "SALE-001", name: "Товар для продажи" });
    const channel = await post<any>(api, "/api/integrations/channels", { name: "Manual Marketplace", channelType: "marketplace" });
    const ownWarehouse = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own");
    if (!ownWarehouse) throw new Error("own_warehouse_not_found");

    await post(api, "/api/inventory/opening-balances", {
      date: "2026-01-01",
      warehouseId: ownWarehouse.id,
      lines: [{ productId: product.id, qty: 5, costRub: 1000 }]
    });
    await post(api, "/api/inventory/transfers", {
      transferDate: "2026-01-02",
      fromWarehouseId: ownWarehouse.id,
      toWarehouseId: channel.salesPointWarehouseId,
      lines: [{ productId: product.id, qty: 5 }]
    });

    const sale = await post<any>(api, "/api/sales", {
      channelId: channel.id,
      saleDate: "2026-01-03",
      post: false,
      lines: [{ productId: product.id, qty: 2, priceRub: 900 }]
    });

    expect(sale.status).toBe("draft");
    expect(app.state.saleLines.find((line) => line.saleId === sale.id)?.costRub).toBe(0);
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === channel.salesPointWarehouseId)?.qty).toBe(5);

    const posted = await post<any>(api, `/api/sales/${sale.id}/post`);
    expect(posted.status).toBe("posted");
    expect(app.state.saleLines.find((line) => line.saleId === sale.id)?.costRub).toBeGreaterThan(0);
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === channel.salesPointWarehouseId)?.qty).toBe(3);
  });

  it("posts return into damaged stock state and restores original sale cost", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Return QA", accountingStartDate: "2026-01-01" });

    const product = await post<any>(api, "/api/products", { sku: "RET-001", name: "Товар для возврата" });
    const channel = await post<any>(api, "/api/integrations/channels", { name: "Manual Marketplace", channelType: "marketplace" });
    const ownWarehouse = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own");
    if (!ownWarehouse) throw new Error("own_warehouse_not_found");

    await post(api, "/api/inventory/opening-balances", {
      date: "2026-01-01",
      warehouseId: ownWarehouse.id,
      lines: [{ productId: product.id, qty: 5, costRub: 1500 }]
    });
    await post(api, "/api/inventory/transfers", {
      transferDate: "2026-01-02",
      fromWarehouseId: ownWarehouse.id,
      toWarehouseId: channel.salesPointWarehouseId,
      lines: [{ productId: product.id, qty: 5 }]
    });

    const sale = await post<any>(api, "/api/sales", {
      channelId: channel.id,
      saleDate: "2026-01-03",
      post: true,
      lines: [{ productId: product.id, qty: 2, priceRub: 950 }]
    });
    const saleLine = app.state.saleLines.find((line) => line.saleId === sale.id);
    if (!saleLine) throw new Error("sale_line_not_found");

    const salesReturn = await post<any>(api, `/api/sales/${sale.id}/returns`, {
      returnDate: "2026-01-04",
      stockStateCode: "damaged",
      post: false,
      lines: [{ saleLineId: saleLine.id, qty: 1 }]
    });

    expect(salesReturn.status).toBe("draft");
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === channel.salesPointWarehouseId && stock.stateCode === "damaged")?.qty ?? 0).toBe(0);

    const posted = await post<any>(api, `/api/returns/${salesReturn.id}/post`);
    expect(posted.status).toBe("posted");
    expect(posted.restoredCostRub).toBeGreaterThan(0);
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === channel.salesPointWarehouseId && stock.stateCode === "damaged")?.qty).toBe(1);
  });

  it("deletes sale together with local accrual and linked finance events, then allows rematerialization from channel facts", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Sale delete QA", accountingStartDate: "2026-01-01" });

    const product = await post<any>(api, "/api/products", { sku: "SALE-DEL-001", name: "Товар для пересинка продажи" });
    const channel = await post<any>(api, "/api/integrations/channels", { name: "Ozon QA", channelType: "marketplace" });
    const ownWarehouse = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own");
    if (!ownWarehouse) throw new Error("own_warehouse_not_found");

    await post(api, "/api/inventory/opening-balances", {
      date: "2026-01-01",
      warehouseId: ownWarehouse.id,
      lines: [{ productId: product.id, qty: 5, costRub: 1000 }]
    });
    await post(api, "/api/inventory/transfers", {
      transferDate: "2026-01-02",
      fromWarehouseId: ownWarehouse.id,
      toWarehouseId: channel.salesPointWarehouseId,
      lines: [{ productId: product.id, qty: 5 }]
    });

    const externalProduct = app.createExternalProduct({ channelId: channel.id, externalSku: "EXT-SALE-DEL-1", externalName: "Внешний товар" });
    app.linkExternalProduct({ externalProductId: externalProduct.id, productId: product.id });

    const saleEvent = app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "sale",
      externalId: "sale-del-ext-1",
      occurredAt: "2026-01-03T00:00:00.000Z",
      payload: {
        postingNumber: "POST-SALE-DEL-1",
        lines: [{ sku: "EXT-SALE-DEL-1", qty: 2, amountRub: 900 }]
      }
    });
    const sale = await post<any>(api, `/api/integrations/events/${saleEvent.id}/materialize-sale`);

    const saleAccrualEvent = app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "sale_accrual",
      externalId: "sale-accrual-del-1",
      occurredAt: "2026-01-05T00:00:00.000Z",
      payload: { postingNumber: "POST-SALE-DEL-1", saleAmountRub: 1800 }
    });
    await post<any>(api, `/api/integrations/events/${saleAccrualEvent.id}/materialize-sale-accrual`);

    const feeEvent = app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "fee",
      externalId: "fee-del-ext-1",
      occurredAt: "2026-01-05T00:00:00.000Z",
      payload: {
        postingNumber: "POST-SALE-DEL-1",
        amountRub: 180,
        operationType: "MarketplaceRedistributionOfAcquiringOperation",
        operationTypeName: "Оплата эквайринга"
      }
    });
    const financeEvent = await post<any>(api, `/api/integrations/events/${feeEvent.id}/materialize-fee`);
    await post(api, `/api/integrations/finance-events/${financeEvent.id}/post`);

    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === channel.salesPointWarehouseId)?.qty).toBe(3);

    await remove(api, `/api/sales/${sale.id}`);

    expect(app.state.sales.find((candidate) => candidate.id === sale.id)).toBeUndefined();
    expect(app.state.saleLines.find((candidate) => candidate.saleId === sale.id)).toBeUndefined();
    expect(app.state.channelFinanceEvents.find((candidate) => candidate.id === financeEvent.id)).toBeUndefined();
    expect(app.state.documents.find((candidate) => candidate.id === sale.documentId)).toBeUndefined();
    expect(app.state.documents.find((candidate) => candidate.id === sale.financialDocumentId)).toBeUndefined();
    expect(app.state.documents.find((candidate) => candidate.id === financeEvent.documentId)).toBeUndefined();
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === channel.salesPointWarehouseId)?.qty).toBe(5);
    expect(app.state.externalEvents.find((candidate) => candidate.id === saleEvent.id)?.materializedDocumentId).toBeUndefined();
    expect(app.state.externalEvents.find((candidate) => candidate.id === saleEvent.id)?.status).toBe("ready_for_processing");
    expect(app.state.externalEvents.find((candidate) => candidate.id === saleAccrualEvent.id)?.status).toBe("ready_for_processing");
    expect(app.state.externalEvents.find((candidate) => candidate.id === feeEvent.id)?.status).toBe("ready_for_processing");

    const recreatedSale = await post<any>(api, `/api/integrations/events/${saleEvent.id}/materialize-sale`);
    await post<any>(api, `/api/integrations/events/${saleAccrualEvent.id}/materialize-sale-accrual`);
    const recreatedFinanceEvent = await post<any>(api, `/api/integrations/events/${feeEvent.id}/materialize-fee`);
    await post(api, `/api/integrations/finance-events/${recreatedFinanceEvent.id}/post`);

    expect(recreatedSale.id).not.toBe(sale.id);
    expect(app.state.sales.find((candidate) => candidate.id === recreatedSale.id)?.status).toBe("posted");
    expect(app.state.channelFinanceEvents.find((candidate) => candidate.id === recreatedFinanceEvent.id)?.status).toBe("posted");
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === channel.salesPointWarehouseId)?.qty).toBe(3);
  });

  it("deletes return and allows rematerialization from the original return event", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Return delete QA", accountingStartDate: "2026-01-01" });

    const product = await post<any>(api, "/api/products", { sku: "RET-DEL-001", name: "Товар для пересинка возврата" });
    const channel = await post<any>(api, "/api/integrations/channels", { name: "Ozon QA", channelType: "marketplace" });
    const ownWarehouse = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own");
    if (!ownWarehouse) throw new Error("own_warehouse_not_found");

    await post(api, "/api/inventory/opening-balances", {
      date: "2026-01-01",
      warehouseId: ownWarehouse.id,
      lines: [{ productId: product.id, qty: 5, costRub: 1500 }]
    });
    await post(api, "/api/inventory/transfers", {
      transferDate: "2026-01-02",
      fromWarehouseId: ownWarehouse.id,
      toWarehouseId: channel.salesPointWarehouseId,
      lines: [{ productId: product.id, qty: 5 }]
    });

    const externalProduct = app.createExternalProduct({ channelId: channel.id, externalSku: "EXT-RET-DEL-1", externalName: "Внешний товар" });
    app.linkExternalProduct({ externalProductId: externalProduct.id, productId: product.id });

    const saleEvent = app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "sale",
      externalId: "sale-ret-del-ext-1",
      occurredAt: "2026-01-03T00:00:00.000Z",
      payload: {
        postingNumber: "POST-RET-DEL-1",
        lines: [{ sku: "EXT-RET-DEL-1", qty: 2, amountRub: 900 }]
      }
    });
    const sale = await post<any>(api, `/api/integrations/events/${saleEvent.id}/materialize-sale`);
    const saleAccrualEvent = app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "sale_accrual",
      externalId: "sale-ret-del-accrual-1",
      occurredAt: "2026-01-04T00:00:00.000Z",
      payload: { postingNumber: "POST-RET-DEL-1", saleAmountRub: 1800 }
    });
    await post<any>(api, `/api/integrations/events/${saleAccrualEvent.id}/materialize-sale-accrual`);

    const returnEvent = app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "return",
      externalId: "return-del-ext-1",
      occurredAt: "2026-01-06T00:00:00.000Z",
      payload: {
        postingNumber: "POST-RET-DEL-1",
        lines: [{ sku: "EXT-RET-DEL-1", qty: 1 }]
      }
    });
    const salesReturn = await post<any>(api, `/api/integrations/events/${returnEvent.id}/materialize-return`);

    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === channel.salesPointWarehouseId && stock.stateCode === "sellable")?.qty).toBe(4);

    await remove(api, `/api/returns/${salesReturn.id}`);

    expect(app.state.salesReturns.find((candidate) => candidate.id === salesReturn.id)).toBeUndefined();
    expect(app.state.documents.find((candidate) => candidate.id === salesReturn.documentId)).toBeUndefined();
    expect(app.state.externalEvents.find((candidate) => candidate.id === returnEvent.id)?.materializedDocumentId).toBeUndefined();
    expect(app.state.externalEvents.find((candidate) => candidate.id === returnEvent.id)?.status).toBe("ready_for_processing");
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === channel.salesPointWarehouseId && stock.stateCode === "sellable")?.qty).toBe(3);

    const recreatedReturn = await post<any>(api, `/api/integrations/events/${returnEvent.id}/materialize-return`);
    expect(recreatedReturn.id).not.toBe(salesReturn.id);
    expect(app.state.salesReturns.find((candidate) => candidate.id === recreatedReturn.id)?.status).toBe("posted");
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === channel.salesPointWarehouseId && stock.stateCode === "sellable")?.qty).toBe(4);
    expect(app.state.sales.find((candidate) => candidate.id === sale.id)?.status).toBe("posted");
  });

  it("nets sales returns in P&L and attaches existing return finance events to the return document", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Return accounting QA", accountingStartDate: "2026-01-01" });

    const product = await post<any>(api, "/api/products", { sku: "RET-PNL-001", name: "Товар для P&L возврата" });
    const channel = await post<any>(api, "/api/integrations/channels", { name: "Ozon QA", channelType: "marketplace" });
    const ownWarehouse = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own");
    if (!ownWarehouse) throw new Error("own_warehouse_not_found");

    await post(api, "/api/inventory/opening-balances", {
      date: "2026-01-01",
      warehouseId: ownWarehouse.id,
      lines: [{ productId: product.id, qty: 5, costRub: 1500 }]
    });
    await post(api, "/api/inventory/transfers", {
      transferDate: "2026-01-02",
      fromWarehouseId: ownWarehouse.id,
      toWarehouseId: channel.salesPointWarehouseId,
      lines: [{ productId: product.id, qty: 5 }]
    });

    const externalProduct = app.createExternalProduct({ channelId: channel.id, externalSku: "EXT-RET-PNL-1", externalName: "Внешний товар" });
    app.linkExternalProduct({ externalProductId: externalProduct.id, productId: product.id });

    const saleEvent = app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "sale",
      externalId: "sale-ret-pnl-ext-1",
      occurredAt: "2026-01-03T00:00:00.000Z",
      payload: {
        postingNumber: "POST-RET-PNL-1",
        lines: [{ sku: "EXT-RET-PNL-1", qty: 2, amountRub: 900 }]
      }
    });
    const sale = await post<any>(api, `/api/integrations/events/${saleEvent.id}/materialize-sale`);
    const saleAccrualEvent = app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "sale_accrual",
      externalId: "sale-ret-pnl-accrual-1",
      occurredAt: "2026-01-04T00:00:00.000Z",
      payload: { postingNumber: "POST-RET-PNL-1", saleAmountRub: 1800 }
    });
    await post<any>(api, `/api/integrations/events/${saleAccrualEvent.id}/materialize-sale-accrual`);

    const returnFeeEvent = app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "fee",
      externalId: "return-fee-ret-pnl-1",
      occurredAt: "2026-01-05T00:00:00.000Z",
      payload: {
        postingNumber: "POST-RET-PNL-1",
        amountRub: 50,
        componentEventKind: "logistics",
        componentCategory: "return_logistics",
        componentTreatment: "return_variable",
        operationTypeName: "Логистика возврата"
      }
    });
    const returnFee = await post<any>(api, `/api/integrations/events/${returnFeeEvent.id}/materialize-fee`);
    await post(api, `/api/integrations/finance-events/${returnFee.id}/post`);
    expect(app.state.channelFinanceEvents.find((candidate) => candidate.id === returnFee.id)?.linkedReturnId).toBeUndefined();

    const returnEvent = app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "return",
      externalId: "return-ret-pnl-ext-1",
      occurredAt: "2026-01-06T00:00:00.000Z",
      payload: {
        postingNumber: "POST-RET-PNL-1",
        lines: [{ sku: "EXT-RET-PNL-1", qty: 1 }]
      }
    });
    const salesReturn = await post<any>(api, `/api/integrations/events/${returnEvent.id}/materialize-return`);

    const linkedReturnFee = app.state.channelFinanceEvents.find((candidate) => candidate.id === returnFee.id);
    expect(linkedReturnFee?.linkedSaleId).toBe(sale.id);
    expect(linkedReturnFee?.linkedReturnId).toBe(salesReturn.id);
    expect(linkedReturnFee?.status).toBe("posted");
    expect(app.state.documentLinks.some((link) => link.fromDocumentId === returnFee.documentId && link.toDocumentId === salesReturn.documentId && link.linkType === "channel_fee")).toBe(true);

    const reports = app.reports();
    expect(reports.pnl.revenue).toBe(900);
    expect(reports.pnl.costOfSales).toBe(300);
    expect(reports.pnl.operatingExpenses).toBe(50);
    expect(reports.pnl.netProfit).toBe(550);
  });

  it("classifies finance event and posts payout with accepted difference", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Payout QA", accountingStartDate: "2026-01-01" });

    const product = await post<any>(api, "/api/products", { sku: "PAY-001", name: "Товар для выплаты" });
    const channel = await post<any>(api, "/api/integrations/channels", { name: "Manual Marketplace", channelType: "marketplace" });
    const ownWarehouse = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own");
    if (!ownWarehouse) throw new Error("own_warehouse_not_found");

    await post(api, "/api/inventory/opening-balances", {
      date: "2026-01-01",
      warehouseId: ownWarehouse.id,
      lines: [{ productId: product.id, qty: 5, costRub: 1000 }]
    });
    await post(api, "/api/inventory/transfers", {
      transferDate: "2026-01-02",
      fromWarehouseId: ownWarehouse.id,
      toWarehouseId: channel.salesPointWarehouseId,
      lines: [{ productId: product.id, qty: 5 }]
    });

    const sale = await post<any>(api, "/api/sales", {
      channelId: channel.id,
      saleDate: "2026-01-03",
      post: true,
      lines: [{ productId: product.id, qty: 2, priceRub: 1000 }]
    });
    const financeEvent = await post<any>(api, "/api/channel-fees", {
      channelId: channel.id,
      eventKind: "commission",
      occurredAt: "2026-01-04",
      amountRub: 200,
      linkedSaleId: sale.id,
      post: false
    });

    expect(financeEvent.status).toBe("classified");
    await post(api, `/api/integrations/finance-events/${financeEvent.id}/post`);
    expect(app.state.channelFinanceEvents.find((event) => event.id === financeEvent.id)?.status).toBe("posted");

    const payout = await post<any>(api, "/api/finance/payouts", {
      channelId: channel.id,
      payoutDate: "2026-01-05",
      bankReceiptRub: 1700
    });

    expect(payout.status).toBe("needs_reconciliation");
    expect(payout.expectedAmountRub).toBe(1800);

    await post(api, `/api/finance/payouts/${payout.id}/leave-difference`, { reason: "Маркетплейс удержал округление" });
    const posted = await post<any>(api, `/api/finance/payouts/${payout.id}/post`);

    expect(posted.status).toBe("needs_reconciliation");
    expect(app.state.channelFinanceEvents.find((event) => event.id === financeEvent.id)?.payoutId).toBe(payout.id);
    expect(app.state.payments.find((payment) => payment.id === posted.paymentId)?.paymentType).toBe("channel_payout");
  });

  it("creates manual payout from Ozon invoice data without auto-composing sales and fees", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Manual payout QA", accountingStartDate: "2026-01-01" });

    const channel = await post<any>(api, "/api/integrations/channels", { name: "Ozon FBO", channelType: "marketplace" });
    await post(api, "/api/channel-fees", {
      channelId: channel.id,
      eventKind: "commission",
      occurredAt: "2026-04-05",
      amountRub: 999,
      post: true
    });

    const payout = await post<any>(api, "/api/finance/payouts", {
      channelId: channel.id,
      payoutDate: "2026-04-07",
      periodFrom: "2026-03-30",
      periodTo: "2026-03-31",
      expectedAmountRub: 2506,
      bankReceiptRub: 2506,
      externalPayoutId: "№444330 от 07.04.2026",
      compositionMode: "manual"
    });

    expect(payout.compositionMode).toBe("manual");
    expect(payout.status).toBe("ready");
    expect(payout.expectedAmountRub).toBe(2506);
    expect(payout.differenceRub).toBe(0);

    const lines = app.state.payoutLines.filter((line) => line.payoutId === payout.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.sourceType).toBe("manual_adjustment");
    expect(lines[0]?.amountRub).toBe(2506);

    const posted = await post<any>(api, `/api/finance/payouts/${payout.id}/post`);
    expect(posted.status).toBe("posted");
  });

  it("deletes draft payout together with draft bank receipt and clears external event link", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Payout delete QA", accountingStartDate: "2026-01-01" });

    const channel = await post<any>(api, "/api/integrations/channels", { name: "Ozon FBO", channelType: "marketplace" });
    const externalEvent = app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "payout",
      externalId: "ozon-payout-delete-1",
      occurredAt: "2026-04-07T00:00:00.000Z",
      payload: { type: "manual_test" }
    });

    const payout = await post<any>(api, "/api/finance/payouts", {
      channelId: channel.id,
      payoutDate: "2026-04-07",
      periodFrom: "2026-03-30",
      periodTo: "2026-03-31",
      expectedAmountRub: 2506,
      bankReceiptRub: 2506,
      externalPayoutId: "№444330 от 07.04.2026",
      externalEventId: externalEvent.id,
      compositionMode: "manual"
    });
    expect(app.state.payouts).toHaveLength(1);
    expect(app.state.payments).toHaveLength(1);
    expect(app.state.externalEvents.find((event) => event.id === externalEvent.id)?.materializedDocumentId).toBe(payout.documentId);

    await remove(api, `/api/finance/payouts/${payout.id}`);

    expect(app.state.payouts).toHaveLength(0);
    expect(app.state.payoutLines).toHaveLength(0);
    expect(app.state.payments).toHaveLength(0);
    expect(app.state.documents.find((document) => document.id === payout.documentId)).toBeUndefined();
    expect(app.state.externalEvents.find((event) => event.id === externalEvent.id)?.materializedDocumentId).toBeUndefined();
    expect(app.state.externalEvents.find((event) => event.id === externalEvent.id)?.status).toBe("ignored");

    const created: any[] = [];
    for (let index = 0; index < 5; index += 1) {
      created.push(await post<any>(api, "/api/finance/payouts", {
        channelId: channel.id,
        payoutDate: `2026-04-${String(10 + index).padStart(2, "0")}`,
        periodFrom: "2026-04-01",
        periodTo: "2026-04-02",
        expectedAmountRub: 1000 + index,
        bankReceiptRub: 1000 + index,
        externalPayoutId: `№50000${index} от 0${index + 1}.04.2026`,
        compositionMode: "manual"
      }));
    }
    const fourthPaymentDocumentId = app.state.payouts.find((candidate) => candidate.id === created[3].id)?.paymentId
      ? app.state.payments.find((payment) => payment.id === app.state.payouts.find((candidate) => candidate.id === created[3].id)?.paymentId)?.documentId
      : undefined;
    const fifthPaymentDocumentNumber = app.state.documents.find((document) => document.id === (app.state.payouts.find((candidate) => candidate.id === created[4].id)?.paymentId
      ? app.state.payments.find((payment) => payment.id === app.state.payouts.find((candidate) => candidate.id === created[4].id)?.paymentId)?.documentId
      : undefined))?.number;
    await remove(api, `/api/finance/payouts/${created[3].id}`);

    const replacement = await post<any>(api, "/api/finance/payouts", {
      channelId: channel.id,
      payoutDate: "2026-04-20",
      periodFrom: "2026-04-03",
      periodTo: "2026-04-04",
      expectedAmountRub: 2000,
      bankReceiptRub: 2000,
      externalPayoutId: "№600000 от 20.04.2026",
      compositionMode: "manual"
    });
    const replacementPaymentDocumentId = app.state.payouts.find((candidate) => candidate.id === replacement.id)?.paymentId
      ? app.state.payments.find((payment) => payment.id === app.state.payouts.find((candidate) => candidate.id === replacement.id)?.paymentId)?.documentId
      : undefined;
    const replacementPaymentDocumentNumber = app.state.documents.find((document) => document.id === replacementPaymentDocumentId)?.number;

    expect(fourthPaymentDocumentId).toBeDefined();
    expect(fifthPaymentDocumentNumber).toBe("ОПЛ-00005");
    expect(replacementPaymentDocumentNumber).toBe("ОПЛ-00006");
  });

  it("deletes finance event and allows rematerialization from the original fee event", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Finance delete QA", accountingStartDate: "2026-01-01" });

    const channel = await post<any>(api, "/api/integrations/channels", { name: "Ozon QA", channelType: "marketplace" });
    const feeEvent = app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "fee",
      externalId: "fee-delete-ext-1",
      occurredAt: "2026-01-04T00:00:00.000Z",
      payload: {
        amountRub: 90,
        operationType: "OperationMarketplaceItemTemporaryStorageRedistribution",
        operationTypeName: "Хранение товара"
      }
    });

    const financeEvent = await post<any>(api, `/api/integrations/events/${feeEvent.id}/materialize-fee`);
    await post(api, `/api/integrations/finance-events/${financeEvent.id}/post`);

    await remove(api, `/api/integrations/finance-events/${financeEvent.id}`);

    expect(app.state.channelFinanceEvents.find((candidate) => candidate.id === financeEvent.id)).toBeUndefined();
    expect(app.state.documents.find((candidate) => candidate.id === financeEvent.documentId)).toBeUndefined();
    expect(app.state.externalEvents.find((candidate) => candidate.id === feeEvent.id)?.materializedDocumentId).toBeUndefined();
    expect(app.state.externalEvents.find((candidate) => candidate.id === feeEvent.id)?.status).toBe("ready_for_processing");

    const recreatedEvent = await post<any>(api, `/api/integrations/events/${feeEvent.id}/materialize-fee`);
    await post(api, `/api/integrations/finance-events/${recreatedEvent.id}/post`);

    expect(recreatedEvent.id).not.toBe(financeEvent.id);
    expect(app.state.channelFinanceEvents.find((candidate) => candidate.id === recreatedEvent.id)?.status).toBe("posted");
  });
});
