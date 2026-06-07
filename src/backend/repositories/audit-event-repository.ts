import type { AuditEvent } from "../../core/models";
import { stableUuid } from "../../infra/db/ids";
import {
  AUDIT_EVENT_JOINS,
  AUDIT_EVENT_SELECT,
  auditEventFromRow,
  type AuditEventDbRow
} from "../../infra/db/runtime-hydrators";
import type { Queryable } from "../db/transaction";

/**
 * Репозиторий журнала аудита: append-only поток, читается только для отображения и
 * истории документа, никогда не читается посреди доменных операций. Поэтому хранится
 * вне snapshot — пишется на commit, читается прямыми запросами. Lookup по сущности идёт
 * через typed entity_id, hydrate — по typed/public колонкам.
 */
export class AuditEventRepository {
  constructor(private readonly q: Queryable, private readonly workspaceId: string) {}

  async listAll(opts: { limit?: number; offset?: number } = {}): Promise<AuditEvent[]> {
    const params: unknown[] = [this.workspaceId];
    let sql = `select ${AUDIT_EVENT_SELECT} from audit_event ${AUDIT_EVENT_JOINS} where audit_event.workspace_id = $1 order by audit_event.created_at asc, audit_event.id asc`;
    if (opts.limit !== undefined) {
      params.push(opts.limit);
      sql += ` limit $${params.length}`;
    }
    if (opts.offset !== undefined) {
      params.push(opts.offset);
      sql += ` offset $${params.length}`;
    }
    const result = await this.q.query<AuditEventDbRow>(sql, params);
    return result.rows.map(auditEventFromRow);
  }

  async listByEntity(entityId: string): Promise<AuditEvent[]> {
    const result = await this.q.query<AuditEventDbRow>(
      `select ${AUDIT_EVENT_SELECT}
       from audit_event
       ${AUDIT_EVENT_JOINS}
       where audit_event.workspace_id = $1 and audit_event.entity_id = $2
       order by audit_event.created_at asc, audit_event.id asc`,
      [this.workspaceId, stableUuid(entityId)]
    );
    return result.rows.map(auditEventFromRow);
  }
}
