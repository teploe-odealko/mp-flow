import type { ID, ObservedStock } from "../../core/models";
import { DomainError, id } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";

interface RecordObservedStockInput {
  channelId: ID;
  externalProductId: ID;
  observedAt: string;
  qtyObserved: number;
}

export async function recordObservedStock(writeContext: RuntimeWriteContext, input: RecordObservedStockInput): Promise<ObservedStock> {
  const organization = writeContext.setupMetadata().organization;
  if (!organization) throw new DomainError("not_configured", "Сначала настройте организацию");

  const link = (await writeContext.repos.productExternalLinks.all()).find((candidate) =>
    candidate.externalProductId === input.externalProductId && candidate.status === "active"
  );
  const channel = await writeContext.repos.salesChannels.getById(input.channelId);
  if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");

  const warehouseId = channel.salesPointWarehouseId;
  const existing = await writeContext.observedStocks.findByKey(input.channelId, input.externalProductId, warehouseId, input.observedAt);
  if (existing) {
    existing.productId = link?.productId;
    existing.qtyObserved = input.qtyObserved;
    existing.locationStatus = warehouseId ? "mapped" : "needs_location";
    await writeContext.observedStocks.upsert(existing);
    return existing;
  }

  const observed: ObservedStock = {
    id: id("observed_stock"),
    organizationId: organization.id,
    channelId: input.channelId,
    externalProductId: input.externalProductId,
    productId: link?.productId,
    warehouseId,
    observedAt: input.observedAt,
    qtyObserved: input.qtyObserved,
    locationStatus: warehouseId ? "mapped" : "needs_location"
  };
  await writeContext.observedStocks.upsert(observed);
  return observed;
}

export async function ignoreObservedStock(writeContext: RuntimeWriteContext, observedStockId: ID): Promise<ObservedStock | { id: ID; status: "ignored" }> {
  const observed = await writeContext.observedStocks.getById(observedStockId);
  if (!observed) return { id: observedStockId, status: "ignored" };

  observed.locationStatus = "needs_location";
  await writeContext.observedStocks.upsert(observed);
  return observed;
}
