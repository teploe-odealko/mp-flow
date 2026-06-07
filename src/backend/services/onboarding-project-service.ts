import type { BackfillItem, BackfillProject, ExternalEvent, ID } from "../../core/models";
import { DomainError, round2, round4 } from "../../core/utils";
import type { RuntimeReadContext } from "../../infra/db/runtime-store";

export async function onboardingProjectDetailsFor(readContext: RuntimeReadContext, projectId: ID) {
  const project = await readContext.repos.backfillProjects.getById(projectId);
  if (!project) throw new DomainError("backfill_project_not_found", "Проект импорта не найден");
  const projectedProject = cloneProject(project);
  const sourceItems = (await readContext.repos.backfillItems.all()).filter((item) => item.backfillProjectId === project.id);
  const items = await Promise.all(sourceItems.map((item) => evaluateBackfillItem(readContext, projectedProject, cloneItem(item))));
  const summary = buildBackfillSummary(projectedProject, items);
  projectedProject.payload = { ...(projectedProject.payload ?? {}), summary };
  if (projectedProject.status !== "applied" && projectedProject.status !== "completed") {
    projectedProject.status = summary.totalItems === 0 || summary.unmatched > 0 || summary.missingCost > 0 ? "needs_review" : "ready";
  }
  return { project: projectedProject, items, summary };
}

async function evaluateBackfillItem(readContext: RuntimeReadContext, project: BackfillProject, item: BackfillItem): Promise<BackfillItem> {
  const payload = { ...(item.payload ?? {}) } as Record<string, unknown>;
  const externalProductId = typeof payload.externalProductId === "string" ? payload.externalProductId : undefined;
  const externalProduct = externalProductId ? await readContext.repos.externalProducts.getById(externalProductId) : undefined;
  const linkedProductId = externalProductId
    ? (await readContext.repos.productExternalLinks.all()).find((link) => link.externalProductId === externalProductId)?.productId
    : undefined;
  const sku = String(payload.externalSku ?? payload.sku ?? externalProduct?.externalSku ?? "");
  const inferredProductId = typeof payload.productId === "string" && payload.productId
    ? String(payload.productId)
    : linkedProductId;
  if (inferredProductId) payload.productId = inferredProductId;
  payload.externalSku = sku || externalProduct?.externalSku || "";
  payload.externalName = String(payload.externalName ?? externalProduct?.externalName ?? payload.name ?? "");
  const channel = typeof payload.salesChannelId === "string" ? await readContext.repos.salesChannels.getById(payload.salesChannelId) : undefined;
  payload.channelName = String(payload.channelName ?? channel?.name ?? "");
  payload.warehouseId = String(payload.warehouseId ?? await preferredWarehouseId(readContext, typeof payload.salesChannelId === "string" ? payload.salesChannelId : undefined));
  const openingQty = await applyHistoricalBackfillProjection(readContext, project, payload);
  const requiresOpeningBalanceCost = !isDocumentedFlowBackfillProject(project);
  if (requiresOpeningBalanceCost) {
    const inferredUnitCost = Number(payload.unitCostRub ?? await averageUnitCost(readContext, String(payload.productId ?? "")) ?? 0);
    if (inferredUnitCost > 0) payload.unitCostRub = round2(inferredUnitCost);
    payload.totalCostRub = round2(Number(payload.unitCostRub ?? 0) * openingQty);
  } else {
    payload.totalCostRub = 0;
  }

  if (item.status === "applied") {
    item.payload = payload;
    return item;
  }
  if (!payload.productId) {
    item.status = "needs_mapping";
  } else if (requiresOpeningBalanceCost && !(Number(payload.unitCostRub ?? 0) > 0)) {
    item.status = "needs_cost";
  } else {
    item.status = "ready";
  }
  item.payload = payload;
  return item;
}

function buildBackfillSummary(project: BackfillProject | undefined, items: BackfillItem[]) {
  const requiresOpeningBalanceCost = !isDocumentedFlowBackfillProject(project);
  const totalItems = items.length;
  const mapped = items.filter((item) => item.status === "ready" || item.status === "applied").length;
  const unmatched = items.filter((item) => item.status === "needs_mapping").length;
  const missingCost = requiresOpeningBalanceCost ? items.filter((item) => item.status === "needs_cost").length : 0;
  const totalQty = round4(items.reduce((sum, item) => sum + backfillOpeningQty(project, (item.payload ?? {}) as Record<string, unknown>), 0));
  const totalCurrentQty = round4(items.reduce((sum, item) => sum + Number(item.payload?.observedQty ?? 0), 0));
  const totalHistoricalSalesQty = round4(items.reduce((sum, item) => sum + Number(item.payload?.historicalSalesQty ?? 0), 0));
  const totalHistoricalReturnsQty = round4(items.reduce((sum, item) => sum + Number(item.payload?.historicalReturnsQty ?? 0), 0));
  const totalCost = round2(items.reduce((sum, item) => sum + Number(item.payload?.totalCostRub ?? 0), 0));
  const warnings: string[] = [];
  if (totalItems === 0) warnings.push("Карточки и остатки не загружены");
  if (unmatched > 0) warnings.push(`Нужно сопоставить товаров: ${unmatched}`);
  if (missingCost > 0) warnings.push(`Нужно заполнить себестоимость строк: ${missingCost}`);
  return { totalItems, mapped, unmatched, missingCost, totalQty, totalCurrentQty, totalHistoricalSalesQty, totalHistoricalReturnsQty, totalCost, warnings };
}

async function applyHistoricalBackfillProjection(readContext: RuntimeReadContext, project: BackfillProject | undefined, payload: Record<string, unknown>) {
  const observedQty = round4(Number(payload.observedQty ?? payload.qty ?? 0));
  payload.observedQty = observedQty;
  if (!isHistoricalBackfillProject(project)) return observedQty;
  const salesQty = await historicalEventQty(readContext, project, payload, "sale");
  const returnsQty = await historicalEventQty(readContext, project, payload, "return");
  const openingQty = round4(Math.max(0, observedQty + salesQty - returnsQty));
  payload.currentStockQty = observedQty;
  payload.historicalSalesQty = salesQty;
  payload.historicalReturnsQty = returnsQty;
  payload.openingQty = openingQty;
  return openingQty;
}

async function historicalEventQty(
  readContext: RuntimeReadContext,
  project: BackfillProject | undefined,
  payload: Record<string, unknown>,
  eventType: "sale" | "return"
) {
  const salesChannelId = typeof project?.payload?.salesChannelId === "string" ? String(project.payload.salesChannelId) : undefined;
  if (!salesChannelId) return 0;
  const accountingStartDate = typeof project?.payload?.accountingStartDate === "string" ? String(project.payload.accountingStartDate) : undefined;
  const importSyncRunId = typeof project?.payload?.importSyncRunId === "string" ? String(project.payload.importSyncRunId) : undefined;
  let total = 0;
  for (const event of await readContext.externalEvents.list({ channelId: salesChannelId })) {
    if (event.channelId !== salesChannelId) continue;
    if (event.eventType !== eventType) continue;
    if (importSyncRunId && event.syncRunId !== importSyncRunId) continue;
    if (accountingStartDate && event.occurredAt.slice(0, 10) < accountingStartDate) continue;
    if (event.status === "failed") continue;
    if (event.status === "ignored" && !isBeforeStartIgnoredEvent(event)) continue;
    total = round4(total + await eventQtyForBackfillItem(readContext, event, payload));
  }
  return round4(total);
}

async function eventQtyForBackfillItem(readContext: RuntimeReadContext, event: ExternalEvent, payload: Record<string, unknown>) {
  const normalized = event.normalizedPayload as Record<string, unknown>;
  const rawLines = Array.isArray(normalized.lines)
    ? normalized.lines as Array<Record<string, unknown>>
    : [{ sku: normalized.sku, qty: normalized.qty }];
  let total = 0;
  for (const line of rawLines) {
    if (!await lineMatchesBackfillItem(readContext, event.channelId, line, payload)) continue;
    const qty = Number(line.qty ?? 1);
    total = round4(total + (Number.isFinite(qty) && qty > 0 ? qty : 0));
  }
  return total;
}

async function lineMatchesBackfillItem(
  readContext: RuntimeReadContext,
  channelId: string,
  line: Record<string, unknown>,
  payload: Record<string, unknown>
) {
  const targetExternalProductId = typeof payload.externalProductId === "string" ? payload.externalProductId : undefined;
  const targetProductId = typeof payload.productId === "string" ? payload.productId : undefined;
  const lineExternalProductId = typeof line.externalProductId === "string" ? line.externalProductId : undefined;
  if (targetExternalProductId && lineExternalProductId) return targetExternalProductId === lineExternalProductId;

  const externalSku = String(line.sku ?? "").trim();
  const externalProduct = externalSku
    ? (await readContext.repos.externalProducts.all()).find((product) => product.channelId === channelId && product.externalSku === externalSku)
    : undefined;
  if (targetExternalProductId) return externalProduct?.id === targetExternalProductId;
  if (!targetProductId || !externalProduct) return false;
  return (await readContext.repos.productExternalLinks.all()).some((link) =>
    link.externalProductId === externalProduct.id &&
    link.productId === targetProductId &&
    link.status === "active"
  );
}

async function averageUnitCost(readContext: RuntimeReadContext, productId: string) {
  const lots = (await readContext.repos.inventoryLots.all()).filter((lot) => lot.productId === productId && lot.unitCostRub > 0);
  if (lots.length === 0) return undefined;
  const totalQty = lots.reduce((sum, lot) => sum + lot.qtyRemaining, 0);
  const totalCost = lots.reduce((sum, lot) => sum + lot.costRemainingRub, 0);
  if (totalQty > 0.0001 && totalCost > 0) return round2(totalCost / totalQty);
  const latest = lots.slice().sort((left, right) => String(right.receivedAt).localeCompare(String(left.receivedAt)))[0];
  return latest ? round2(latest.unitCostRub) : undefined;
}

async function preferredWarehouseId(readContext: RuntimeReadContext, salesChannelId?: string) {
  const channel = salesChannelId ? await readContext.repos.salesChannels.getById(salesChannelId) : undefined;
  if (channel?.salesPointWarehouseId) return channel.salesPointWarehouseId;
  const warehouses = await readContext.repos.warehouses.all();
  return warehouses.find((warehouse) => warehouse.warehouseType === "sales_point")?.id
    ?? warehouses.find((warehouse) => warehouse.warehouseType === "own")?.id
    ?? "";
}

function isHistoricalBackfillProject(project: BackfillProject | undefined) {
  return project?.payload?.mode === "historical_backfill";
}

function isDocumentedFlowBackfillProject(project: BackfillProject | undefined) {
  const mode = project?.payload?.inventoryStartMode ?? project?.payload?.startInventoryMode;
  return mode === "documented_flow";
}

function backfillOpeningQty(project: BackfillProject | undefined, payload: Record<string, unknown>) {
  const rawQty = isHistoricalBackfillProject(project) ? payload.openingQty : payload.observedQty;
  return round4(Math.max(0, Number(rawQty ?? payload.observedQty ?? 0)));
}

function isBeforeStartIgnoredEvent(event: ExternalEvent) {
  return event.status === "ignored" && String(event.reason ?? "").includes("раньше старта учёта");
}

function cloneProject(project: BackfillProject): BackfillProject {
  return { ...project, payload: structuredClone(project.payload ?? {}) };
}

function cloneItem(item: BackfillItem): BackfillItem {
  return { ...item, payload: structuredClone(item.payload ?? {}) };
}
