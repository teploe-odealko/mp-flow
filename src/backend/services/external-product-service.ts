import type { ExternalEvent, ExternalProduct, ID, ProductExternalLink } from "../../core/models";
import { DomainError, id } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";
import { createProduct } from "./product-service";
import { currentOrganizationId } from "./runtime-audit-service";
import { applyExternalEventState, reprocessExternalEvent } from "./external-event-service";

interface ExternalProductInput {
  channelId: ID;
  externalSku: string;
  externalName: string;
  imageUrl?: string;
}

export async function createExternalProduct(writeContext: RuntimeWriteContext, input: ExternalProductInput): Promise<ExternalProduct> {
  const organizationId = currentOrganizationId(writeContext);
  const existing = (await writeContext.repos.externalProducts.all()).find((product) =>
    externalProductKey(product.channelId, product.externalSku) === externalProductKey(input.channelId, input.externalSku)
  );
  if (existing) {
    existing.externalName = input.externalName;
    if (input.imageUrl) existing.imageUrl = input.imageUrl;
    await writeContext.repos.externalProducts.upsert(existing);
    return existing;
  }

  const externalProduct: ExternalProduct = {
    id: id("external_product"),
    organizationId,
    channelId: input.channelId,
    externalSku: input.externalSku,
    externalName: input.externalName,
    imageUrl: input.imageUrl,
    status: "active"
  };
  await writeContext.repos.externalProducts.add(externalProduct);
  return externalProduct;
}

export async function linkExternalProduct(writeContext: RuntimeWriteContext, input: { productId: ID; externalProductId: ID }): Promise<ProductExternalLink> {
  const externalProduct = await writeContext.repos.externalProducts.getById(input.externalProductId);
  if (!externalProduct) throw new DomainError("external_product_not_found", "Внешний товар не найден");
  const product = await writeContext.repos.products.getById(input.productId);
  if (!product) throw new DomainError("product_not_found", "Товар не найден");

  const links = await writeContext.repos.productExternalLinks.all();
  const linkedElsewhere = links.find((link) =>
    link.externalProductId === input.externalProductId &&
    link.status === "active" &&
    link.productId !== input.productId
  );
  if (linkedElsewhere) {
    throw new DomainError("external_product_already_linked", "Внешняя карточка уже связана с другим товаром");
  }

  const existing = links.find((link) =>
    link.productId === input.productId &&
    link.externalProductId === input.externalProductId &&
    link.status === "active"
  );
  if (existing) return existing;

  const link: ProductExternalLink = {
    id: id("external_link"),
    organizationId: currentOrganizationId(writeContext),
    productId: input.productId,
    externalProductId: input.externalProductId,
    channelId: externalProduct.channelId,
    status: "active"
  };
  await writeContext.repos.productExternalLinks.add(link);
  if (externalProduct.status === "ignored") {
    externalProduct.status = "active";
    await writeContext.repos.externalProducts.upsert(externalProduct);
  }
  await refreshExternalReferencesForProduct(writeContext, externalProduct.id);
  return link;
}

export async function unlinkExternalProduct(writeContext: RuntimeWriteContext, productId: ID, linkId: ID): Promise<ProductExternalLink> {
  const link = await writeContext.repos.productExternalLinks.getById(linkId);
  if (!link || link.productId !== productId) {
    throw new DomainError("external_link_not_found", "Связь товара не найдена");
  }

  link.status = "unlinked";
  await writeContext.repos.productExternalLinks.upsert(link);
  return link;
}

export async function createInternalProductFromExternal(writeContext: RuntimeWriteContext, externalProductId: ID) {
  const externalProduct = await writeContext.repos.externalProducts.getById(externalProductId);
  if (!externalProduct) throw new DomainError("external_product_not_found", "Внешний товар не найден");

  const product = await createProduct(writeContext, {
    sku: externalProduct.externalSku,
    name: externalProduct.externalName,
    imageUrl: externalProduct.imageUrl,
    unit: "шт"
  });
  const link = await linkExternalProduct(writeContext, { externalProductId: externalProduct.id, productId: product.id });
  return { product, link };
}

export async function ignoreExternalProduct(writeContext: RuntimeWriteContext, externalProductId: ID): Promise<ExternalProduct> {
  const externalProduct = await writeContext.repos.externalProducts.getById(externalProductId);
  if (!externalProduct) throw new DomainError("external_product_not_found", "Внешний товар не найден");

  externalProduct.status = "ignored";
  await writeContext.repos.externalProducts.upsert(externalProduct);
  return externalProduct;
}

export async function reprocessEventsForExternalProduct(writeContext: RuntimeWriteContext, externalProductId: ID): Promise<ExternalEvent[]> {
  const externalProduct = await writeContext.repos.externalProducts.getById(externalProductId);
  if (!externalProduct) throw new DomainError("external_product_not_found", "Внешний товар не найден");

  const events = (await writeContext.externalEvents.list({ channelId: externalProduct.channelId }))
    .filter((event) => JSON.stringify(event.rawPayload).includes(externalProduct.externalSku));
  for (const event of events) await reprocessExternalEvent(writeContext, event.id);
  return events;
}

async function refreshExternalReferencesForProduct(writeContext: RuntimeWriteContext, externalProductId: ID) {
  const link = (await writeContext.repos.productExternalLinks.all()).find((candidate) => candidate.externalProductId === externalProductId && candidate.status === "active");
  const externalProduct = await writeContext.repos.externalProducts.getById(externalProductId);
  if (!externalProduct) return;

  const channel = await writeContext.repos.salesChannels.getById(externalProduct.channelId);
  for (const observed of await writeContext.observedStocks.list({ externalProductId })) {
    observed.productId = link?.productId;
    observed.warehouseId = channel?.salesPointWarehouseId;
    observed.locationStatus = channel?.salesPointWarehouseId ? "mapped" : "needs_location";
    await writeContext.observedStocks.upsert(observed);
  }
  for (const event of await writeContext.externalEvents.list({ channelId: externalProduct.channelId })) {
    await applyExternalEventState(writeContext, event);
    await writeContext.externalEvents.upsert(event);
  }
}

function externalProductKey(channelId: ID, sku: string) {
  return `${channelId}::${sku.trim().toLowerCase()}`;
}
