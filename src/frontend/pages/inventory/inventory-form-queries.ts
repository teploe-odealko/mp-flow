import { useQuery, type QueryClient } from "@tanstack/react-query";
import { apiGet } from "@/api";

export const INVENTORY_FORMS_WORKSPACE_QUERY_KEY = ["inventory-forms-workspace"] as const;

export interface InventoryFormsWorkspacePayload {
  accountingPolicy?: any;
  costApplications: any[];
  documents: any[];
  externalProducts: any[];
  inventoryLots: any[];
  journalEntries: any[];
  observedStocks: any[];
  productExternalLinks: any[];
  products: any[];
  salesChannels: any[];
  stockMovements: any[];
  stockStates: any[];
  stockTransferLines: any[];
  stockTransfers: any[];
  stocktakeLines: any[];
  stocktakes: any[];
  warehouses: any[];
}

const EMPTY_INVENTORY_FORMS_WORKSPACE: InventoryFormsWorkspacePayload = {
  accountingPolicy: undefined,
  costApplications: [],
  documents: [],
  externalProducts: [],
  inventoryLots: [],
  journalEntries: [],
  observedStocks: [],
  productExternalLinks: [],
  products: [],
  salesChannels: [],
  stockMovements: [],
  stockStates: [],
  stockTransferLines: [],
  stockTransfers: [],
  stocktakeLines: [],
  stocktakes: [],
  warehouses: []
};

const INVENTORY_FORMS_LEGACY_COLLECTION_KEYS = [
  "accountingPolicy",
  "costApplications",
  "documents",
  "externalProducts",
  "inventoryLots",
  "journalEntries",
  "observedStocks",
  "productExternalLinks",
  "products",
  "salesChannels",
  "stockMovements",
  "stockStates",
  "stockTransferLines",
  "stockTransfers",
  "stocktakeLines",
  "stocktakes",
  "warehouses"
] as const;

export function useInventoryFormsWorkspace() {
  const query = useQuery({
    queryKey: INVENTORY_FORMS_WORKSPACE_QUERY_KEY,
    queryFn: () => apiGet<InventoryFormsWorkspacePayload>("/api/inventory/forms/workspace")
  });
  return query.data ?? EMPTY_INVENTORY_FORMS_WORKSPACE;
}

export function invalidateInventoryFormsArea(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: INVENTORY_FORMS_WORKSPACE_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ["inventory-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["sales-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["finance-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["documents-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["accounting-journal-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["sync-inbox-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["observed-stock"] });
  INVENTORY_FORMS_LEGACY_COLLECTION_KEYS.forEach((name) => {
    void queryClient.invalidateQueries({ queryKey: ["collection", name] });
  });
}
