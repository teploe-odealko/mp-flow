import type { ExternalEvent, ID } from "../../core/models";
import { DomainError, id, nowIso } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";

interface IngestExternalEventInput {
  channelId: ID;
  eventType: ExternalEvent["eventType"];
  externalId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  syncRunId?: ID;
  idempotencyKey?: string;
}

export async function ingestExternalEvent(writeContext: RuntimeWriteContext, input: IngestExternalEventInput): Promise<ExternalEvent> {
  const organization = writeContext.setupMetadata().organization;
  if (!organization) throw new DomainError("not_configured", "Сначала настройте организацию");

  const idempotencyKey = input.idempotencyKey ?? input.externalId;
  const existing = await writeContext.externalEvents.findByIdentity(input.channelId, input.externalId, idempotencyKey);
  if (existing) {
    existing.syncRunId = input.syncRunId ?? existing.syncRunId;
    existing.occurredAt = input.occurredAt;
    existing.rawPayload = input.payload;
    existing.normalizedPayload = input.payload;
    if (!existing.materializedDocumentId && existing.status !== "processed" && existing.status !== "ignored") {
      existing.eventType = input.eventType;
      existing.status = "new";
      await applyExternalEventState(writeContext, existing);
    }
    existing.updatedAt = nowIso();
    await writeContext.externalEvents.upsert(existing);
    return existing;
  }

  const createdAt = nowIso();
  const event: ExternalEvent = {
    id: id("external_event"),
    organizationId: organization.id,
    channelId: input.channelId,
    syncRunId: input.syncRunId,
    eventType: input.eventType,
    externalId: input.externalId,
    idempotencyKey,
    occurredAt: input.occurredAt,
    rawPayload: input.payload,
    normalizedPayload: input.payload,
    status: "new",
    createdAt,
    updatedAt: createdAt
  };
  await applyExternalEventState(writeContext, event);
  await writeContext.externalEvents.upsert(event);
  return event;
}

export async function reprocessExternalEvent(writeContext: RuntimeWriteContext, eventId: ID): Promise<ExternalEvent> {
  const event = await writeContext.externalEvents.getById(eventId);
  if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");

  event.materializedDocumentId = undefined;
  event.lastError = undefined;
  event.reason = undefined;
  event.status = "new";
  await applyExternalEventState(writeContext, event);
  event.updatedAt = nowIso();
  await writeContext.externalEvents.upsert(event);
  return event;
}

export async function ignoreExternalEvent(writeContext: RuntimeWriteContext, eventId: ID, reason: string): Promise<ExternalEvent> {
  const event = await writeContext.externalEvents.getById(eventId);
  if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");

  event.status = "ignored";
  event.reason = reason;
  event.updatedAt = nowIso();
  await writeContext.externalEvents.upsert(event);
  return event;
}

async function applyExternalEventState(writeContext: RuntimeWriteContext, event: ExternalEvent) {
  const payload = event.normalizedPayload as Record<string, unknown>;
  event.updatedAt = nowIso();
  if (event.status === "processed" || event.status === "ignored") return event;

  event.lastError = undefined;
  event.reason = undefined;
  event.externalProductId = undefined;
  event.productId = undefined;

  if (event.eventType === "fee" || event.eventType === "sale_accrual" || event.eventType === "payout") {
    event.status = "ready_for_processing";
    return event;
  }

  const skuList = Array.isArray(payload.lines)
    ? payload.lines
        .map((line) => String((line as Record<string, unknown>).sku ?? "").trim())
        .filter(Boolean)
    : [String(payload.sku ?? "").trim()].filter(Boolean);

  if (skuList.length === 0) {
    event.status = "needs_attention";
    event.reason = "Во внешнем событии нет SKU для сопоставления";
    return event;
  }

  const missing: string[] = [];
  const linkedProductIds = new Set<ID>();
  const externalProducts = await writeContext.repos.externalProducts.all();
  const activeLinks = await writeContext.repos.productExternalLinks.all();

  for (const sku of skuList) {
    const externalProduct = externalProducts.find((product) =>
      externalProductKey(product.channelId, product.externalSku) === externalProductKey(event.channelId, sku)
    );
    if (!externalProduct) {
      missing.push(sku);
      continue;
    }
    if (!event.externalProductId) event.externalProductId = externalProduct.id;
    const link = activeLinks.find((candidate) => candidate.externalProductId === externalProduct.id && candidate.status === "active");
    if (!link) {
      missing.push(sku);
      continue;
    }
    linkedProductIds.add(link.productId);
    if (!event.productId) event.productId = link.productId;
  }

  if (missing.length > 0) {
    event.status = "needs_mapping";
    event.reason = `Нет сопоставления товара для SKU: ${missing.join(", ")}`;
    return event;
  }

  if (event.eventType === "stock" || event.eventType === "product") {
    event.status = "processed";
    return event;
  }

  event.status = "ready_for_processing";
  if (linkedProductIds.size > 1) {
    event.reason = "Событие содержит несколько товаров и готово к пакетной обработке";
  }
  return event;
}

function externalProductKey(channelId: ID, sku: string) {
  return `${channelId}::${sku.trim().toLowerCase()}`;
}
