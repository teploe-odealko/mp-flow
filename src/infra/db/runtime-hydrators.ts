import type { AccountingPolicy, AuditEvent, ExternalEvent, ObservedStock, SyncRun, Organization } from "../../core/models";

export const ORGANIZATION_SELECT = `
  organization.public_id as id,
  organization.display_name,
  organization.legal_form,
  organization.inn,
  organization.timezone,
  organization.tax_mode,
  organization.created_at,
  organization.updated_at
`;

export interface OrganizationDbRow {
  id: string;
  display_name: string;
  legal_form: Organization["legalForm"];
  inn: string | null;
  timezone: string;
  tax_mode: Organization["taxMode"];
  created_at: unknown;
  updated_at: unknown;
}

export function organizationFromRow(row: OrganizationDbRow): Organization {
  return stripUndefined({
    id: row.id,
    displayName: row.display_name,
    legalForm: row.legal_form,
    inn: optionalText(row.inn),
    timezone: row.timezone,
    taxMode: row.tax_mode,
    createdAt: dateTimeString(row.created_at),
    updatedAt: optionalDateTimeString(row.updated_at)
  });
}

export const ACCOUNTING_POLICY_SELECT = `
  accounting_policy.public_id as id,
  accounting_policy_organization.public_id as organization_id,
  accounting_policy.accounting_start_date,
  accounting_policy.cost_method,
  accounting_policy.accounting_currency,
  accounting_policy.allow_open_period_edits,
  accounting_policy.comment
`;

export const ACCOUNTING_POLICY_JOINS = `
  left join organization accounting_policy_organization on accounting_policy_organization.id = accounting_policy.organization_id
`;

export interface AccountingPolicyDbRow {
  id: string;
  organization_id: string;
  accounting_start_date: unknown;
  cost_method: AccountingPolicy["costMethod"];
  accounting_currency: AccountingPolicy["accountingCurrency"];
  allow_open_period_edits: boolean | null;
  comment: string | null;
}

export function accountingPolicyFromRow(row: AccountingPolicyDbRow): AccountingPolicy {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    accountingStartDate: dateString(row.accounting_start_date),
    costMethod: row.cost_method,
    accountingCurrency: row.accounting_currency,
    allowOpenPeriodEdits: row.allow_open_period_edits ?? undefined,
    comment: optionalText(row.comment)
  });
}

export const EXTERNAL_EVENT_SELECT = `
  external_event.public_id as id,
  external_event_organization.public_id as organization_id,
  external_event_channel.public_id as channel_id,
  external_event_sync_run.public_id as sync_run_id,
  external_event.event_type,
  external_event.external_id,
  external_event.idempotency_key,
  external_event.occurred_at,
  external_event.raw_payload,
  external_event.normalized_payload,
  external_event.status,
  external_event_materialized_document.public_id as materialized_document_id,
  external_event_external_product.public_id as external_product_id,
  external_event_product.public_id as product_id,
  external_event.reason,
  external_event.last_error,
  external_event.created_at,
  external_event.updated_at
`;

export const EXTERNAL_EVENT_JOINS = `
  left join organization external_event_organization on external_event_organization.id = external_event.organization_id
  left join sales_channel external_event_channel on external_event_channel.id = external_event.channel_id
  left join sync_run external_event_sync_run on external_event_sync_run.id = external_event.sync_run_id
  left join document external_event_materialized_document on external_event_materialized_document.id = external_event.materialized_document_id
  left join external_product external_event_external_product on external_event_external_product.id = external_event.external_product_id
  left join product external_event_product on external_event_product.id = external_event.product_id
`;

export interface ExternalEventDbRow {
  id: string;
  organization_id: string;
  channel_id: string;
  sync_run_id: string | null;
  event_type: ExternalEvent["eventType"];
  external_id: string;
  idempotency_key: string | null;
  occurred_at: unknown;
  raw_payload: unknown;
  normalized_payload: unknown;
  status: ExternalEvent["status"];
  materialized_document_id: string | null;
  external_product_id: string | null;
  product_id: string | null;
  reason: string | null;
  last_error: string | null;
  created_at: unknown;
  updated_at: unknown;
}

export function externalEventFromRow(row: ExternalEventDbRow): ExternalEvent {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    channelId: row.channel_id,
    syncRunId: optionalText(row.sync_run_id),
    eventType: row.event_type,
    externalId: row.external_id,
    idempotencyKey: row.idempotency_key ?? row.external_id,
    occurredAt: dateTimeString(row.occurred_at),
    rawPayload: row.raw_payload,
    normalizedPayload: row.normalized_payload,
    status: row.status,
    materializedDocumentId: optionalText(row.materialized_document_id),
    externalProductId: optionalText(row.external_product_id),
    productId: optionalText(row.product_id),
    reason: optionalText(row.reason),
    lastError: optionalText(row.last_error),
    createdAt: dateTimeString(row.created_at),
    updatedAt: dateTimeString(row.updated_at)
  });
}

export const OBSERVED_STOCK_SELECT = `
  observed_stock.public_id as id,
  observed_stock_organization.public_id as organization_id,
  observed_stock_channel.public_id as channel_id,
  observed_stock_external_product.public_id as external_product_id,
  observed_stock_product.public_id as product_id,
  observed_stock_warehouse.public_id as warehouse_id,
  observed_stock.observed_at,
  observed_stock.qty_observed,
  observed_stock.location_status
`;

export const OBSERVED_STOCK_JOINS = `
  left join organization observed_stock_organization on observed_stock_organization.id = observed_stock.organization_id
  left join sales_channel observed_stock_channel on observed_stock_channel.id = observed_stock.channel_id
  left join external_product observed_stock_external_product on observed_stock_external_product.id = observed_stock.external_product_id
  left join product observed_stock_product on observed_stock_product.id = observed_stock.product_id
  left join warehouse observed_stock_warehouse on observed_stock_warehouse.id = observed_stock.warehouse_id
`;

export interface ObservedStockDbRow {
  id: string;
  organization_id: string;
  channel_id: string;
  external_product_id: string;
  product_id: string | null;
  warehouse_id: string | null;
  observed_at: unknown;
  qty_observed: string | number;
  location_status: ObservedStock["locationStatus"];
}

export function observedStockFromRow(row: ObservedStockDbRow): ObservedStock {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    channelId: row.channel_id,
    externalProductId: row.external_product_id,
    productId: optionalText(row.product_id),
    warehouseId: optionalText(row.warehouse_id),
    observedAt: dateTimeString(row.observed_at),
    qtyObserved: Number(row.qty_observed),
    locationStatus: row.location_status
  });
}

export const SYNC_RUN_SELECT = `
  sync_run.public_id as id,
  sync_run_organization.public_id as organization_id,
  sync_run_channel.public_id as channel_id,
  sync_run.status,
  sync_run.started_at,
  sync_run.finished_at,
  sync_run.stats,
  sync_run.mode,
  sync_run.streams,
  sync_run.errors,
  sync_run.since,
  sync_run.summary,
  sync_run.stream_runs,
  sync_run.last_error
`;

export const SYNC_RUN_JOINS = `
  left join organization sync_run_organization on sync_run_organization.id = sync_run.organization_id
  left join sales_channel sync_run_channel on sync_run_channel.id = sync_run.channel_id
`;

export interface SyncRunDbRow {
  id: string;
  organization_id: string;
  channel_id: string;
  status: SyncRun["status"];
  started_at: unknown;
  finished_at: unknown;
  stats: Record<string, number>;
  mode: SyncRun["mode"] | null;
  streams: SyncRun["streams"] | null;
  errors: string[] | null;
  since: string | null;
  summary: SyncRun["summary"] | null;
  stream_runs: SyncRun["streamRuns"] | null;
  last_error: string | null;
}

export function syncRunFromRow(row: SyncRunDbRow): SyncRun {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    channelId: row.channel_id,
    status: row.status,
    startedAt: dateTimeString(row.started_at),
    finishedAt: optionalDateTimeString(row.finished_at),
    stats: row.stats ?? {},
    mode: optionalText(row.mode) as SyncRun["mode"] | undefined,
    streams: row.streams ?? undefined,
    errors: row.errors ?? undefined,
    since: optionalText(row.since),
    summary: row.summary ?? undefined,
    streamRuns: row.stream_runs ?? undefined,
    lastError: optionalText(row.last_error)
  });
}

export const AUDIT_EVENT_SELECT = `
  audit_event.public_id as id,
  audit_event_organization.public_id as organization_id,
  audit_event.actor_label,
  audit_event.entity_type,
  audit_event.entity_public_id,
  audit_event.event_type,
  audit_event.before_json,
  audit_event.after_json,
  audit_event.reason,
  audit_event.created_at
`;

export const AUDIT_EVENT_JOINS = `
  left join organization audit_event_organization on audit_event_organization.id = audit_event.organization_id
`;

export interface AuditEventDbRow {
  id: string;
  organization_id: string;
  actor_label: string;
  entity_type: string;
  entity_public_id: string;
  event_type: string;
  before_json: unknown;
  after_json: unknown;
  reason: string | null;
  created_at: unknown;
}

export function auditEventFromRow(row: AuditEventDbRow): AuditEvent {
  return stripUndefined({
    id: row.id,
    organizationId: row.organization_id,
    actorLabel: row.actor_label,
    entityType: row.entity_type,
    entityId: row.entity_public_id,
    eventType: row.event_type,
    before: row.before_json ?? undefined,
    after: row.after_json ?? undefined,
    reason: optionalText(row.reason),
    createdAt: dateTimeString(row.created_at)
  });
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalDateTimeString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return dateTimeString(value);
}

function dateTimeString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function dateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "");
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
