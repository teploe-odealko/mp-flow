import type { AuditEvent } from "../../core/models";
import { stableUuid } from "../../infra/db/ids";
import type { Queryable } from "../db/transaction";

/**
 * Репозиторий журнала аудита: append-only поток, читается только для отображения и
 * истории документа, никогда не читается посреди доменных операций. Поэтому хранится
 * вне snapshot — пишется на commit, читается прямыми запросами. Lookup по сущности идёт
 * через typed entity_id; state_json пока остаётся hydrate payload.
 */
export class AuditEventRepository {
  constructor(private readonly q: Queryable, private readonly workspaceId: string) {}

  async listAll(opts: { limit?: number; offset?: number } = {}): Promise<AuditEvent[]> {
    const params: unknown[] = [this.workspaceId];
    let sql = "select state_json from audit_event where workspace_id = $1 order by created_at asc, id asc";
    if (opts.limit !== undefined) {
      params.push(opts.limit);
      sql += ` limit $${params.length}`;
    }
    if (opts.offset !== undefined) {
      params.push(opts.offset);
      sql += ` offset $${params.length}`;
    }
    const result = await this.q.query<{ state_json: AuditEvent }>(sql, params);
    return result.rows.map((row) => row.state_json);
  }

  async listByEntity(entityId: string): Promise<AuditEvent[]> {
    const result = await this.q.query<{ state_json: AuditEvent }>(
      `select state_json from audit_event
       where workspace_id = $1 and entity_id = $2
       order by created_at asc, id asc`,
      [this.workspaceId, stableUuid(entityId)]
    );
    return result.rows.map((row) => row.state_json);
  }
}
