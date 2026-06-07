import type { BootstrapInput } from "../../core/accounting-app";
import type { AccountingPolicy, AccountingState, AuditEvent, ID, Organization, Role, UserAccount, Warehouse } from "../../core/models";
import { DomainError, id, monthPeriods, nowIso, round2 } from "../../core/utils";
import { seedChartAccounts, seedDocumentTypes } from "../../core/setup-seeds";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";

type RuntimeUserInput = Pick<UserAccount, "id" | "email" | "name" | "roleCode" | "status">;

export async function bootstrapSetup(writeContext: RuntimeWriteContext, input: BootstrapInput, authUser?: RuntimeUserInput) {
  const existing = writeContext.setupMetadata().organization;
  if (existing) return await dashboardFor(writeContext);

  validateSetupInput(input, false, undefined);
  const createdAt = nowIso();
  const organization: Organization = {
    id: id("org"),
    displayName: input.displayName,
    legalForm: input.legalForm ?? "ip",
    inn: input.inn,
    timezone: input.timezone ?? "Europe/Moscow",
    taxMode: input.taxMode ?? "usn_income_expense",
    createdAt,
    updatedAt: createdAt
  };
  const accountingPolicy: AccountingPolicy = {
    id: id("policy"),
    organizationId: organization.id,
    accountingStartDate: input.accountingStartDate,
    costMethod: "fifo",
    accountingCurrency: "RUB",
    allowOpenPeriodEdits: input.allowOpenPeriodEdits ?? true,
    comment: input.comment
  };

  await writeContext.repos.saveSingletons?.({ organization, accountingPolicy });
  for (const period of monthPeriods(organization.id, input.accountingStartDate, 24)) await writeContext.repos.periods.add(period);
  await ensureRequiredSystemMetadata(writeContext, organization.id);
  await writeContext.repos.cashAccounts.add({ id: id("cash"), organizationId: organization.id, name: "Расчетный счет", accountCode: "51", balanceRub: 0, isActive: true });
  await writeContext.repos.counterparties.add({ id: id("cp"), organizationId: organization.id, name: "Владелец", counterpartyType: "owner", country: "RU", isActive: true });
  for (const warehouse of defaultWarehouses(organization.id)) await writeContext.repos.warehouses.add(warehouse);
  for (const plugin of defaultIntegrationPlugins()) await writeContext.repos.integrationPlugins.add(plugin);
  for (const category of defaultExpenseCategories(organization.id)) await writeContext.repos.expenseCategories.add(category);
  await writeContext.repos.users.add({
    id: id("user"),
    organizationId: organization.id,
    email: "owner@mpflow.local",
    name: "Владелец",
    roleCode: "owner",
    status: "active",
    invitedAt: nowIso(),
    lastActiveAt: nowIso()
  });
  for (const role of defaultRoles(organization.id)) await writeContext.repos.roles.add(role);
  await writeAuditWithOrganization(writeContext, organization.id, "organization", organization.id, "bootstrap", undefined, organization, "Первичная настройка");
  if (authUser) await ensureRuntimeUser(writeContext, organization.id, authUser);
  return await dashboardFor(writeContext, organization, accountingPolicy);
}

export async function updateSetup(writeContext: RuntimeWriteContext, input: BootstrapInput, authUser?: RuntimeUserInput) {
  const metadata = writeContext.setupMetadata();
  if (!metadata.organization || !metadata.accountingPolicy) return await bootstrapSetup(writeContext, input, authUser);

  const documentsExist = (await writeContext.repos.documents.all()).length > 0;
  validateSetupInput(input, documentsExist, metadata.accountingPolicy.accountingStartDate);
  const organization = metadata.organization;
  const accountingPolicy = metadata.accountingPolicy;
  const organizationBefore = { ...organization };
  const policyBefore = { ...accountingPolicy };
  organization.displayName = input.displayName;
  organization.legalForm = input.legalForm ?? organization.legalForm;
  organization.inn = input.inn || undefined;
  organization.timezone = input.timezone ?? organization.timezone;
  organization.taxMode = input.taxMode ?? organization.taxMode;
  organization.updatedAt = nowIso();
  accountingPolicy.allowOpenPeriodEdits = input.allowOpenPeriodEdits ?? accountingPolicy.allowOpenPeriodEdits ?? true;
  accountingPolicy.comment = input.comment || undefined;
  if (!documentsExist && input.accountingStartDate !== accountingPolicy.accountingStartDate) {
    accountingPolicy.accountingStartDate = input.accountingStartDate;
    await writeContext.repos.periods.replaceAll(monthPeriods(organization.id, input.accountingStartDate, 24));
  }
  await writeContext.repos.saveSingletons?.({ organization, accountingPolicy });
  await writeAuditWithOrganization(writeContext, organization.id, "organization", organization.id, "update", organizationBefore, organization, "Обновление первичной настройки");
  await writeAuditWithOrganization(writeContext, organization.id, "accounting_policy", accountingPolicy.id, "update", policyBefore, accountingPolicy, "Обновление первичной настройки");
  if (authUser) await ensureRuntimeUser(writeContext, organization.id, authUser);
  return await setupSnapshotFor(writeContext, organization, accountingPolicy);
}

async function ensureRequiredSystemMetadata(writeContext: RuntimeWriteContext, organizationId: ID) {
  const accountsByCode = new Map((await writeContext.repos.chartAccounts.all()).map((account) => [account.code, account]));
  for (const seed of seedChartAccounts(organizationId)) {
    const account = accountsByCode.get(seed.code);
    if (account) await writeContext.repos.chartAccounts.upsert({ ...account, name: seed.name, kind: seed.kind, normalSide: seed.normalSide, isActive: seed.isActive });
    else await writeContext.repos.chartAccounts.add(seed);
  }
  const documentTypesByCode = new Map((await writeContext.repos.documentTypes.all()).map((documentType) => [documentType.code, documentType]));
  for (const seed of seedDocumentTypes()) {
    const documentType = documentTypesByCode.get(seed.code);
    if (documentType) await writeContext.repos.documentTypes.upsert({ ...documentType, ...seed });
    else await writeContext.repos.documentTypes.add(seed);
  }
}

async function ensureRuntimeUser(writeContext: RuntimeWriteContext, organizationId: ID, input: RuntimeUserInput) {
  const users = await writeContext.repos.users.all();
  const existing = users.find((candidate) => candidate.email.toLowerCase() === input.email.toLowerCase());
  if (existing) {
    Object.assign(existing, { name: input.name, roleCode: input.roleCode, status: input.status });
    if (input.status === "active") existing.lastActiveAt = nowIso();
    await writeContext.repos.users.upsert(existing);
    return existing;
  }
  const placeholder = users.find((candidate) =>
    candidate.email.toLowerCase() === "owner@mpflow.local" &&
    candidate.roleCode === "owner" &&
    input.roleCode === "owner"
  );
  if (placeholder) {
    const placeholderId = placeholder.id;
    Object.assign(placeholder, { id: input.id, email: input.email, name: input.name, roleCode: input.roleCode, status: input.status });
    if (input.status === "active") placeholder.lastActiveAt = nowIso();
    if (placeholderId !== placeholder.id) {
      await writeContext.repos.users.removeById(placeholderId);
      await writeContext.repos.users.add(placeholder);
    } else {
      await writeContext.repos.users.upsert(placeholder);
    }
    return placeholder;
  }
  const user: UserAccount = {
    id: input.id,
    organizationId,
    email: input.email,
    name: input.name,
    roleCode: input.roleCode,
    status: input.status,
    invitedAt: nowIso(),
    lastActiveAt: input.status === "active" ? nowIso() : undefined
  };
  await writeContext.repos.users.add(user);
  return user;
}

function validateSetupInput(input: BootstrapInput, documentsExist: boolean, currentAccountingStartDate: string | undefined) {
  if (!input.displayName.trim()) throw new DomainError("organization_name_required", "Укажите название учетного контура");
  if (input.inn && !/^\d{12}$/.test(input.inn)) throw new DomainError("invalid_inn", "ИНН ИП должен содержать 12 цифр");
  if (!input.accountingStartDate) throw new DomainError("accounting_start_required", "Укажите дату старта учета");
  const startDate = new Date(input.accountingStartDate);
  if (Number.isNaN(startDate.getTime())) throw new DomainError("invalid_accounting_start", "Некорректная дата старта учета");
  const now = new Date();
  const maxFuture = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  if (startDate > maxFuture) throw new DomainError("accounting_start_too_far", "Дата старта учета не может быть позже чем через год");
  const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (startDate < startOfCurrentMonth && input.confirmHistoricalStart === false) {
    throw new DomainError("historical_start_requires_confirmation", "Подтвердите историческую дату старта учета");
  }
  if (documentsExist && currentAccountingStartDate && input.accountingStartDate !== currentAccountingStartDate) {
    throw new DomainError("accounting_start_locked", "Нельзя менять дату старта после появления учетных документов");
  }
}

function defaultWarehouses(organizationId: ID): Warehouse[] {
  return [
    { id: id("wh"), organizationId, name: "Мой склад", warehouseType: "own", isActive: true },
    { id: id("wh"), organizationId, name: "В пути", warehouseType: "transit", isActive: true },
    { id: id("wh"), organizationId, name: "Точка продаж", warehouseType: "sales_point", isActive: true }
  ];
}

function defaultIntegrationPlugins(): AccountingState["integrationPlugins"] {
  return [
    { id: id("plugin"), code: "ozon", displayName: "Ozon", status: "available" },
    { id: id("plugin"), code: "wildberries", displayName: "Wildberries", status: "available" },
    { id: id("plugin"), code: "manual", displayName: "Ручной канал", status: "installed" }
  ];
}

function defaultExpenseCategories(organizationId: ID): AccountingState["expenseCategories"] {
  return [
    { id: id("expense_cat"), organizationId, name: "Зарплата и подрядчики", accountCode: "26" },
    { id: id("expense_cat"), organizationId, name: "Реклама", accountCode: "44" },
    { id: id("expense_cat"), organizationId, name: "Прочие расходы", accountCode: "91.02" }
  ];
}

function defaultRoles(organizationId: ID): Role[] {
  return [
    { id: id("role"), organizationId, code: "owner", name: "Владелец" },
    { id: id("role"), organizationId, code: "accountant", name: "Бухгалтер" },
    { id: id("role"), organizationId, code: "operator", name: "Оператор" },
    { id: id("role"), organizationId, code: "viewer", name: "Наблюдатель" }
  ];
}

async function setupSnapshotFor(writeContext: RuntimeWriteContext, organization: Organization | undefined, accountingPolicy: AccountingPolicy | undefined) {
  return {
    organization,
    accountingPolicy,
    periods: await writeContext.repos.periods.all(),
    cashAccounts: await writeContext.repos.cashAccounts.all(),
    warehouses: await writeContext.repos.warehouses.all(),
    configured: Boolean(organization)
  };
}

async function dashboardFor(writeContext: RuntimeWriteContext, organization = writeContext.setupMetadata().organization, accountingPolicy = writeContext.setupMetadata().accountingPolicy) {
  const periods = await writeContext.repos.periods.all();
  const products = await writeContext.repos.products.all();
  const documents = await writeContext.repos.documents.all();
  const inventoryLots = await writeContext.repos.inventoryLots.all();
  const correctionCases = await writeContext.repos.correctionCases.all();
  const stockStates = await writeContext.repos.stockStates.all();
  const sales = await writeContext.repos.sales.all();
  const purchaseOrders = await writeContext.repos.purchaseOrders.all();
  return {
    organization,
    configured: Boolean(organization),
    policy: accountingPolicy,
    currentPeriod: periods.find((period) => period.status === "open"),
    periods,
    counters: {
      products: products.length,
      documents: documents.length,
      postedDocuments: documents.filter((document) => document.status === "posted").length,
      inventoryLots: inventoryLots.filter((lot) => Number(lot.qtyRemaining ?? 0) > 0).length,
      sales: sales.length,
      purchaseOrders: purchaseOrders.length,
      openCorrections: correctionCases.filter((correction) => correction.status !== "applied").length
    },
    inventoryCostRub: round2(stockStates.reduce((sum, stock) => sum + Number(stock.costRub ?? 0), 0)),
    recentDocuments: documents
      .slice()
      .sort((left, right) => String(right.accountingDate).localeCompare(String(left.accountingDate)) || String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
      .slice(0, 6),
    balances: {}
  };
}

async function writeAuditWithOrganization(
  writeContext: RuntimeWriteContext,
  organizationId: ID,
  entityType: string,
  entityId: ID,
  eventType: string,
  before?: unknown,
  after?: unknown,
  reason?: string
) {
  const event: AuditEvent = {
    id: id("audit"),
    organizationId,
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
