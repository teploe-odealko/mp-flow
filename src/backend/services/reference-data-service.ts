import type { CashAccount, Counterparty, ID, Warehouse } from "../../core/models";
import { DomainError, id, round2 } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";
import { currentOrganizationId, writeAudit } from "./runtime-audit-service";

export async function createCounterparty(writeContext: RuntimeWriteContext, input: {
  name: string;
  counterpartyType: Counterparty["counterpartyType"];
  country?: string;
  inn?: string;
}): Promise<Counterparty> {
  const counterparty: Counterparty = {
    id: id("cp"),
    organizationId: currentOrganizationId(writeContext),
    name: input.name,
    counterpartyType: input.counterpartyType,
    country: input.country,
    inn: input.inn,
    isActive: true
  };
  await writeContext.repos.counterparties.add(counterparty);
  await writeAudit(writeContext, "counterparty", counterparty.id, "create", undefined, counterparty);
  return counterparty;
}

export async function createWarehouse(writeContext: RuntimeWriteContext, input: {
  name: string;
  warehouseType: Warehouse["warehouseType"];
  channelId?: ID;
}): Promise<Warehouse> {
  const warehouse: Warehouse = {
    id: id("wh"),
    organizationId: currentOrganizationId(writeContext),
    name: input.name,
    warehouseType: input.warehouseType,
    channelId: input.channelId,
    isActive: true
  };
  await writeContext.repos.warehouses.add(warehouse);
  await writeAudit(writeContext, "warehouse", warehouse.id, "create", undefined, warehouse);
  return warehouse;
}

export async function createCashAccount(writeContext: RuntimeWriteContext, input: {
  name: string;
  accountCode: "50" | "51";
  openingBalanceRub?: number;
}): Promise<CashAccount> {
  const account: CashAccount = {
    id: id("cash"),
    organizationId: currentOrganizationId(writeContext),
    name: input.name,
    accountCode: input.accountCode,
    balanceRub: round2(input.openingBalanceRub ?? 0),
    isActive: true
  };
  await writeContext.repos.cashAccounts.add(account);
  await writeAudit(writeContext, "cash_account", account.id, "create", undefined, account);
  return account;
}

export async function updateCashAccount(
  writeContext: RuntimeWriteContext,
  accountId: ID,
  patch: Partial<Pick<CashAccount, "name" | "isActive">>
): Promise<CashAccount> {
  const account = await writeContext.repos.cashAccounts.getById(accountId);
  if (!account) throw new DomainError("cash_account_not_found", "Счёт денег не найден");
  const before = { ...account };
  if (patch.name !== undefined) account.name = patch.name;
  if (patch.isActive !== undefined) account.isActive = patch.isActive;
  await writeContext.repos.cashAccounts.upsert(account);
  await writeAudit(writeContext, "cash_account", account.id, "update", before, account);
  return account;
}
