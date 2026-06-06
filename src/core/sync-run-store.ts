import type { ID, SyncRun } from "./models";

/**
 * Порт доступа к запускам синхронизации (syncRuns). Эти записи живут только в слое API
 * (app.ts): создаются при старте sync, мутируются по ходу длинной операции и сохраняются.
 * Доменного использования нет — поэтому за портом стоит либо in-memory (тесты), либо
 * Postgres-репозиторий (sync_run вне snapshot). Тот же паттерн, что ExternalEventStore.
 */
export interface SyncRunStore {
  getById(id: ID): Promise<SyncRun | undefined>;
  listAll(): Promise<SyncRun[]>;
  listByChannel(channelId: ID): Promise<SyncRun[]>;
  upsert(run: SyncRun): Promise<void>;
  deleteByIds(ids: ID[]): Promise<void>;
}

/** In-memory реализация поверх массива (обычно — ссылка на state.syncRuns). */
export class InMemorySyncRunStore implements SyncRunStore {
  private readonly byId = new Map<ID, SyncRun>();

  constructor(private readonly items: SyncRun[]) {
    for (const item of items) this.byId.set(item.id, item);
  }

  async getById(id: ID): Promise<SyncRun | undefined> {
    return this.byId.get(id);
  }

  async listAll(): Promise<SyncRun[]> {
    return this.items;
  }

  async listByChannel(channelId: ID): Promise<SyncRun[]> {
    return this.items.filter((item) => item.channelId === channelId);
  }

  async upsert(run: SyncRun): Promise<void> {
    const index = this.items.findIndex((item) => item.id === run.id);
    if (index >= 0) this.items[index] = run;
    else this.items.push(run);
    this.byId.set(run.id, run);
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
