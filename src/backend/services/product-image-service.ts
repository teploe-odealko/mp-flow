import type { AuditEvent, ID } from "../../core/models";
import { DomainError, id, nowIso } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";

export async function setProductImage(writeContext: RuntimeWriteContext, productId: ID, imageUrl: string) {
  const product = await writeContext.repos.products.getById(productId);
  if (!product) throw new DomainError("product_not_found", "Товар не найден");
  const before = { ...product };
  product.imageUrl = imageUrl;
  await writeContext.repos.products.upsert(product);
  await writeAudit(writeContext, "product", product.id, "image_update", before, product);
  return { id: `${product.id}:main`, productId: product.id, url: imageUrl, sortOrder: 0 };
}

export async function deleteProductImage(writeContext: RuntimeWriteContext, productId: ID) {
  const product = await writeContext.repos.products.getById(productId);
  if (!product) throw new DomainError("product_not_found", "Товар не найден");
  const before = { ...product };
  product.imageUrl = undefined;
  await writeContext.repos.products.upsert(product);
  await writeAudit(writeContext, "product", product.id, "image_delete", before, product);
  return product;
}

async function writeAudit(
  writeContext: RuntimeWriteContext,
  entityType: string,
  entityId: ID,
  eventType: string,
  before?: unknown,
  after?: unknown,
  reason?: string
): Promise<AuditEvent> {
  const event: AuditEvent = {
    id: id("audit"),
    organizationId: writeContext.setupMetadata().organization?.id ?? "unconfigured",
    actorLabel: "system",
    entityType,
    entityId,
    eventType,
    before,
    after,
    reason,
    createdAt: nowIso()
  };
  await writeContext.repos.auditEvents.add(event);
  return event;
}
