import type { createApi } from "../../src/backend/app";

export async function readStateViaApi(api: ReturnType<typeof createApi>): Promise<any> {
  const [
    setup,
    accounting,
    documentsWorkspace,
    inventoryForms,
    salesWorkspace,
    channelsWorkspace,
    payoutWorkspace,
    events,
    observedStocks,
    mcp
  ] = await Promise.all([
    get<any>(api, "/api/setup"),
    get<{ entries: unknown[]; lines: unknown[] }>(api, "/api/accounting/journal"),
    get<{ documents: unknown[] }>(api, "/api/documents/workspace"),
    get<any>(api, "/api/inventory/forms/workspace"),
    get<any>(api, "/api/sales/workspace"),
    get<{ plugins: unknown[]; channels: unknown[] }>(api, "/api/channels/workspace"),
    get<{ payouts: unknown[]; payoutLines: unknown[] }>(api, "/api/finance/payouts/workspace"),
    get<unknown[]>(api, "/api/integrations/events"),
    get<unknown[]>(api, "/api/integrations/observed-stock"),
    get<{ keys: unknown[] }>(api, "/api/mcp/config")
  ]);

  return {
    organization: setup.organization,
    accountingPolicy: setup.accountingPolicy,
    periods: setup.periods ?? [],
    cashAccounts: setup.cashAccounts ?? [],
    warehouses: inventoryForms.warehouses ?? setup.warehouses ?? [],
    chartAccounts: [],
    documents: uniqueById([...(documentsWorkspace.documents ?? []), ...(salesWorkspace.documents ?? []), ...(inventoryForms.documents ?? [])]),
    documentLines: salesWorkspace.documentLines ?? [],
    journalEntries: accounting.entries ?? [],
    journalLines: accounting.lines ?? [],
    products: inventoryForms.products ?? salesWorkspace.products ?? [],
    inventoryLots: inventoryForms.inventoryLots ?? salesWorkspace.inventoryLots ?? [],
    stockMovements: inventoryForms.stockMovements ?? [],
    stockStates: inventoryForms.stockStates ?? [],
    costApplications: inventoryForms.costApplications ?? salesWorkspace.costApplications ?? [],
    salesChannels: channelsWorkspace.channels ?? inventoryForms.salesChannels ?? salesWorkspace.salesChannels ?? [],
    integrationPlugins: channelsWorkspace.plugins ?? [],
    externalProducts: inventoryForms.externalProducts ?? [],
    productExternalLinks: inventoryForms.productExternalLinks ?? [],
    observedStocks,
    externalEvents: events,
    sales: salesWorkspace.sales ?? [],
    saleLines: salesWorkspace.saleLines ?? [],
    salesReturns: salesWorkspace.salesReturns ?? [],
    channelFinanceEvents: salesWorkspace.channelFinanceEvents ?? [],
    payouts: payoutWorkspace.payouts ?? [],
    payoutLines: payoutWorkspace.payoutLines ?? [],
    agentTokens: mcp.keys ?? []
  };
}

async function get<T>(api: ReturnType<typeof createApi>, path: string): Promise<T> {
  const response = await api.request(path);
  const payload = await response.json() as { ok: boolean; data: T; error?: { code: string; message: string } };
  if (!payload.ok) throw new Error(`${payload.error?.code}: ${payload.error?.message}`);
  return payload.data;
}

function uniqueById(items: unknown[]) {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const item of items) {
    const id = (item as { id?: string } | null)?.id;
    if (!id) {
      result.push(item);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }
  return result;
}
