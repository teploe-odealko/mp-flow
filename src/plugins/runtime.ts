import type { AccountingApp } from "../core/accounting-app";
import type { ID, PluginStateRecord, PluginStateScopeType } from "../core/models";
import { DomainError } from "../core/utils";
import type {
  MarketplacePlugin,
  PluginSecretApi,
  PluginStateApi,
  PluginStateNamespaceDefinition,
  PluginStateNamespaceVisibility
} from "./types";

const DEFAULT_STATE_MAX_BYTES = 64 * 1024;
const DEFAULT_SECRET_MAX_BYTES = 8 * 1024;

function jsonByteSize(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function getNamespaceDefinition(plugin: MarketplacePlugin, namespace: string) {
  const definition = plugin.stateNamespaces?.find((candidate) => candidate.namespace === namespace);
  if (!definition) {
    throw new DomainError("plugin_namespace_not_allowed", `Плагин ${plugin.code} не зарегистрировал namespace ${namespace}`);
  }
  return definition;
}

function assertDefinition(
  plugin: MarketplacePlugin,
  namespace: string,
  scopeType: PluginStateScopeType,
  visibility: PluginStateNamespaceVisibility
) {
  const definition = getNamespaceDefinition(plugin, namespace);
  if (definition.scopeType !== scopeType) {
    throw new DomainError("plugin_namespace_scope_mismatch", `Namespace ${namespace} у плагина ${plugin.code} работает только со scope ${definition.scopeType}`);
  }
  if (definition.visibility !== visibility) {
    throw new DomainError("plugin_namespace_visibility_mismatch", `Namespace ${namespace} у плагина ${plugin.code} имеет тип ${definition.visibility}, а не ${visibility}`);
  }
  return definition;
}

function assertPayloadSize(payload: unknown, maxBytes: number, errorCode: string, errorMessage: string) {
  if (jsonByteSize(payload) > maxBytes) {
    throw new DomainError(errorCode, errorMessage, { maxBytes });
  }
}

function toStateRecord(record: PluginStateRecord) {
  return {
    ...record,
    payload: structuredClone(record.payload)
  };
}

export function createPluginStateApi(app: AccountingApp, plugin: MarketplacePlugin): PluginStateApi {
  return {
    list(filter = {}) {
      return app
        .listPluginStateRecords({
          pluginCode: plugin.code,
          namespace: filter.namespace,
          scopeType: filter.scopeType,
          scopeId: filter.scopeId,
          stateKey: filter.stateKey
        })
        .map(toStateRecord);
    },
    get(filter) {
      const definition = getNamespaceDefinition(plugin, filter.namespace);
      if (definition.visibility === "secret") {
        throw new DomainError("plugin_secret_namespace_read_forbidden", `Namespace ${filter.namespace} относится к secret storage`);
      }
      const record = app.getPluginStateRecord({
        pluginCode: plugin.code,
        namespace: filter.namespace,
        scopeType: filter.scopeType,
        scopeId: filter.scopeId,
        stateKey: filter.stateKey
      });
      return record ? toStateRecord(record) : undefined;
    },
    put(input) {
      const requestedVisibility = input.visibility ?? "private";
      const definition = assertDefinition(plugin, input.namespace, input.scopeType, requestedVisibility);
      assertPayloadSize(
        input.payload,
        definition.maxPayloadBytes ?? DEFAULT_STATE_MAX_BYTES,
        "plugin_state_too_large",
        `Namespace ${input.namespace} превысил лимит состояния`
      );
      return toStateRecord(app.upsertPluginStateRecord({
        pluginCode: plugin.code,
        namespace: input.namespace,
        visibility: requestedVisibility,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        stateKey: input.stateKey,
        payload: input.payload,
        expectedRevision: input.expectedRevision
      }));
    },
    delete(input) {
      const definition = getNamespaceDefinition(plugin, input.namespace);
      if (definition.visibility === "secret") {
        throw new DomainError("plugin_secret_namespace_delete_forbidden", `Namespace ${input.namespace} относится к secret storage`);
      }
      if (definition.scopeType !== input.scopeType) {
        throw new DomainError("plugin_namespace_scope_mismatch", `Namespace ${input.namespace} у плагина ${plugin.code} работает только со scope ${definition.scopeType}`);
      }
      return app.deletePluginStateRecord({
        pluginCode: plugin.code,
        namespace: input.namespace,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        stateKey: input.stateKey,
        expectedRevision: input.expectedRevision
      });
    }
  };
}

export function createPluginSecretApi(app: AccountingApp, plugin: MarketplacePlugin): PluginSecretApi {
  return {
    get(input) {
      assertDefinition(plugin, input.namespace, input.scopeType, "secret");
      const secret = app.getPluginSecret({
        pluginCode: plugin.code,
        namespace: input.namespace,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        secretKey: input.secretKey
      });
      return secret ? { revision: secret.revision, payload: { ...secret.payload } } : undefined;
    },
    put(input) {
      const definition = assertDefinition(plugin, input.namespace, input.scopeType, "secret");
      assertPayloadSize(
        input.payload,
        definition.maxPayloadBytes ?? DEFAULT_SECRET_MAX_BYTES,
        "plugin_secret_too_large",
        `Namespace ${input.namespace} превысил лимит secret storage`
      );
      return app.upsertPluginSecret({
        pluginCode: plugin.code,
        namespace: input.namespace,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        secretKey: input.secretKey,
        payload: input.payload,
        expectedRevision: input.expectedRevision
      });
    },
    delete(input) {
      assertDefinition(plugin, input.namespace, input.scopeType, "secret");
      return app.deletePluginSecret({
        pluginCode: plugin.code,
        namespace: input.namespace,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        secretKey: input.secretKey,
        expectedRevision: input.expectedRevision
      });
    }
  };
}

export function pluginStateKey(channelId: ID, suffix = "default") {
  return `channel:${channelId}:${suffix}`;
}

export function pluginScopedStateRecord<T extends Record<string, unknown>>(
  app: AccountingApp,
  plugin: MarketplacePlugin,
  input: {
    namespace: string;
    scopeType: PluginStateScopeType;
    scopeId: ID;
    stateKey: string;
  }
) {
  const api = createPluginStateApi(app, plugin);
  return api.get(input) as (PluginStateRecord & { payload: T }) | undefined;
}

export type RegisteredPluginNamespace = PluginStateNamespaceDefinition;
