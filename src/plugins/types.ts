import type { AccountingApp } from "../core/accounting-app";
import type { ChannelStreamCode, ID, PluginStateRecord, PluginStateScopeType } from "../core/models";

export type PluginCapability =
  | "products"
  | "stocks"
  | "sales"
  | "returns"
  | "finance_events"
  | "payouts"
  | "observed_stock";

export interface PluginCredentials {
  clientId?: string;
  apiKey?: string;
  token?: string;
  sellerId?: string;
}

export type PluginStateNamespaceVisibility = "private" | "shared" | "secret";

export interface PluginStateNamespaceDefinition {
  namespace: string;
  visibility: PluginStateNamespaceVisibility;
  scopeType: PluginStateScopeType;
  description?: string;
  maxPayloadBytes?: number;
}

export interface PluginStateApi {
  list(filter?: {
    namespace?: string;
    scopeType?: PluginStateScopeType;
    scopeId?: ID;
    stateKey?: string;
  }): PluginStateRecord[];
  get(filter: {
    namespace: string;
    scopeType: PluginStateScopeType;
    scopeId: ID;
    stateKey: string;
  }): PluginStateRecord | undefined;
  put(input: {
    namespace: string;
    visibility?: Exclude<PluginStateNamespaceVisibility, "secret">;
    scopeType: PluginStateScopeType;
    scopeId: ID;
    stateKey: string;
    payload: Record<string, unknown>;
    expectedRevision?: number;
  }): PluginStateRecord;
  delete(input: {
    namespace: string;
    scopeType: PluginStateScopeType;
    scopeId: ID;
    stateKey: string;
    expectedRevision?: number;
  }): boolean;
}

export interface PluginSecretApi {
  get(input: {
    namespace: string;
    scopeType: PluginStateScopeType;
    scopeId: ID;
    secretKey: string;
  }): { revision: number; payload: Record<string, string | undefined> } | undefined;
  put(input: {
    namespace: string;
    scopeType: PluginStateScopeType;
    scopeId: ID;
    secretKey: string;
    payload: Record<string, string | undefined>;
    expectedRevision?: number;
  }): { revision: number; payload: Record<string, string | undefined> };
  delete(input: {
    namespace: string;
    scopeType: PluginStateScopeType;
    scopeId: ID;
    secretKey: string;
    expectedRevision?: number;
  }): boolean;
}

export interface PluginRuntimeContext {
  app: AccountingApp;
  channelId: ID;
  syncRunId?: ID;
  since?: string;
  credentials?: PluginCredentials;
  streams?: ChannelStreamCode[];
  mode?: "incremental" | "full" | "backfill";
  // When false, the sync must NOT auto-create or auto-link internal products from the
  // marketplace catalog — it only records external products/observed stock and leaves
  // product mapping to an explicit user decision (used by the onboarding import).
  // Undefined/true preserves the legacy auto-link behavior for ongoing syncs.
  autoLinkProducts?: boolean;
  pluginState: PluginStateApi;
  pluginSecrets: PluginSecretApi;
}

export interface SyncContext extends PluginRuntimeContext {}

export interface SyncResult {
  pluginCode: string;
  channelId: ID;
  status: "completed" | "failed";
  stats: Record<string, number>;
  errors: string[];
}

export type FulfillmentCapability =
  | "dispatch_plan"
  | "allocation_hints"
  | "remote_targets"
  | "remote_supply_draft"
  | "remote_supply_status";

export interface DispatchSourceLineInput {
  itemId: string;
  goodsReceiptLineId: ID;
  purchaseOrderLineId?: ID;
  productId: ID;
  itemSku: string;
  itemTitle: string;
  qty: number;
  availableQtyAtSource: number;
  unitCostRub: number;
  allocatedGoodsCostRub: number;
  offerIds: string[];
  purchaseWeightGrams?: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
}

export interface DispatchPlanDestination {
  id: string;
  title: string;
  clusterName?: string | null;
  warehouseName?: string | null;
  deliveryMacrolocalClusterId?: number | null;
  recommendedQty?: number;
  demand30dQty?: number;
  averageDeliveryHours?: number | null;
  attentionLevel?: string | null;
  minClusterQty?: number;
  providerMetadata?: Record<string, unknown>;
}

export interface DispatchPlanLine extends DispatchSourceLineInput {
  warnings?: string[];
  placementZone?: string | null;
  marketplaceSkus?: number[];
}

export interface DispatchPlanningInput extends PluginRuntimeContext {
  receiptId: ID;
  channelName: string;
  sourceWarehouseId: ID;
  salesPointWarehouseId: ID;
  transferDate: string;
  lines: DispatchSourceLineInput[];
}

export interface DispatchPlan {
  mode: "basic_transfer" | "channel_allocation";
  notes: string[];
  warnings: string[];
  defaultSelectedDestinationIds?: string[];
  sourceWarehouseId: ID;
  salesPointWarehouseId: ID;
  lines: DispatchPlanLine[];
  destinations: DispatchPlanDestination[];
  sellerWarehouses?: Array<{
    id: string;
    title: string;
    isActive: boolean;
    isPickup?: boolean;
    region?: string | null;
    address?: string | null;
  }>;
}

export interface DispatchAllocation {
  destinationId: string;
  lines: Array<{ itemId: string; qty: number }>;
}

export interface DispatchAutoAllocateInput extends PluginRuntimeContext {
  receiptId: ID;
  selectedDestinationIds: string[];
  plan: DispatchPlan;
}

export interface DispatchAutoAllocateResult {
  allocations: DispatchAllocation[];
  notes: string[];
  errors: string[];
}

export interface RemoteSupplyDraft {
  providerCode: string;
  draftId: string;
  draftLabel: string;
  statusLabel: string;
  clusterCount: number;
  targetWarehouseTitle?: string | null;
  draftUrl?: string | null;
  providerMetadata?: Record<string, unknown>;
}

export interface RemoteSupplyDraftInput extends PluginRuntimeContext {
  receiptId: ID;
  transferId: ID;
  transferDate: string;
  plan: DispatchPlan;
  allocations: DispatchAllocation[];
  sellerWarehouseId?: string;
}

export interface MarketplaceFulfillmentPlugin {
  capabilities: FulfillmentCapability[];
  planDispatchFromReceipt?(input: DispatchPlanningInput): Promise<DispatchPlan>;
  autoAllocateDispatch?(input: DispatchAutoAllocateInput): Promise<DispatchAutoAllocateResult>;
  createRemoteSupplyDraft?(input: RemoteSupplyDraftInput): Promise<RemoteSupplyDraft>;
}

export interface MarketplacePlugin {
  code: string;
  displayName: string;
  capabilities: PluginCapability[];
  stateNamespaces?: PluginStateNamespaceDefinition[];
  fulfillment?: MarketplaceFulfillmentPlugin;
  validateCredentials(credentials: PluginCredentials): { ok: true } | { ok: false; message: string };
  /**
   * Optional online check — actually pings the marketplace to verify the keys.
   * If absent, only validateCredentials shape-check runs.
   */
  checkAccess?(credentials: PluginCredentials): Promise<{ ok: true } | { ok: false; message: string }>;
  sync(context: SyncContext): Promise<SyncResult>;
}
