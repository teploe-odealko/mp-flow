import type { ID, RecalculationJob } from "../../core/models";
import { DomainError, id, nowIso } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";
import { currentOrganizationId } from "./runtime-audit-service";

export async function createRecalculationJob(writeContext: RuntimeWriteContext, input: {
  jobType: RecalculationJob["jobType"];
  scope?: Record<string, unknown>;
}): Promise<RecalculationJob> {
  const finishedAt = nowIso();
  const job: RecalculationJob = {
    id: id("recalc"),
    organizationId: currentOrganizationId(writeContext),
    jobType: input.jobType,
    scope: input.scope ?? {},
    status: "completed",
    progress: 100,
    createdAt: finishedAt,
    finishedAt
  };
  await writeContext.repos.recalculationJobs.add(job);
  return job;
}

export async function retryRecalculationJob(writeContext: RuntimeWriteContext, jobId: ID): Promise<RecalculationJob> {
  const job = await writeContext.repos.recalculationJobs.getById(jobId);
  if (!job) throw new DomainError("recalculation_job_not_found", "Задание пересчёта не найдено");
  job.status = "completed";
  job.progress = 100;
  job.finishedAt = nowIso();
  await writeContext.repos.recalculationJobs.upsert(job);
  return job;
}
