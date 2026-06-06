/**
 * Нумерованные миграции для классического слоя. Применяются по порядку id один раз
 * (см. migrate.ts). SQL держим идемпотентным (IF NOT EXISTS), чтобы пережить повторные
 * прогоны и сосуществование со старым schema.sql-bootstrap.
 */
export interface Migration {
  id: string;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: "0001",
    name: "external_event_repository_indexes",
    sql: `
      create index if not exists external_event_channel_external_idx
        on external_event (workspace_id, channel_id, external_id);
      create index if not exists external_event_channel_status_idx
        on external_event (workspace_id, channel_id, status);
      create index if not exists external_event_channel_occurred_idx
        on external_event (workspace_id, channel_id, occurred_at);
    `
  },
  {
    id: "0002",
    name: "external_event_repository_json_indexes",
    sql: `
      create index if not exists external_event_ws_chan_ext_idx
        on external_event (workspace_id, (state_json->>'channelId'), external_id);
      create index if not exists external_event_ws_chan_status_idx
        on external_event (workspace_id, (state_json->>'channelId'), status);
      create index if not exists external_event_ws_id_idx
        on external_event (workspace_id, (state_json->>'id'));
    `
  }
];
