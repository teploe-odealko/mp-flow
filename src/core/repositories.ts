import type { AccountingState } from "./models";

/**
 * Слой репозиториев для перевода синхронного in-memory движка (AccountingApp) на
 * async-доступ к данным. Во время миграции репозитории бэкаются ТЕМИ ЖЕ массивами,
 * что и `state` (см. buildInMemoryRepositories) — поведение идентично, тесты держатся,
 * tsc остаётся зелёным по мере конверсии метод-за-методом сверху вниз.
 *
 * В финале конверсии in-memory реализация заменяется на Postgres-репозитории (запрос на
 * операцию), а сам `state`-снэпшот + loadSnapshot/saveState + глобальный лок удаляются.
 *
 * Доступ намеренно «толстый» (all()/find/filter в домене), чтобы конверсия была механической:
 *   this.state.documents.filter(p)        → (await this.repos.documents.all()).filter(p)
 *   this.state.documents.push(x)          → await this.repos.documents.add(x)
 *   entity.field = v (мутация на месте)    → ...; await this.repos.documents.upsert(entity)
 *   this.state.documents = arr.filter(...) → await this.repos.documents.removeWhere(!pred)
 */
export interface CollectionRepo<T> {
  all(): Promise<T[]>;
  getById(id: string): Promise<T | undefined>;
  add(item: T): Promise<T>;
  upsert(item: T): Promise<T>;
  removeById(id: string): Promise<void>;
  removeWhere(pred: (item: T) => boolean): Promise<void>;
  /** Заменить всё содержимое (мутируя на месте — ссылка на массив сохраняется). */
  replaceAll(items: T[]): Promise<void>;
}

export class InMemoryCollectionRepo<T> implements CollectionRepo<T> {
  constructor(private readonly items: T[]) {}

  async all(): Promise<T[]> {
    return this.items;
  }

  async getById(id: string): Promise<T | undefined> {
    return this.items.find((item) => (item as { id?: string }).id === id);
  }

  async add(item: T): Promise<T> {
    this.items.push(item);
    return item;
  }

  async upsert(item: T): Promise<T> {
    const id = (item as { id?: string }).id;
    const index = id
      ? this.items.findIndex((candidate) => (candidate as { id?: string }).id === id)
      : this.items.indexOf(item);
    if (index >= 0) this.items[index] = item;
    else this.items.push(item);
    return item;
  }

  async removeById(id: string): Promise<void> {
    const index = this.items.findIndex((item) => (item as { id?: string }).id === id);
    if (index >= 0) this.items.splice(index, 1);
  }

  async removeWhere(pred: (item: T) => boolean): Promise<void> {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      if (pred(this.items[index])) this.items.splice(index, 1);
    }
  }

  async replaceAll(items: T[]): Promise<void> {
    this.items.length = 0;
    this.items.push(...items);
  }
}

/** Массивные коллекции state, для каждой — свой репозиторий. */
type ArrayCollections = {
  [K in keyof AccountingState as AccountingState[K] extends Array<infer _> ? K : never]: AccountingState[K] extends Array<infer E> ? E : never;
};

export type Repositories = {
  [K in keyof ArrayCollections]: CollectionRepo<ArrayCollections[K]>;
};

/**
 * Строит репозитории поверх массивов конкретного state. ВНИМАНИЕ: репозиторий держит
 * ссылку на массив, поэтому в домене нельзя переприсваивать `state.X = ...` для уже
 * сконвертированных коллекций — только мутировать через репозиторий (add/removeWhere).
 */
export function buildInMemoryRepositories(state: AccountingState): Repositories {
  const repos = {} as Repositories;
  for (const key of Object.keys(state) as (keyof AccountingState)[]) {
    const value = state[key];
    if (Array.isArray(value)) {
      (repos as Record<string, unknown>)[key as string] = new InMemoryCollectionRepo(value as unknown[]);
    }
  }
  return repos;
}
