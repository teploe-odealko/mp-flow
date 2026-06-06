import type { ExternalEvent, ID } from "./models";

export interface ExternalEventListFilter {
  channelId?: ID;
  status?: string;
  eventType?: string;
}

/**
 * Порт доступа к потоку событий маркетплейса. Async — чтобы за ним могла стоять
 * как in-memory реализация (тесты, поведение прежнее), так и Postgres-репозиторий
 * (события вне snapshot). Доменные методы, читающие/пишущие события, работают через
 * этот порт вместо прямого доступа к state.externalEvents.
 */
export interface ExternalEventStore {
  getById(id: ID): Promise<ExternalEvent | undefined>;
  findByIdentity(channelId: ID, externalId: string, idempotencyKey?: string): Promise<ExternalEvent | undefined>;
  list(filter?: ExternalEventListFilter): Promise<ExternalEvent[]>;
  count(filter?: { channelId?: ID; status?: string }): Promise<number>;
  upsert(event: ExternalEvent): Promise<void>;
  deleteByIds(ids: ID[]): Promise<void>;
}

function identityKey(channelId: ID, identity: string): string {
  return `${channelId}::${identity.trim()}`;
}

/**
 * In-memory реализация поверх массива (обычно — ссылка на state.externalEvents),
 * чтобы существующие in-memory тесты, инспектирующие state.externalEvents, продолжали
 * работать без изменений. Держит индексы byId/identity для O(1) поиска (как раньше делал
 * сам AccountingApp), иначе дедуп при синке тысяч событий деградировал бы в O(n²).
 */
export class InMemoryExternalEventStore implements ExternalEventStore {
  private byId = new Map<ID, ExternalEvent>();
  private byIdentity = new Map<string, ExternalEvent>();

  constructor(private readonly events: ExternalEvent[]) {
    for (const event of events) this.index(event);
  }

  private index(event: ExternalEvent): void {
    this.byId.set(event.id, event);
    this.byIdentity.set(identityKey(event.channelId, event.externalId), event);
    if (event.idempotencyKey) this.byIdentity.set(identityKey(event.channelId, event.idempotencyKey), event);
  }

  async getById(id: ID): Promise<ExternalEvent | undefined> {
    return this.byId.get(id);
  }

  async findByIdentity(channelId: ID, externalId: string, idempotencyKey?: string): Promise<ExternalEvent | undefined> {
    if (idempotencyKey) {
      const byKey = this.byIdentity.get(identityKey(channelId, idempotencyKey));
      if (byKey) return byKey;
    }
    return this.byIdentity.get(identityKey(channelId, externalId));
  }

  async list(filter: ExternalEventListFilter = {}): Promise<ExternalEvent[]> {
    return this.events.filter((event) =>
      (!filter.channelId || event.channelId === filter.channelId) &&
      (!filter.status || event.status === filter.status) &&
      (!filter.eventType || event.eventType === filter.eventType)
    );
  }

  async count(filter: { channelId?: ID; status?: string } = {}): Promise<number> {
    return (await this.list({ channelId: filter.channelId, status: filter.status })).length;
  }

  async upsert(event: ExternalEvent): Promise<void> {
    const index = this.events.findIndex((candidate) => candidate.id === event.id);
    if (index >= 0) this.events[index] = event;
    else this.events.push(event);
    this.index(event);
  }

  async deleteByIds(ids: ID[]): Promise<void> {
    const set = new Set(ids);
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const event = this.events[i];
      if (!set.has(event.id)) continue;
      this.events.splice(i, 1);
      this.byId.delete(event.id);
      this.byIdentity.delete(identityKey(event.channelId, event.externalId));
      if (event.idempotencyKey) this.byIdentity.delete(identityKey(event.channelId, event.idempotencyKey));
    }
  }
}
