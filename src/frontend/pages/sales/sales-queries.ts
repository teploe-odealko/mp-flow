import { useQuery, type QueryClient } from "@tanstack/react-query";
import { apiGet } from "@/api";

export const SALES_WORKSPACE_QUERY_KEY = ["sales-workspace"] as const;

export interface SalesWorkspacePayload {
  channelFinanceEvents: any[];
  costApplications: any[];
  documentLines: any[];
  documents: any[];
  externalEvents: any[];
  inventoryLots: any[];
  journalEntries: any[];
  products: any[];
  saleLines: any[];
  sales: any[];
  salesChannels: any[];
  salesReturns: any[];
  warehouses: any[];
}

const EMPTY_SALES_WORKSPACE: SalesWorkspacePayload = {
  channelFinanceEvents: [],
  costApplications: [],
  documentLines: [],
  documents: [],
  externalEvents: [],
  inventoryLots: [],
  journalEntries: [],
  products: [],
  saleLines: [],
  sales: [],
  salesChannels: [],
  salesReturns: [],
  warehouses: []
};

const SALES_LEGACY_COLLECTION_KEYS = [
  "channelFinanceEvents",
  "costApplications",
  "documentLines",
  "documents",
  "externalEvents",
  "inventoryLots",
  "journalEntries",
  "products",
  "saleLines",
  "sales",
  "salesChannels",
  "salesReturns",
  "warehouses"
] as const;

export function useSalesWorkspace() {
  const query = useQuery({
    queryKey: SALES_WORKSPACE_QUERY_KEY,
    queryFn: () => apiGet<SalesWorkspacePayload>("/api/sales/workspace")
  });
  return query.data ?? EMPTY_SALES_WORKSPACE;
}

export function invalidateSalesArea(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: SALES_WORKSPACE_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["inventory-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["finance-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["documents-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["accounting-journal-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["channels-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["sync-inbox-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["channel-finance-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["finance-event-workspace"] });
  SALES_LEGACY_COLLECTION_KEYS.forEach((name) => {
    void queryClient.invalidateQueries({ queryKey: ["collection", name] });
  });
}
