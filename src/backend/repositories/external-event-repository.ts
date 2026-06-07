import type { ExternalEvent } from "../../core/models";
import { stableUuid } from "../../infra/db/ids";
import {
  EXTERNAL_EVENT_JOINS,
  EXTERNAL_EVENT_SELECT,
  externalEventFromRow,
  type ExternalEventDbRow
} from "../../infra/db/runtime-hydrators";
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
 * напрямую из таблицы, не загружая его в общий snapshot. Lookup и hydrate идут по
 * typed/public колонкам; state_json нужен только для legacy backfill runtime-store.
 *
 * Конструируется на запрос с Queryable (пул для чтения или client транзакции для записи)
 * и workspaceId.
 */
export class ExternalEventRepository {
  constructor(private readonly q: Queryable, private readonly workspaceId: string) {}

  async getById(id: string): Promise<ExternalEvent | undefined> {
    const result = await this.q.query<ExternalEventDbRow>(
      `select ${EXTERNAL_EVENT_SELECT}
       from external_event
       ${EXTERNAL_EVENT_JOINS}
       where external_event.workspace_id = $1 and external_event.public_id = $2
       limit 1`,
      [this.workspaceId, id]
    );
    return result.rows[0] ? externalEventFromRow(result.rows[0]) : undefined;
  }

  async findByExternalId(channelId: string, externalId: string): Promise<ExternalEvent | undefined> {
    const result = await this.q.query<ExternalEventDbRow>(
      `select ${EXTERNAL_EVENT_SELECT}
       from external_event
       ${EXTERNAL_EVENT_JOINS}
       where external_event.workspace_id = $1 and external_event.channel_id = $2 and external_event.external_id = $3
       limit 1`,
      [this.workspaceId, stableUuid(channelId), externalId]
    );
    return result.rows[0] ? externalEventFromRow(result.rows[0]) : undefined;
  }

  async list(filter: ExternalEventListFilter = {}): Promise<ExternalEvent[]> {
    const conditions = ["external_event.workspace_id = $1"];
    const params: unknown[] = [this.workspaceId];
    if (filter.channelId) {
      params.push(stableUuid(filter.channelId));
      conditions.push(`external_event.channel_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`external_event.status = $${params.length}`);
    }
    if (filter.eventType) {
      params.push(filter.eventType);
      conditions.push(`external_event.event_type = $${params.length}`);
    }
    let sql = `select ${EXTERNAL_EVENT_SELECT} from external_event ${EXTERNAL_EVENT_JOINS} where ${conditions.join(" and ")} order by external_event.occurred_at desc, external_event.id desc`;
    if (filter.limit !== undefined) {
      params.push(filter.limit);
      sql += ` limit $${params.length}`;
    }
    if (filter.offset !== undefined) {
      params.push(filter.offset);
      sql += ` offset $${params.length}`;
    }
    const result = await this.q.query<ExternalEventDbRow>(sql, params);
    return result.rows.map(externalEventFromRow);
  }

  async count(filter: ExternalEventCountFilter = {}): Promise<number> {
    const conditions = ["workspace_id = $1"];
    const params: unknown[] = [this.workspaceId];
    if (filter.channelId) {
      params.push(stableUuid(filter.channelId));
      conditions.push(`channel_id = $${params.length}`);
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
