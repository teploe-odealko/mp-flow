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
  reprocess/ignore/saleLookup/reset) + весь pipeline/плагины/роуты на `await` — `23f5c31`.
- ✅ **`externalEvents` ВЫНЕСЕН из снэпшота** — Postgres-флип `391225a` + PG-тест: `PostgresExternalEventStore`
  владеет таблицей `external_event`, инжектится в openRead/WriteSession, `flush` на commit,
  `externalEvents` в `SNAPSHOT_APPEND_ONLY` (snapshot не грузит/не сохраняет). PG-тест: событие в таблице,
  `openReadSession().app.state.externalEvents == []`. Перф: не-событийные write больше не грузят 9887 событий.
  Остаток-полиш — 4 edge-чтения (`historicalEventQty`/`resetOutOfScope`/`refreshExternalReferencesForProduct`/
  `saleResetExternalEventIds`): мягко деградируют в Postgres (возвращают пусто, не падают), in-memory тесты ок;
  каждое — небольшой async-каскад (детали ниже в «Остаток»).

### Остаток по `externalEvents` (механический хвост → выпил из снэпшота)
- ✅ materialize/payout-роуты читают через `getById` (коммит после `23f5c31`).
1. Оставшиеся прямые ЧТЕНИЯ `state.externalEvents` → на стор. Сделано: 979/3539/3545/3722/3746/
   channel-count, reset, payout-rollback (через буфер), recordChannelFee externalId. **Осталось 4**
   (в sync edge-методах → малый async-каскад): app.ts `3018` (historical-qty helper),
   `3438` (reset out-of-scope, мутирует статус), accounting-app `1841` (`refreshExternalReferences\
   ForProduct` → async, каскад в `linkExternalProduct`), `3723` (`saleResetExternalEventIds` →
   async, каскад в sale-resync). Мутации-статусы можно через `bufferExternalEventUpdate` (sync),
   но сами выборки событий нужны async.
2. ✅ **Узел: запись статуса события — СДЕЛАНО** (отложенная запись). `markExternalEventProcessed`/
   `markExternalEventNeedsAttention` теперь буферят patch (`pendingExternalEventUpdates`) и сразу
   мутируют in-memory; `flushPendingExternalEventUpdates()` применяет через стор (для Postgres).
   Posting-методы (`postSale`/`postReturn`/`recognizeSaleFromFinance`/payout) остались sync — каскада
   на `recordSale` нет. Осталось: `recordChannelFee` (2100 — externalId передать из контроллера, не
   искать по state); вызвать `flushPendingExternalEventUpdates()` в сессии перед commit (см. п.4).
3. **Postgres-флип (точный рецепт):**
   - `PostgresExternalEventStore implements ExternalEventStore` в `runtime-store.ts` (там entityUuid +
     external_event TableSpec.serialize + hydrateEntity). Чтение: `select state_json ...` (как
     `ExternalEventRepository`). Запись: `upsertRow(client,"external_event",["id"],{...spec.serialize(e),
     workspace_id})`; delete: `delete ... where state_json->>'id' = any($ids)`. Конструктор `(Queryable, workspaceId)`.
   - Инъекция: в `openReadSession` (≈1011) `snapshot.app.externalEvents = new PostgresExternalEventStore(this.pool, scope)`;
     в `openWriteSession` (≈1027) — с `client`. 
   - В `finalize("commit")` (≈1034) ПЕРЕД `saveState`: `await app.flushPendingExternalEventUpdates()`.
   - Добавить `"externalEvents"` в `SNAPSHOT_APPEND_ONLY` → loadSnapshot не грузит, saveState не
     удаляет; upsert-цикл no-op (state.externalEvents пуст). Стор владеет таблицей целиком.
   - PG-тест: после write событие в таблице, но `openReadSession().app.state.externalEvents == []`;
     любой не-событийный write — без загрузки 9887 событий (~50мс).

### ✅ `observedStocks` ВЫНЕСЕН из снэпшота (3-я коллекция)
`ObservedStockStore` порт + in-memory ([observed-stock-store.ts](src/core/observed-stock-store.ts));
`recordObservedStock` через стор (async, await в плагинах/роуте); все endpoint/pipeline-чтения
(reconciliation, ignore, observed-stock list, channel-count, onboarding-seed, sync baseline/telemetry)
на стор; `PostgresObservedStockStore` инжектится в сессии; `observedStocks` в `SNAPSHOT_APPEND_ONLY`.
Остаток-полиш — 2 доменные мутации (`updateChannel` смена sales-point склада; `refreshExternalReferencesForProduct`):
читают пустой state в Postgres (edge; следующий sync перезаписывает остатки и чинит).

### ✅ `syncRuns` ВЫНЕСЕН из снэпшота (4-я коллекция) — Этап 1 (append-only потоки) закрыт
`SyncRunStore` порт + in-memory ([sync-run-store.ts](src/core/sync-run-store.ts)); жизненный цикл
sync в app.ts сохраняется через `store.upsert` (а не `state.push` + `saveState`): create + один upsert
перед общим `return` (покрывает success/fail/catch; ветка validation-throw откатывается транзакцией);
чтения (recent для канала, list-by-channel, detail, cancel) на стор; `PostgresSyncRunStore` в сессиях;
`syncRuns` в `SNAPSHOT_APPEND_ONLY`. Фронт `ChannelSyncPage` снят с `state.syncRuns` →
`useQuery(/api/integrations/channels/:id/sync-runs)`.

**Итог Этапа 1:** тяжёлый event-log (9887 событий, ~14.8 МБ) + остатки + прогоны больше НЕ грузятся
и НЕ диффятся в snapshot на каждый запрос — это и был корень тормозов «создание товара ~4с».
Из snapshot вынесены: `auditEvents`, `externalEvents`, `observedStocks`, `syncRuns`.

**Замер на реальной БД (9887 событий):** создание товара 3.6–3.9с → **0.03–0.09с**; `/api/state` ~4с → **0.11с**;
весь лог событий отдаётся только на странице событий, по запросу (0.3с). Исходная жалоба закрыта.

## Фронт: уход от всесущего `state` (`/api/state` → пер-ресурсные запросы)
Цель «ни на фронте всесущего snapshot» — самостоятельная и не трогает синхронность домена.
- ✅ Инфра: бэк `GET /api/collections/:name` (классический пер-ресурс, тот же public-шейпинг, что `/api/state`,
  404 на неизвестную) + хук `useCollection(name)` ([use-collection.ts](src/frontend/lib/use-collection.ts)),
  React Query кэширует по `["collection", name]`. Замена механическая: `state.X` → `useCollection("X")`.
- ✅ Уже на запросах (dedicated): события (`/api/integrations/events`+`/:id`), остатки (`/api/integrations/observed-stock`),
  аудит (`/api/controls/audit-events`), sync-runs (`/api/integrations/channels/:id/sync-runs`).
- ✅ **ВСЕ страницы переведены** (28 файлов): Products, ProductForm, ChartAccounts, Audit, Accounting/
  Inventory/Procurement-Workspaces, Ledger, Journal, Documents, Settings, ChannelDetail, ChannelsPages (5 комп.),
  FinanceWorkspace, ChannelMapping, ProductCard, Setup, DocumentCard, Money, Expenses, Onboarding, Controls,
  Home, PurchaseOrderCard, Reports, procurement/forms, inventory/forms, Sales. Приём для многокомпонентных
  файлов: `replace_all` `const { state } = useAppState()` → локальный `const state = { X: useCollection("X") }`
  (полный набор файла; React Query дедупит по ключу) — все `state.X` ниже работают без правок. Хелперы,
  берущие весь `state` (getPurchaseOrderMetrics, buildFinanceOperations, buildReconciliationRows, report-билдеры),
  получают собранный partial-state.
- ✅ **God-объект убран целиком:** `AppShell` больше НЕ дёргает `/api/state`; `workingPeriodId` берётся из
  `useCollection("periods")`; `Topbar`/`App` берут organization через `useCollection`; `AppCtx` без `state`.
  Ни одна строка фронта не держит всесущий снимок. Дымовой тест (live): Home/Products/Reports/Procurement/
  Sales/Inventory/Inbox рендерятся, консоль чистая.
- ℹ️ Бэкенд `/api/state` оставлен как есть — его используют ~20 интеграционных тестов (удобное полное чтение);
  это тонкий сериализатор над внутренним снэпшотом, не god-объект на проводе для UI. Уберётся вместе с
  ядром-снэпшотом (ниже).

## Бэкенд-ядро (оставшийся snapshot) — самое трудоёмкое
Домен (`AccountingApp`, синхронный) глубоко впаян: `documents` 70 чтений, `journalEntries` 26, `sales` 24,
`stockMovements` 15 и т.д., и всё связано через `documents`/`journalEntries`. Дешёвых пер-коллекционных флипов
больше НЕТ: проверено, что даже мелкий `recalculationJobs` пишется из глубины постинга (`queueRecalculation`
зовётся из `receiveGoods`/`applyProcurementCostCorrection`/reports). Любая оставшаяся коллекция читается/
пишется посреди синхронных операций.

**Вывод:** вынести ядро = сделать `AccountingApp` async по всему графу операций. async вирусен — это не
держится «зелёным» пошагово, значит делается одним крупным заходом со сборкой в конце (разрешено «можно ломать»).

### Прогресс конверсии ядра (идёт)
- ✅ Шаг 1: async-фасад `Repositories` ([repositories.ts](src/core/repositories.ts)) + `buildInMemoryRepositories`,
  инжектнут как `this.repos`, бэкается массивами `this.state` (поведение идентично, тесты зелёные).
- ✅ Переведено методов: **17/137** — `retryRecalculationJob`, `accountByIdOrCode`, `journalEntryDetails`,
  `stockForSalesPoint`, `stockByProduct`, `productDetails`, `setProductImage`, `deleteProductImage`,
  `updateProduct`, `archiveProduct`, `restoreProduct` (+ozon `ensureInternalProduct` async-каскад),
  `createCashAccount`, `updateCashAccount`, `receiptDetails`, `procurementCostDetails`, `shortageDetails`,
  `transferDetails` (+ их вызовы в app.ts/плагинах на `await`; floating-promise в `c.json({data})` tsc НЕ ловит
  — каждый caller проверять grep'ом).
- 📉 Остаток `this.state.` в домене: **586** (метрика прогресса; цель — 0).
- ⏳ Осталось ~120 методов. Порядок: листовые чтения/CRUD → постинг → AVCO/recalculate.
  Каждый: `async` + `this.state.X` → `await this.repos.X.all()`/`.add`/`.upsert`/`.removeWhere`; `mustFind(this.state.X,…)`
  → `mustFind(await this.repos.X.all(),…)`; после мутации на месте — `await this.repos.X.upsert(entity)`; callers `await`.
  Общие sync-хелперы (`mustFind`, `ledgerBalances`, `audit`, `createDocument`/`postJournalEntry` пока) читают
  `this.state` напрямую — валидно в in-memory фазе; конвертируются в свою очередь (каскад вверх).

### План исполнения ядра (для отдельного захода, с чистым контекстом)
1. Завести `Repositories`-фасад (как уже сделанные сторы) для оставшихся коллекций: `documents`, `documentLines`,
   `documentVersions`, `documentLinks`, `journalEntries`, `journalLines`, `sales`, `saleLines`, `salesReturns`,
   `stockMovements`, `stockStates`, `inventoryLots`, `costApplications`, `payments`, `paymentAllocations`,
   `payouts`, `payoutLines`, `settlementEntries`, `channelFinanceEvents`, `purchaseOrders`, `purchaseOrderLines`,
   `goodsReceipts`, `goodsReceiptLines`, `procurementCosts`, `procurementCostLines`, `shortageResolutions(+Lines)`,
   `stockTransfers(+Lines)`, `stocktakes(+Lines)`, `recalculationJobs`, `correctionCases` + справочники
   (`products`, `warehouses`, `salesChannels`, `counterparties`, `chartAccounts`, `cashAccounts`, `periods`,
   `externalProducts`, `productExternalLinks`, `integrationPlugins`, `productAssets`, `expenseCategories`,
   `operatingExpenses`, `ownerTransactions`, `documentTypes`, `accountingPolicy`, `organization`, `agentTokens`,
   `backfillProjects`, `users`).
2. `AccountingApp`: каждый `this.state.X` → `await this.repos.X...`; каждый доменный метод → `async`.
   Порядок — снизу вверх по графу: листовые helpers → постинг-методы (createSale/receiveGoods/postPayment/
   deleteDocument/recalculate*/AVCO) → публичные команды.
3. `app.ts`: все вызовы доменных методов → `await` (большинство handler'ов уже `async`).
4. runtime-store: убрать `loadSnapshot`/`saveState` полностью; `openWrite/ReadSession` отдаёт `AccountingApp`
   с Postgres-репозиториями на `client`/`pool`; снять глобальный `pg_advisory_xact_lock` (транзакция на запрос
   заменяет full-state-write-lock). Удалить `state_json`-снэпшот, `publicAccountingState`, `/api/state`.
5. Отчёты (`/api/reports*`) — в SQL (агрегаты), а не перебор state.
6. Стыковка: `tsc` 0 → fast → PG → smoke (browser). Тесты, дергающие `/api/state`, перевести на `/api/collections`.

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
