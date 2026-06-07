import type { Organization } from "../../core/models";
import { DomainError, nowIso } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";
import { writeAudit } from "./runtime-audit-service";

export async function updateOrganization(writeContext: RuntimeWriteContext, input: Partial<Pick<Organization, "displayName" | "legalForm" | "taxMode" | "timezone" | "inn">>): Promise<Organization> {
  const organization = writeContext.setupMetadata().organization;
  const accountingPolicy = writeContext.setupMetadata().accountingPolicy;
  if (!organization || !accountingPolicy) throw new DomainError("not_configured", "Сначала настройте организацию");

  const before = { ...organization };
  if (input.displayName !== undefined) organization.displayName = input.displayName;
  if (input.legalForm !== undefined) organization.legalForm = input.legalForm;
  if (input.inn !== undefined) organization.inn = input.inn || undefined;
  if (input.taxMode !== undefined) organization.taxMode = input.taxMode;
  if (input.timezone !== undefined) organization.timezone = input.timezone;
  organization.updatedAt = nowIso();

  await writeContext.repos.saveSingletons?.({ organization, accountingPolicy });
  await writeAudit(writeContext, "organization", organization.id, "update", before, organization);
  return organization;
}
