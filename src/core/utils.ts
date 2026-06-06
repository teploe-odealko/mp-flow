import { AsyncLocalStorage } from "node:async_hooks";
import type { AccountingState, ID } from "./models";

let nextId = 1;
const idSequenceStorage = new AsyncLocalStorage<{ nextId: number }>();

function currentSequenceStore() {
  return idSequenceStorage.getStore();
}

export function id(prefix: string): ID {
  const store = currentSequenceStore();
  const current = store ? store.nextId : nextId;
  const value = `${prefix}_${String(current).padStart(6, "0")}`;
  if (store) {
    store.nextId += 1;
  } else {
    nextId += 1;
  }
  return value;
}

export function resetIds() {
  const store = currentSequenceStore();
  if (store) {
    store.nextId = 1;
  } else {
    nextId = 1;
  }
}

export function currentIdSequence() {
  return currentSequenceStore()?.nextId ?? nextId;
}

export function restoreIdSequence(value: number) {
  const normalized = Math.max(1, Math.floor(value));
  const store = currentSequenceStore();
  if (store) {
    store.nextId = normalized;
  } else {
    nextId = normalized;
  }
}

export async function runWithIdSequence<T>(value: number, fn: () => Promise<T> | T): Promise<T> {
  return await idSequenceStorage.run({ nextId: Math.max(1, Math.floor(value)) }, fn);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function assertPositive(value: number, message: string) {
  if (!(value > 0)) {
    throw new DomainError("validation_error", message);
  }
}

export function assertNonNegative(value: number, message: string) {
  if (value < 0) {
    throw new DomainError("validation_error", message);
  }
}

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function createEmptyState(): AccountingState {
  return {
    organization: undefined,
    accountingPolicy: undefined,
    periods: [],
    chartAccounts: [],
    journalEntries: [],
    journalLines: [],
    documentTypes: [],
    documents: [],
    documentLines: [],
    documentVersions: [],
    documentLinks: [],
    auditEvents: [],
    counterparties: [],
    products: [],
    productAssets: [],
    warehouses: [],
    stockStates: [],
    inventoryLots: [],
    stockMovements: [],
    costApplications: [],
    purchaseOrders: [],
    purchaseOrderLines: [],
    cashAccounts: [],
    payments: [],
    paymentAllocations: [],
    settlementEntries: [],
    goodsReceipts: [],
    goodsReceiptLines: [],
    procurementCosts: [],
    procurementCostLines: [],
    shortageResolutions: [],
    shortageResolutionLines: [],
    supplierClaims: [],
    stockTransfers: [],
    stockTransferLines: [],
    integrationPlugins: [],
    salesChannels: [],
    externalProducts: [],
    productExternalLinks: [],
    syncRuns: [],
    externalEvents: [],
    observedStocks: [],
    sales: [],
    saleLines: [],
    salesReturns: [],
    channelFinanceEvents: [],
    payouts: [],
    payoutLines: [],
    expenseCategories: [],
    operatingExpenses: [],
    ownerTransactions: [],
    stocktakes: [],
    stocktakeLines: [],
    correctionCases: [],
    recalculationJobs: [],
    reportSnapshots: [],
    backfillProjects: [],
    backfillItems: [],
    users: [],
    roles: [],
    agentTokens: [],
    channelAgentPermissions: [],
    pluginStateRecords: []
  };
}

export function monthPeriods(organizationId: ID, startDate: string, months = 18) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  return Array.from({ length: months }, (_, index) => {
    const monthStart = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index, 1));
    const monthEnd = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index + 1, 0));
    const label = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthStart);
    return {
      id: id("period"),
      organizationId,
      label: label[0].toUpperCase() + label.slice(1),
      startsOn: monthStart.toISOString().slice(0, 10),
      endsOn: monthEnd.toISOString().slice(0, 10),
      status: "open" as const
    };
  });
}
