import type { ID, SalesChannel } from "../../core/models";
import { DomainError, id } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";
import { currentOrganizationId, writeAudit } from "./runtime-audit-service";
import { createWarehouse } from "./reference-data-service";

interface ChannelInput {
  name: string;
  channelType: SalesChannel["channelType"];
  pluginCode?: string;
  salesPointWarehouseId?: ID;
  enabledStreams?: SalesChannel["enabledStreams"];
}

type ChannelPatch = Partial<Pick<SalesChannel, "name" | "channelType" | "salesPointWarehouseId" | "enabledStreams" | "status">> & {
  pluginCode?: string;
};

export async function createSalesChannel(writeContext: RuntimeWriteContext, input: ChannelInput): Promise<SalesChannel> {
  const organizationId = currentOrganizationId(writeContext);
  let warehouseId = input.salesPointWarehouseId;
  if (warehouseId) {
    const found = (await writeContext.repos.warehouses.all()).find((warehouse) =>
      warehouse.id === warehouseId && warehouse.warehouseType === "sales_point"
    );
    if (!found) throw new DomainError("warehouse_not_found", "Точка продаж не найдена или не является точкой продаж");
  } else {
    const warehouse = await createWarehouse(writeContext, { name: `${input.name} - точка продаж`, warehouseType: "sales_point" });
    warehouseId = warehouse.id;
  }

  const plugin = input.pluginCode
    ? (await writeContext.repos.integrationPlugins.all()).find((candidate) => candidate.code === input.pluginCode)
    : undefined;
  const channel: SalesChannel = {
    id: id("channel"),
    organizationId,
    name: input.name,
    channelType: input.channelType,
    pluginId: plugin?.id,
    salesPointWarehouseId: warehouseId,
    clearingAccountCode: "76.ТП",
    status: input.pluginCode ? "needs_setup" : "active",
    enabledStreams: input.enabledStreams
  };

  const linkedWarehouse = (await writeContext.repos.warehouses.all()).find((warehouse) => warehouse.id === warehouseId);
  if (linkedWarehouse && !linkedWarehouse.channelId) {
    linkedWarehouse.channelId = channel.id;
    await writeContext.repos.warehouses.upsert(linkedWarehouse);
  }

  await writeContext.repos.salesChannels.add(channel);
  await writeAudit(writeContext, "sales_channel", channel.id, "create", undefined, channel);
  return channel;
}

export async function updateSalesChannel(writeContext: RuntimeWriteContext, channelId: ID, patch: ChannelPatch): Promise<SalesChannel> {
  const channel = await writeContext.repos.salesChannels.getById(channelId);
  if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
  const before = { ...channel };

  if (patch.name !== undefined) channel.name = patch.name;
  if (patch.channelType !== undefined) channel.channelType = patch.channelType;
  if (patch.enabledStreams !== undefined) channel.enabledStreams = patch.enabledStreams;
  if (patch.status !== undefined) channel.status = patch.status;
  if (patch.salesPointWarehouseId !== undefined) {
    const warehouse = (await writeContext.repos.warehouses.all()).find((candidate) =>
      candidate.id === patch.salesPointWarehouseId && candidate.warehouseType === "sales_point"
    );
    if (!warehouse) throw new DomainError("warehouse_not_found", "Точка продаж не найдена");
    channel.salesPointWarehouseId = patch.salesPointWarehouseId;
    if (!warehouse.channelId) {
      warehouse.channelId = channel.id;
      await writeContext.repos.warehouses.upsert(warehouse);
    }
    for (const observed of await writeContext.observedStocks.list({ channelId: channel.id })) {
      observed.warehouseId = patch.salesPointWarehouseId;
      observed.locationStatus = "mapped";
      await writeContext.observedStocks.upsert(observed);
    }
  }
  if (patch.pluginCode !== undefined) {
    const plugin = (await writeContext.repos.integrationPlugins.all()).find((candidate) => candidate.code === patch.pluginCode);
    channel.pluginId = plugin?.id;
  }

  await writeContext.repos.salesChannels.upsert(channel);
  await writeAudit(writeContext, "sales_channel", channel.id, "update", before, channel);
  return channel;
}
