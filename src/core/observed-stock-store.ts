import type { ID, ObservedStock } from "./models";

/**
 * Порт доступа к наблюдаемым остаткам канала (observedStocks). Async — чтобы за ним стояла
 * как in-memory реализация (тесты, поведение прежнее), так и Postgres-репозиторий (остатки
 * вне snapshot). Доменные методы, читающие/пишущие остатки, работают через этот порт вместо
 * прямого доступа к state.observedStocks. Тот же паттерн, что ExternalEventStore.
 */
export interface ObservedStockListFilter {
  channelId?: ID;
  externalProductId?: ID;
}

export interface ObservedStockStore {
  getById(id: ID): Promise<ObservedStock | undefined>;
  /** Дедуп recordObservedStock: уникален по (channelId, externalProductId, warehouseId, observedAt). */
  findByKey(channelId: ID, externalProductId: ID, warehouseId: ID | undefined, observedAt: string): Promise<ObservedStock | undefined>;
  list(filter?: ObservedStockListFilter): Promise<ObservedStock[]>;
  count(filter?: { channelId?: ID }): Promise<number>;
  upsert(observed: ObservedStock): Promise<void>;
  deleteByIds(ids: ID[]): Promise<void>;
}

/**
 * In-memory реализация поверх массива (обычно — ссылка на state.observedStocks), чтобы
 * существующие in-memory тесты, инспектирующие state.observedStocks, продолжали работать.
 */
export class InMemoryObservedStockStore implements ObservedStockStore {
  private readonly byId = new Map<ID, ObservedStock>();

  constructor(private readonly items: ObservedStock[]) {
    for (const item of items) this.byId.set(item.id, item);
  }

  async getById(id: ID): Promise<ObservedStock | undefined> {
    return this.byId.get(id);
  }

  async findByKey(channelId: ID, externalProductId: ID, warehouseId: ID | undefined, observedAt: string): Promise<ObservedStock | undefined> {
    return this.items.find(
      (candidate) =>
        candidate.channelId === channelId &&
        candidate.externalProductId === externalProductId &&
        candidate.warehouseId === warehouseId &&
        candidate.observedAt === observedAt
    );
  }

  async list(filter: ObservedStockListFilter = {}): Promise<ObservedStock[]> {
    return this.items.filter(
      (candidate) =>
        (!filter.channelId || candidate.channelId === filter.channelId) &&
        (!filter.externalProductId || candidate.externalProductId === filter.externalProductId)
    );
  }

  async count(filter: { channelId?: ID } = {}): Promise<number> {
    return (await this.list(filter)).length;
  }

  async upsert(observed: ObservedStock): Promise<void> {
    const index = this.items.findIndex((candidate) => candidate.id === observed.id);
    if (index >= 0) this.items[index] = observed;
    else this.items.push(observed);
    this.byId.set(observed.id, observed);
  }

  async deleteByIds(ids: ID[]): Promise<void> {
    if (ids.length === 0) return;
    const set = new Set(ids);
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      if (set.has(this.items[index].id)) this.items.splice(index, 1);
    }
    for (const id of ids) this.byId.delete(id);
  }
}
