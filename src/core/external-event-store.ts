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
  upsert(event: ExternalEvent): Promise<void>;
  deleteByIds(ids: ID[]): Promise<void>;
}

/**
 * In-memory реализация поверх массива (обычно — ссылка на state.externalEvents),
 * чтобы существующие in-memory тесты, инспектирующие state.externalEvents, продолжали
 * работать без изменений.
 */
export class InMemoryExternalEventStore implements ExternalEventStore {
  constructor(private readonly events: ExternalEvent[]) {}

  async getById(id: ID): Promise<ExternalEvent | undefined> {
    return this.events.find((event) => event.id === id);
  }

  async findByIdentity(channelId: ID, externalId: string, idempotencyKey?: string): Promise<ExternalEvent | undefined> {
    if (idempotencyKey) {
      const byKey = this.events.find((event) => event.channelId === channelId && event.idempotencyKey === idempotencyKey);
      if (byKey) return byKey;
    }
    return this.events.find((event) => event.channelId === channelId && event.externalId === externalId);
  }

  async list(filter: ExternalEventListFilter = {}): Promise<ExternalEvent[]> {
    return this.events.filter((event) =>
      (!filter.channelId || event.channelId === filter.channelId) &&
      (!filter.status || event.status === filter.status) &&
      (!filter.eventType || event.eventType === filter.eventType)
    );
  }

  async upsert(event: ExternalEvent): Promise<void> {
    const index = this.events.findIndex((candidate) => candidate.id === event.id);
    if (index >= 0) this.events[index] = event;
    else this.events.push(event);
  }

  async deleteByIds(ids: ID[]): Promise<void> {
    const set = new Set(ids);
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      if (set.has(this.events[i].id)) this.events.splice(i, 1);
    }
  }
}
