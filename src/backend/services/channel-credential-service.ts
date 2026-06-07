import type { ID, SalesChannel } from "../../core/models";
import { DomainError, nowIso } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";
import { pluginRegistry } from "../../plugins/registry";

type CredentialStatus = { channelId: string; saved: boolean; fields: string[] };
type CredentialPayload = Record<string, string | undefined>;
type ValidationResult = { ok: true } | { ok: false; message: string };

export async function clearChannelCredentials(writeContext: RuntimeWriteContext, channelId: ID): Promise<CredentialStatus> {
  const channel = await findChannel(writeContext, channelId);
  const data = await credentialsAccess(writeContext).clearChannelCredentials(channel.id);
  if (channel.status === "active") {
    channel.status = "needs_setup";
    await writeContext.repos.salesChannels.upsert(channel);
  }
  return data;
}

export async function saveChannelCredentials(
  writeContext: RuntimeWriteContext,
  channelId: ID,
  credentials: CredentialPayload
): Promise<CredentialStatus & { online: ValidationResult }> {
  const channel = await findChannel(writeContext, channelId);
  const installedPlugin = await requireInstalledPlugin(writeContext, channel);
  const plugin = pluginRegistry.get(installedPlugin.code);
  const validation = plugin.validateCredentials(credentials);
  if (!validation.ok) throw new DomainError("plugin_credentials_invalid", validation.message);

  const saved = await credentialsAccess(writeContext).saveChannelCredentials(channel.id, credentials);
  if (plugin.checkAccess) {
    const online = await plugin.checkAccess(credentials);
    channel.lastCheckedAt = nowIso();
    if (online.ok) {
      channel.status = "active";
      channel.lastError = undefined;
    } else {
      channel.status = "error";
      channel.lastError = online.message;
      await writeContext.repos.salesChannels.upsert(channel);
      return { ...saved, online };
    }
  } else if (channel.status === "needs_setup") {
    channel.status = "active";
  }

  await writeContext.repos.salesChannels.upsert(channel);
  return { ...saved, online: { ok: true } };
}

export async function checkChannelAccess(
  writeContext: RuntimeWriteContext,
  channelId: ID,
  credentialsFromRequest?: CredentialPayload
): Promise<{ channelId: ID; validation: ValidationResult; status?: SalesChannel["status"] }> {
  const channel = await findChannel(writeContext, channelId);
  const installedPlugin = channel.pluginId ? await writeContext.repos.integrationPlugins.getById(channel.pluginId) : undefined;
  const credentials = credentialsFromRequest ?? await credentialsAccess(writeContext).channelCredentialsFor(channel.id);
  if (!installedPlugin) {
    return { channelId: channel.id, validation: { ok: true } };
  }

  const plugin = pluginRegistry.get(installedPlugin.code);
  const shape = plugin.validateCredentials(credentials ?? {});
  if (!shape.ok) {
    channel.status = "error";
    channel.lastError = shape.message;
    channel.lastCheckedAt = nowIso();
    await writeContext.repos.salesChannels.upsert(channel);
    return { channelId: channel.id, validation: shape };
  }

  const online = plugin.checkAccess ? await plugin.checkAccess(credentials ?? {}) : { ok: true as const };
  channel.lastCheckedAt = nowIso();
  if (online.ok) {
    channel.lastError = undefined;
    if (channel.status !== "disabled") channel.status = "active";
  } else {
    channel.status = "error";
    channel.lastError = online.message;
  }
  await writeContext.repos.salesChannels.upsert(channel);
  return { channelId: channel.id, validation: online, status: channel.status };
}

export async function disableSalesChannel(writeContext: RuntimeWriteContext, channelId: ID): Promise<SalesChannel> {
  const channel = await findChannel(writeContext, channelId);
  channel.status = "disabled";
  await writeContext.repos.salesChannels.upsert(channel);
  return channel;
}

function credentialsAccess(writeContext: RuntimeWriteContext) {
  if (!writeContext.channelCredentials) {
    throw new DomainError("channel_credentials_unavailable", "Хранилище учётных данных канала недоступно");
  }
  return writeContext.channelCredentials;
}

async function findChannel(writeContext: RuntimeWriteContext, channelId: ID): Promise<SalesChannel> {
  const channel = await writeContext.repos.salesChannels.getById(channelId);
  if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
  return channel;
}

async function requireInstalledPlugin(writeContext: RuntimeWriteContext, channel: SalesChannel) {
  const installedPlugin = channel.pluginId ? await writeContext.repos.integrationPlugins.getById(channel.pluginId) : undefined;
  if (!installedPlugin) throw new DomainError("plugin_not_found", "У канала не выбран плагин");
  return installedPlugin;
}
