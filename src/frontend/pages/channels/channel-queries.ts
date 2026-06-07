import type { QueryClient } from "@tanstack/react-query";

export const CHANNELS_WORKSPACE_QUERY_KEY = ["channels-workspace"] as const;
export const SYNC_INBOX_WORKSPACE_QUERY_KEY = ["sync-inbox-workspace"] as const;

export const channelDetailQueryKey = (channelId?: string | null) => ["channel-detail", channelId ?? ""] as const;
export const channelSyncRunsQueryKey = (channelId?: string | null) => ["sync-runs", channelId ?? ""] as const;
export const channelFinanceWorkspaceQueryKey = (channelId?: string | null) => ["channel-finance-workspace", channelId ?? ""] as const;
export const financeEventWorkspaceQueryKey = (eventId?: string | null) => ["finance-event-workspace", eventId ?? ""] as const;

const CHANNEL_LEGACY_COLLECTION_KEYS = [
  "salesChannels",
  "integrationPlugins",
  "warehouses",
  "externalProducts",
  "products",
  "documents",
  "syncRuns",
  "externalEvents",
  "observedStocks",
  "sales",
  "salesReturns",
  "channelFinanceEvents",
  "payouts",
  "backfillProjects"
] as const;

export function invalidateChannelArea(
  queryClient: QueryClient,
  channelId?: string | null,
  financeEventId?: string | null
) {
  void queryClient.invalidateQueries({ queryKey: CHANNELS_WORKSPACE_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: SYNC_INBOX_WORKSPACE_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ["events"] });
  void queryClient.invalidateQueries({ queryKey: ["observed-stock"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["products-channel-mapping"] });
  void queryClient.invalidateQueries({ queryKey: ["inventory-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["finance-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["documents-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["accounting-journal-workspace"] });

  if (channelId) {
    void queryClient.invalidateQueries({ queryKey: channelDetailQueryKey(channelId) });
    void queryClient.invalidateQueries({ queryKey: channelSyncRunsQueryKey(channelId) });
    void queryClient.invalidateQueries({ queryKey: channelFinanceWorkspaceQueryKey(channelId) });
  } else {
    void queryClient.invalidateQueries({ queryKey: ["channel-detail"] });
    void queryClient.invalidateQueries({ queryKey: ["sync-runs"] });
    void queryClient.invalidateQueries({ queryKey: ["channel-finance-workspace"] });
  }

  if (financeEventId) {
    void queryClient.invalidateQueries({ queryKey: financeEventWorkspaceQueryKey(financeEventId) });
  } else {
    void queryClient.invalidateQueries({ queryKey: ["finance-event-workspace"] });
  }

  CHANNEL_LEGACY_COLLECTION_KEYS.forEach((name) => {
    void queryClient.invalidateQueries({ queryKey: ["collection", name] });
  });
}
