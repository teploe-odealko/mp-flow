import type { createApi } from "../../src/backend/app";

const COLLECTIONS = [
  "organization",
  "accountingPolicy",
  "periods",
  "chartAccounts",
  "documentTypes",
  "documents",
  "documentLines",
  "documentVersions",
  "documentLinks",
  "journalEntries",
  "journalLines",
  "auditEvents",
  "counterparties",
  "products",
  "productAssets",
  "warehouses",
  "stockStates",
  "inventoryLots",
  "stockMovements",
  "costApplications",
  "purchaseOrders",
  "purchaseOrderLines",
  "cashAccounts",
  "payments",
  "paymentAllocations",
  "settlementEntries",
  "goodsReceipts",
  "goodsReceiptLines",
  "procurementCosts",
  "procurementCostLines",
  "shortageResolutions",
  "shortageResolutionLines",
  "supplierClaims",
  "stockTransfers",
  "stockTransferLines",
  "pluginStateRecords",
  "integrationPlugins",
  "salesChannels",
  "externalProducts",
  "productExternalLinks",
  "syncRuns",
  "externalEvents",
  "observedStocks",
  "sales",
  "saleLines",
  "salesReturns",
  "channelFinanceEvents",
  "payouts",
  "payoutLines",
  "expenseCategories",
  "operatingExpenses",
  "ownerTransactions",
  "stocktakes",
  "stocktakeLines",
  "correctionCases",
  "recalculationJobs",
  "reportSnapshots",
  "backfillProjects",
  "backfillItems",
  "users",
  "roles",
  "agentTokens",
  "channelAgentPermissions"
] as const;

export async function readStateViaCollections(api: ReturnType<typeof createApi>): Promise<any> {
  const entries = await Promise.all(
    COLLECTIONS.map(async (name) => [name, await getCollection(api, name)] as const)
  );
  return Object.fromEntries(entries);
}

async function getCollection(api: ReturnType<typeof createApi>, name: string): Promise<unknown> {
  const response = await api.request(`/api/collections/${name}`);
  const payload = await response.json() as { ok: boolean; data: unknown; error?: { code: string; message: string } };
  if (!payload.ok) throw new Error(`${payload.error?.code}: ${payload.error?.message}`);
  return payload.data;
}
