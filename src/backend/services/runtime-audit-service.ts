import type { AuditEvent, ID } from "../../core/models";
import { DomainError, id, nowIso } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";

export function currentOrganizationId(writeContext: RuntimeWriteContext): ID {
  const organization = writeContext.setupMetadata().organization;
  if (!organization) throw new DomainError("not_configured", "Сначала настройте организацию");
  return organization.id;
}

export async function writeAudit(
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
