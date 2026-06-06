import type { ExternalEvent } from "../../core/models";
import type { Queryable } from "../db/transaction";

export interface ExternalEventListFilter {
  channelId?: string;
  status?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}

export interface ExternalEventCountFilter {
  channelId?: string;
  status?: string;
}

/**
 * Классический репозиторий для external_event: читает поток событий маркетплейса
 * напрямую из таблицы, не загружая его в общий snapshot. Источник истины — state_json
 * (как и в snapshot-гидрации), поэтому совместим с уже записанными строками.
 *
 * Конструируется на запрос с Queryable (пул для чтения или client транзакции для записи)
 * и workspaceId. Запись добавим вместе с выносом таблицы из snapshot (нельзя, чтобы
 * snapshot и репозиторий писали в одну таблицу одновременно).
 */
export class ExternalEventRepository {
  constructor(private readonly q: Queryable, private readonly workspaceId: string) {}

  async getById(id: string): Promise<ExternalEvent | undefined> {
    const result = await this.q.query<{ state_json: ExternalEvent }>(
      "select state_json from external_event where workspace_id = $1 and state_json->>'id' = $2 limit 1",
      [this.workspaceId, id]
    );
    return result.rows[0]?.state_json;
  }

  async findByExternalId(channelId: string, externalId: string): Promise<ExternalEvent | undefined> {
    const result = await this.q.query<{ state_json: ExternalEvent }>(
      `select state_json from external_event
       where workspace_id = $1 and state_json->>'channelId' = $2 and external_id = $3
       limit 1`,
      [this.workspaceId, channelId, externalId]
    );
    return result.rows[0]?.state_json;
  }

  async list(filter: ExternalEventListFilter = {}): Promise<ExternalEvent[]> {
    const conditions = ["workspace_id = $1"];
    const params: unknown[] = [this.workspaceId];
    if (filter.channelId) {
      params.push(filter.channelId);
      conditions.push(`state_json->>'channelId' = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.eventType) {
      params.push(filter.eventType);
      conditions.push(`event_type = $${params.length}`);
    }
    let sql = `select state_json from external_event where ${conditions.join(" and ")} order by occurred_at desc, id desc`;
    if (filter.limit !== undefined) {
      params.push(filter.limit);
      sql += ` limit $${params.length}`;
    }
    if (filter.offset !== undefined) {
      params.push(filter.offset);
      sql += ` offset $${params.length}`;
    }
    const result = await this.q.query<{ state_json: ExternalEvent }>(sql, params);
    return result.rows.map((row) => row.state_json);
  }

  async count(filter: ExternalEventCountFilter = {}): Promise<number> {
    const conditions = ["workspace_id = $1"];
    const params: unknown[] = [this.workspaceId];
    if (filter.channelId) {
      params.push(filter.channelId);
      conditions.push(`state_json->>'channelId' = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    const result = await this.q.query<{ count: string }>(
      `select count(*)::text as count from external_event where ${conditions.join(" and ")}`,
      params
    );
    return Number(result.rows[0]?.count ?? "0");
  }
}
