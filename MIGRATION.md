# Переезд бэкенда на классическую REST-архитектуру

Статус: в работе. Цель — уйти от in-memory снэпшота всего состояния к слоёной
архитектуре «controllers → services → repositories → Postgres» с транзакцией на
запрос.

## Прогресс
- ✅ Этап 0: db-слой (pool, `withTransaction`, runner миграций) — коммит `4f83070`.
- ✅ `ExternalEventRepository` (чтение) + индексы + PG-тест — `d6c2f54`.
- ✅ Эндпоинты событий на репозитории, мимо снэпшота — `4736022`.
- ✅ `auditEvents` полностью вне снэпшота (append-only) — `5b9e9ed`.
- ✅ `externalEvents`: доменный доступ через async `ExternalEventStore` (find/ingest/
  reprocess/ignore/saleLookup/reset) + весь pipeline/плагины/роуты на `await` — `23f5c31`
  (поведение сохранено: in-memory стор оборачивает `state.externalEvents`; всё зелёное).

### Остаток по `externalEvents` (механический хвост → выпил из снэпшота)
- ✅ materialize/payout-роуты читают через `getById` (коммит после `23f5c31`).
1. Оставшиеся прямые ЧТЕНИЯ `state.externalEvents` → на стор (`await app.externalEvents.list/count`),
   все в async-контекстах: app.ts 979 (count), 3017/3437/3539/3545/3722/3746 (sync-pipeline);
   accounting-app 1840 (refresh→async), 2910 (reset, уже async), 3731, 4387.
2. ✅ **Узел: запись статуса события — СДЕЛАНО** (отложенная запись). `markExternalEventProcessed`/
   `markExternalEventNeedsAttention` теперь буферят patch (`pendingExternalEventUpdates`) и сразу
   мутируют in-memory; `flushPendingExternalEventUpdates()` применяет через стор (для Postgres).
   Posting-методы (`postSale`/`postReturn`/`recognizeSaleFromFinance`/payout) остались sync — каскада
   на `recordSale` нет. Осталось: `recordChannelFee` (2100 — externalId передать из контроллера, не
   искать по state); вызвать `flushPendingExternalEventUpdates()` в сессии перед commit (см. п.4).
3. `PostgresExternalEventStore` (реализует `ExternalEventStore` + `flush`) поверх `external_event`.
4. Инъекция стора в сессии (`runtime-store` openRead/WriteSession), flush буфера на commit.
5. Исключить `external_event` из snapshot load/save. PG-тесты: события вне снэпшота, write ~50мс.

## Уточнение стратегии (важный вывод из кода)
Домен — **синхронный in-memory движок**: почти каждая коллекция читается ПОСРЕДИ
операций. `auditEvents` вынесся легко только потому, что он чисто append-only
(пишется/отображается, не читается в операциях). Для остальных вынос коллекции в
репозиторий = **сделать async доменные методы, читающие её**. Это не «по чуть-чуть»,
а связный срез на контекст: его нельзя оставлять полуготовым (полу-async = красный build).

Поэтому каждый следующий контекст ведём как **атомарный async-срез** с зелёными
`tsc` + тестами в конце:
- Вводим `*Store`-порт (async) с in-memory реализацией (для тестов, поведение не
  меняется) и Postgres-реализацией (репозиторий, в проде).
- Async-им только методы, читающие эту коллекцию; остальное оставляем синхронным,
  передавая нужные данные внутрь (напр. `recordSale` остаётся sync — externalId
  передаётся из контроллера, а не ищется по `state`).
- Плагины (Ozon/WB) и sync-pipeline получают `await`.
- Исключаем таблицу из snapshot load/save; PG-тесты на репозиторий.

### Срез «externalEvents write-path» (следующий)
Async-граница: `ingestExternalEvent`, `findExternalEventById`,
`findExternalEventByIdentity` (дедуп), `reprocessExternalEvent`, `ignoreExternalEvent`,
часть `resetChannelSalesData`; sync-pipeline (`app.ts` 3288–3744) и материализация.
Sync остаётся: `recordSale` (externalId передаём внутрь). Плагины — `await`.
В конце: `external_event` исключён из snapshot, перф любого write возвращается к ~50мс.

**WIP-ветка `wip/events-write-path`:** доменная async-конверсия уже сделана (методы
`findExternalEventById/Identity`, `ingest`, `reprocess`, `ignore`, `ensureSaleLookup`
→ через `ExternalEventStore`), но НЕ завершена (red, ~36 tsc-ошибок). `main` зелёный;
доделать каскад в один проход на этой ветке:
- `app.ts`: `resolveSaleByPostingNumber` → async (вызовы 3171/3195/3232/3355/3670, все в
  async-функциях материализации/финансов); `findExternalEventById` → `await` (в `for...of`
  на 3668/3683/3692 — просто `await`; на 3375 он внутри `.filter()` — переструктурировать:
  преднагрузить события в `Map` до фильтра, фильтровать sync); `materialize*`/finance-функции
  → async → их роуты `await`.
- Плагины: `await app.ingestExternalEvent(...)` — `ozon.ts` (264/286/811/825), `wildberries.ts` (30).
- Тесты (~32 места): `await` на `ingestExternalEvent`/`findExternalEventById`
  (sales-finance-payout, api-surface, sync-inbox и др.); helper-сидеры тоже async.
- Затем: `PostgresExternalEventStore` (репозиторий + write), инъекция стора в сессию
  (`runtime-store` openRead/WriteSession), исключение `external_event` из snapshot
  load/save (как `auditEvents`, но с upsert+delete через стор), PG-тесты.

## Откуда уходим (текущее состояние)

- `src/core/accounting-app.ts` — 6227 строк, 137 методов: весь домен (проводки,
  AVCO/FIFO, пересчёты, отчёты) поверх одного in-memory объекта `state` (62 коллекции).
- `src/backend/app.ts` — 3775 строк, 250 роутов; бизнес-логика и HTTP вперемешку.
- `src/infra/db/runtime-store.ts` — 1765 строк: на **каждый** запрос грузит весь
  state из всех таблиц (`loadSnapshot`) и сохраняет целиком (`saveState`), под одним
  глобальным advisory-локом. `/api/state` отдаёт весь state в браузер.
- Схема — `schema.sql` + ad-hoc `ALTER`-ы; отдельный `state_json` blob дублирует
  типизированные колонки. Миграций как процесса нет.
- Следствие: латентность ∝ размеру всего state, а не операции (9887 ozon-событий →
  ~4 сек на любой write). Это потолок масштабирования.

## Куда приходим (целевая архитектура)

Классические слои, каждый со своей ответственностью:

- **Controllers** (Hono) — тонкие: валидация (zod), маппинг HTTP↔DTO, вызов сервиса.
  Без бизнес-логики.
- **Services / use-cases** — один сценарий = одна транзакция БД; оркестрируют
  репозитории, держат инварианты (двойная запись, остатки, себестоимость).
- **Repositories** — на агрегат/сущность: типизированный SQL, индексы, пагинация.
  Грузят/пишут только затронутое. Со временем убираем `state_json`.
- **Domain** — сущности + инварианты. Чистую логику (расчёт проводок, AVCO)
  переиспользуем, но она работает над **загруженными агрегатами**, а не над глобальным state.
- **Persistence** — транзакция на запрос (UnitOfWork), построчные блокировки,
  нумерованные миграции. Убираем глобальный advisory-лок, full snapshot и `state_json`.
- **Reports** — SQL-запросы / materialized views, единый источник (убираем дублирование
  логики отчётов клиент/сервер).

## Принципы перехода

1. **Strangler-fig**: мигрируем контекст за контекстом, приложение всё время рабочее.
   `AccountingApp` ужимается до фасада и удаляется последним.
2. **Тесты зелёные на каждом шаге.** Переезд естественно переводит интеграционные
   тесты на Postgres (то, что хотели) — оставляем чистые unit-тесты на доменную математику.
3. **Сначала наименее связанное** (append-only потоки), **в конце — ядро себестоимости** (самое тяжёлое).
4. Каждый контекст: схема/миграция → репозиторий (+тесты на Postgres) → сервис с
   транзакцией → перенос роутов → перенос фронтовых чтений → выпил из снэпшота.

## Контексты и порядок (по 62 коллекциям / 250 роутам)

**Этап 0 — Фундамент (без смены поведения).**
Каркас слоёв (`controllers/`, `services/`, `repositories/`, `domain/`), интерфейс
`Repository` + `UnitOfWork` (транзакция на запрос) рядом с текущим store, харнесс
интеграционных тестов на Postgres, нумерованные миграции. Цель — инфраструктура,
на которую переезжают остальные этапы. Поведение не меняем.

**Этап 1 — Append-only потоки (снимает острую боль).**
`externalEvents`, `observedStocks`, `auditEvents`, `syncRuns`. Выносим из снэпшота в
репозитории с индексами и пагинацией; `/api/state` перестаёт их отдавать; роуты
событий — пагинируемые; фронт (ProductCard, ChannelMapping, Sales, Channels) читает
через ручки. Результат: любой write снова ~50 мс.

**Этап 2 — Мастер-данные / справочники.**
`products`, `productAssets`, `counterparties`, `warehouses`, `cashAccounts`,
`chartAccounts`, `documentTypes`, `expenseCategories`, `salesChannels`,
`integrationPlugins`, `pluginStateRecords`, `users`, `roles`, `agentTokens`,
`channelAgentPermissions`. Простые CRUD-репозитории, мало инвариантов.

**Этап 3 — Деньги и закупки (транзакционно).**
`payments`/`paymentAllocations`/`settlementEntries`, `purchaseOrders`/`...Lines`,
`goodsReceipts`/`...Lines`, `procurementCosts`/`...Lines`, `shortageResolutions`/`...Lines`,
`supplierClaims`, `stockTransfers`/`...Lines`. Сценарии (приёмка, распределение
расходов) — один сервис = одна транзакция.

**Этап 4 — Продажи и финансы канала.**
`sales`/`saleLines`, `salesReturns`, `payouts`/`payoutLines`, `operatingExpenses`,
`ownerTransactions`, `channelFinanceEvents`. Материализация продаж из событий
(этап 1) — здесь как сервис.

**Этап 5 — Ядро регистра + себестоимость (самое тяжёлое, последним).**
`documents`/`documentLines`/`documentVersions`/`documentLinks`,
`journalEntries`/`journalLines`, `inventoryLots`, `stockStates`, `stockMovements`,
`costApplications`, `periods`, `stocktakes`, `correctionCases`, `recalculationJobs`,
`reportSnapshots`, `backfill*`, `periodClosingRuns`. Движок проводок и AVCO/FIFO +
пересчёты сейчас предполагают «весь мир в памяти». Переводим на загрузку ограниченных
агрегатов (партии/движения конкретного товара; проводки конкретного документа), а
replay-пересчёты — на scoped-запросы. Здесь основная доля риска и работы; опираемся на
сценарные тесты (`tests/scenarios`).

**Этап 6 — Отчёты и зачистка.**
`reports()` → SQL/materialized views, без дублирования на клиенте. Удаляем глобальный
state, full snapshot, advisory-лок и `state_json`-колонки. `AccountingApp` удаляется.

## Самые тяжёлые места (честно)

- Консистентность двойной записи: документ + проводки + партии + остатки в одной транзакции.
- AVCO/FIFO + каскадные пересчёты (replay истории) — переписать на ограниченные
  загрузки/запросы вместо прохода по всему state.
- Отчёты — выразить в SQL и убрать дубль клиент/сервер.
- Механический объём: 250 роутов и 137 методов перетащить по слоям.

## Сквозное

- Нумерованные миграции вместо `schema.sql` + ALTER-ов.
- Убрать `state_json`, как только типизированные колонки станут источником истины.
- Снять глобальный advisory-лок — опора на транзакции + построчные блокировки.
- Multi-tenant: `workspace_id`-скоупинг принудительно в репозиториях.

## Тесты

- Интеграционные тесты переезжают на Postgres (per-use-case, через репозитории/транзакции).
- Доменная математика (проводки, AVCO) остаётся быстрыми unit-тестами над чистой логикой.

## Объём и риск

~13.5k строк бэкенда, 250 роутов, 62 сущности, движок на 6.2k строк. Это самое крупное
изменение в кодовой базе — реалистично несколько недель поэтапно. Big-bang —
высокий риск; strangler держит продукт рабочим на каждом шаге. Сейчас пользователей нет —
удачное окно.

## Definition of done

Нет глобального `AccountingApp`-state; нет full snapshot; нет глобального advisory-лока;
нет `state_json`; отчёты — SQL; транзакция на запрос; интеграционные тесты на Postgres зелёные.

## Следующий шаг

Этап 0 (фундамент, без смены поведения) → этап 1 (события). После подтверждения — начинаю с этапа 0.
