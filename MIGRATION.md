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
     external_event TableSpec.serialize + hydrateEntity). Lookup: typed/public columns
     (`public_id`, `channel_id`, `external_id`, `idempotency_key`); `state_json` пока только hydrate payload.
     Запись: `upsertRow(client,"external_event",["id"],{...spec.serialize(e), workspace_id, public_id})`;
     delete: `delete ... where public_id = any($ids)`. Конструктор `(Queryable, workspaceId)`.
   - Инъекция: в `openReadSession` (≈1011) `snapshot.app.externalEvents = new PostgresExternalEventStore(this.pool, scope)`;
     в `openWriteSession` (≈1027) — с `client`. 
   - В `finalize("commit")` — перед commit: `await app.flushPendingExternalEventUpdates()`.
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
- ✅ Бэкенд `/api/state` удалён. Тесты переведены на чтение через `/api/collections/:name`, поэтому полного
  публичного снимка состояния больше нет ни во фронте, ни в API-контракте.
- ✅ Часть GET-ручек уже обслуживается read-model путём до snapshot-сессии: collections, dashboard, reports,
  stream-чтения (sync-runs/observed-stock/audit), legacy-списки, channel detail и detail-чтения account/journal/product.
- ⚠️ Это промежуточный слой: Postgres read-model сейчас читает те же таблицы `state_json` по коллекциям. Он убирает
  большой API-snapshot и лишние read-session загрузки, но не заменяет финальный переход на нормализованные таблицы.

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
- ✅ Переведено методов: **20/137** (все «чистые листья» — чтения/preview/справочный CRUD без индексов и
  широкого каскада): `retryRecalculationJob`, `accountByIdOrCode`, `journalEntryDetails`, `stockForSalesPoint`,
  `stockByProduct`, `productDetails`, `setProductImage`, `deleteProductImage`, `updateProduct`, `archiveProduct`,
  `restoreProduct` (+ozon `ensureInternalProduct` async-каскад), `createCashAccount`, `updateCashAccount`,
  `receiptDetails`, `procurementCostDetails`, `shortageDetails`, `transferDetails`, `saleRollbackPreview`,
  `stockTransferRollbackPreview`, `shortagePreview` (+ вызовы в app.ts/плагинах/тестах на `await`; floating-promise
  в `c.json({data})` tsc НЕ ловит — каждый caller через grep).
- 📉 Остаток `this.state.` в домене: **565** (метрика прогресса; цель — 0).
- ⛳ Граница: дальше идёт **энтэнглд-ядро** — постинг (`createDocument`/`postJournalEntry`/`createSale`/`receiveGoods`/
  `postPayment`), AVCO/`consumeFifo`/`recalculate*`, и методы с индексами/кэшами (`ensureExternalProductIndex`,
  `ensureActiveLinkIndex`, `refreshExternalReferencesForProduct`). Их нельзя конвертировать листом — общие
  sync-хелперы (createDocument/postJournalEntry/consumeFifo/addStockState) зовутся отовсюду, поэтому их перевод
  в async каскадит широко. Делать кластером, целыми методами, с прогоном fast+PG после каждого; индексы (`Map`)
  при Postgres-свапе заменяются на запросы. Порядок: общие хелперы постинга → команды постинга → AVCO/recalculate.
- ⏳ Осталось ~117 методов.
  Каждый: `async` + `this.state.X` → `await this.repos.X.all()`/`.add`/`.upsert`/`.removeWhere`; `mustFind(this.state.X,…)`
  → `mustFind(await this.repos.X.all(),…)`; после мутации на месте — `await this.repos.X.upsert(entity)`; callers `await`.
  Общие sync-хелперы (`mustFind`, `ledgerBalances`, `audit`, `createDocument`/`postJournalEntry` пока) читают
  `this.state` напрямую — валидно в in-memory фазе; конвертируются в свою очередь (каскад вверх).

### ✅ ЭНТЭНГЛД-ЯДРО ПОСТИНГА переведено на async-репозитории (tsc 0, fast 72, PG 9)
`createDocument`/`createPayment`/`postDocument` + все команды постинга (`createSale`/`receiveGoods`/
`postPayment`/`recordReturn`/`postChannelFinanceEvent`/`postChannelPayout`/`recordOperatingExpense`/
`applyDocumentCorrection`/`recordSale`/`postSale`/…) + AVCO/recalc + ~89 реассайнов `state.X=…filter()`
→ `repos.X.replaceAll` (мутация на месте, ссылка цела) + delete-for-resync. app.ts-хендлеры (55 floating-
promise в `c.json` починены) + пайплайн (`materializeSale/Payout/Return`) + тесты на `await`; sync test-
коллбэки → async; async-throw → `rejects.toThrow`. **Двойная запись/AVCO/удаления корректны (тесты зелёные).**
Остаток `this.state.` в домене: **6** (было 565; факт после среза `app.ts`/plugins/finance/backfill/corrections);
из них часть — синглтоны/metadata (`organization`, `accountingPolicy`, `documentTypes`) и временные in-memory
stores (`externalEvents`/`observedStocks`/`syncRuns`) в конструкторе. Переведены reporting
(`reports`/`ledgerBalances`), `dashboard`, backend helper-layer в `app.ts` (прямого `app.state` больше нет),
backfill/materialization/sync helpers, marketplace plugins, `saveChannelCredentials`, finance-link методы,
`previewGoodsReceipt`, `postPurchaseOrder`, payment posting lookup'и, rollback/delete helpers,
procurement/receipt correction paths, procurement posting (`updatePurchaseOrderDraft`/`postGoodsReceipt`/
`postProcurementCost`/`postShortage`/`postStockTransfer`), document links, stock/receipt/shortage helpers,
async `previewProcurementCost`, setup metadata fields, `audit`/`createCorrectionCase`/`queueRecalculation`,
`nextDocumentNumber`, `periodForDate`/`assertAccountingDateAllowed` и `documentDescendants`/`previewCorrection`.
Оставшиеся state-точки на конверсию: compatibility write в bootstrap (`app.state.organization`/
`app.state.accountingPolicy`), `bufferExternalEventUpdate` и in-memory store wiring в конструкторе.
Синглтоны `organization`/`accountingPolicy` уже изолированы как поля приложения; `app.state` пока остаётся
только для совместимости runtime-store/tests до финального удаления snapshot.

### ✅ REQUEST-TIME SNAPSHOT STORE снят с сессий runtime
`PostgresRuntimeStore.openReadSession/openWriteSession` теперь открывают `AccountingApp` сразу с
Postgres repositories (`openPostgresReadModelApp`) и не вызывают `loadSnapshot/saveState`. Удалён
глобальный `WRITE_LOCK_SQL`: write-session держит обычную транзакцию, а доменные коллекции пишутся
через repositories во время операции; commit сохраняет только singleton metadata, credentials/secrets
и id meta. Legacy snapshot/entity-store остаётся только одноразовым importer'ом при миграции старой БД.

### ✅ Public lookup layer для отказа от JSON-expression ключей
Добавлен `public_id` во все runtime-таблицы с backfill из legacy `state_json` (`id`/`code`, для `stock_state`
композит `productId:warehouseId`) и индексом `(workspace_id, public_id)`. `getById`/`removeById`,
credentials join, `ExternalEventRepository`, `AuditEventRepository`, `PostgresExternalEventStore`,
`PostgresObservedStockStore`, `PostgresSyncRunStore` и PG-тесты больше не ищут сущности через
`state_json->>'id'`/`channelId`/`entityId`; lookup идёт по `public_id` и typed FK-колонкам.
Для событий добавлены typed columns `idempotency_key`, `sync_run_id`, `external_product_id`, `product_id`,
`reason`; дедупликация событий теперь не требует JSON-expression. В bootstrap добавлен `repos.saveSingletons`
для `organization/accountingPolicy`, чтобы FK-зависимые коллекции писались в Postgres без временного snapshot.
Оставшийся большой слой: `state_json` всё ещё является payload-колонкой для generic repository hydrate/serialize
и backfill-источником в миграциях. Следующий этап — typed hydrators/serializers, после чего `state_json`
можно удалить из схемы и read-model.

### ✅ Typed hydrate для stream/audit таблиц
`ExternalEventRepository`, `AuditEventRepository`, `PostgresExternalEventStore`, `PostgresObservedStockStore`
и `PostgresSyncRunStore` больше не делают `select state_json`: чтение строится из typed columns и `public_id`
joins через `runtime-hydrators.ts`. Для полноты модели добавлены колонки `external_event.created_at/updated_at/
last_error`, `audit_event.entity_public_id`, а также `sync_run.mode/streams/errors/since/summary/stream_runs/
last_error`. PG-тесты проверяют этот путь на реальной схеме. Следующий остаток — generic collection repo:
`readRuntimeCollection` и `PostgresRuntimeCollectionRepo` всё ещё hydrate'ят остальные коллекции из `state_json`.

### ✅ Typed hydrate для singleton reference state
`readRuntimeSingleton` больше не читает `organization/accountingPolicy` из `state_json`: hydrate идёт из
typed columns и `public_id` join для `organizationId`. Добавлены/заполняются `organization.inn/updated_at`
и `accounting_policy.allow_open_period_edits/comment`; `saveRuntimeSingleton` пишет эти колонки при bootstrap/commit.
Остаток singleton `state_json` — только legacy payload/backfill до финального удаления колонки.

### ✅ Typed specs подключены к generic collection repo для stream/audit
`TableSpec` получил optional `select/joins/hydrate`, поэтому `readRuntimeCollection` и
`PostgresRuntimeCollectionRepo` для `auditEvents`, `externalEvents`, `observedStocks`, `syncRuns`
тоже читают typed rows, а не payload. Для этих таблиц и для singletons запись нового `state_json`
остановлена; колонка остаётся только как legacy/backfill совместимость. Текущий остаток
`state_json: entity` в runtime-store — 57 таблиц.

### ✅ Typed hydrate для базовых справочников
На typed specs переведены `periods`, `chartAccounts`, `documentTypes`, `counterparties`, `products`,
`warehouses`, `cashAccounts`, `integrationPlugins`: generic collection repo читает их через typed columns
и `public_id` joins, запись нового `state_json` остановлена. Текущий остаток `state_json: entity` —
49 таблиц.

### ✅ Typed hydrate для документов и проводок
На typed specs переведены `documents`, `documentLines`, `documentVersions`, `documentLinks`,
`journalEntries`, `journalLines`: ссылки (`documentId`, `organizationId`, reversal/correction links)
восстанавливаются через `public_id` joins, суммы и даты — из typed columns. Текущий остаток
`state_json: entity` — 43 таблицы.

### ✅ Typed hydrate для платежей и взаиморасчётов
На typed specs переведены `payments`, `paymentAllocations`, `settlementEntries`: cash/account/document/
counterparty/channel/order references восстанавливаются через `public_id` joins. Текущий остаток
`state_json: entity` — 40 таблиц.

### ✅ Typed hydrate для procurement/receipt/shortage
На typed specs переведены `purchaseOrders`, `purchaseOrderLines`, `goodsReceipts`, `goodsReceiptLines`,
`procurementCosts`, `procurementCostLines`, `shortageResolutions`, `shortageResolutionLines`, `supplierClaims`.
Добавлена typed колонка `procurement_cost.pending_allocation` с backfill. Текущий остаток `state_json: entity` —
31 таблица.

### ✅ Typed hydrate для сервисных и админских таблиц
На typed specs переведены `expenseCategories`, `correctionCases`, `recalculationJobs`, `reportSnapshots`,
`backfillProjects`, `backfillItems`, `roles`: generic collection repo читает их через typed columns и
`public_id` joins, запись нового `state_json` остановлена. Текущий остаток `state_json: entity` —
24 таблицы.

### ✅ Typed hydrate для простых служебных хвостов
На typed specs переведены `pluginStateRecords`, `ownerTransactions`, `stocktakes`, `stocktakeLines`,
`channelAgentPermissions`. Для них схема уже покрывала доменную модель, поэтому миграция ограничилась
typed read/write без `state_json`. Текущий остаток `state_json: entity` — 19 таблиц.

### ✅ Typed hydrate для marketplace mapping
На typed specs переведены `salesChannels`, `externalProducts`, `productExternalLinks`. Для `sales_channel`
добавлены typed колонки `enabled_streams`, `last_checked_at`, `last_error`, `last_sync_at` с backfill из
legacy `state_json`. Текущий остаток `state_json: entity` — 16 таблиц.

### ✅ Typed hydrate для пользователей и агентских токенов
На typed specs переведены `users` и `agentTokens`. Для `user_account` добавлены `role_code`, `invited_at`,
`last_active_at`; для `agent_token` — `mode`, `masked_token`, `token_hash`, `created_at`, `last_used_at`,
`revoked_at` с backfill из legacy `state_json`. Текущий остаток `state_json: entity` — 14 таблиц.

### ✅ Typed hydrate для медиа фотостудии
На typed specs переведены `productAssets`. Для `product_asset` добавлены `mime_type`, `width`, `height`,
`created_by`, `updated_at`, `meta` с backfill из legacy `state_json`. Текущий остаток `state_json: entity` —
13 таблиц.

### ✅ Typed hydrate для операционных расходов
На typed specs переведены `operatingExpenses`. Для `operating_expense` добавлены `counterparty_id`,
`amount_paid_rub`, `payment_mode`, `payment_status`, `cash_account_id`; FK backfill выполняется после
`public_id` backfill. Текущий остаток `state_json: entity` — 12 таблиц.

### ✅ Typed hydrate для продаж и выплат
На typed specs переведены `sales`, `saleLines`, `salesReturns`, `channelFinanceEvents`, `payouts`,
`payoutLines`. Добавлены typed optional поля признания выручки, marketplace finance metadata, payout
composition и polymorphic payout line source. `payout.payment_id` стал nullable, как в доменной модели.
FK backfill выполняется после `public_id` backfill. Текущий остаток `state_json: entity` — 6 таблиц.

### ✅ Typed hydrate для stock/cost core
На typed specs переведены `stockStates`, `inventoryLots`, `stockMovements`, `costApplications`,
`stockTransfers`, `stockTransferLines`. `stock_state` расширен до ключа `(product_id, warehouse_id,
state_code)`, а `public_id` теперь `productId:warehouseId:stateCode`. Для polymorphic line ids добавлены
text public-id колонки. Текущий остаток `state_json: entity` — 0 таблиц; `state_json` остался только в
legacy/backfill SQL до финальной зачистки колонок.

### 🛑 Скрипт для хелпер-слоя исчерпан (проверено ТРИЖДЫ, каждый раз откат к зелёному)
Массовый async-ify хелперов всегда даёт неустранимый скриптом каскад: `forEach(x => { await this.createLot/
addStockState/consumeFifo(...) })` и `.map(x => await this.findRollbackDocumentSummary(x))` — хелперы каскадно
становятся async вопреки keep-листу (т.к. зовут другие async). Эти места требуют **ручного** `forEach→for-of`
(с `return→continue`) и `.map→Promise.all`. Скрипт оставляю ТОЛЬКО для statement-level чтений в уже-async методах.
**Остаток хелпер-слоя (335 рефов) добивается строго вручную, пер-методно** (как уже сделанные ~18 методов).

### ⚠️ Алгоритм для остатка — слепой скрипт НЕ работает (проверено дважды)
Массовый async-ify+await-insert упирается во **вложенные колбэки**. Правила:
1. **Колбэк-хелперы остаются sync** (читают `this.state` in-memory): `findRollbackDocumentSummary`,
   `isDocumentPosted`, `isPaymentAllocationPosted` — вызываются внутри `.map/.filter/.some`. Их НЕ async-ить.
2. `.map((x) => await this.H(x))` → `(await Promise.all(arr.map((x) => this.H(x)))).filter(...)` — пер-сайтово.
3. `forEach((x) => { … await … })` → `for (const x of arr) { … }` ТОЛЬКО если в теле нет `return`
   (иначе семантика ломается) — иначе precompute массива перед forEach.
4. Данные-чтения `(await this.repos.X.all())`, попавшие во вложенный колбэк → откатить на `this.state.X`
   (валидно в in-memory фазе; добить на Postgres-свапе).
5. Идти **пер-методно, ≤10 методов/батч**, после каждого — tsc + fast + PG; коммит только зелёным.
   Скрипт допустим только для statement-level чтений в уже-async методах (как сделанные 75+101).

### 🧭 Развилка фундаментального слоя (остаток ~321 рефов) — нужна архитектурная, не механическая
Лёгкие изолированные методы исчерпаны (переведено ~24 + всё ядро постинга). Остаток — фундамент,
который НЕ конвертируется быстро/безопасно:
1. **Пронизывающие tiny-хелперы**: `currentOrgId`, `mustFind`, `ownWarehouse`, `periodForDate`,
   `documentTypeDisplayName`, `findActiveLink`, `isDocumentPosted`, `stockState`, `findRollbackDocumentSummary`.
   Зовутся из десятков sync- И async-контекстов (вкл. sync-колбэки). async → каскад на всё + Promise.all везде.
2. **Фундаментальные creates**: `createProduct`/`createCounterparty`/`createWarehouse`/`createChartAccount` —
   по 1 рефу (push), но ~100 sync-вызовов в тестах/bootstrap/seed → большой (механический) каскад await.
3. **Write-хелперы в колбэках**: `consumeFifo`/`createLot`/`addStockState`/`appendJournalEntry` —
   зовутся в `forEach/for-of` посреди постинга → for-of + ручной await.
4. **Синглтоны** `organization`/`accountingPolicy` (~16 рефов) — не массивы.

**Рекомендуемое решение (для свежего контекста):** bounded **reference-cache** — справочные/мелкие коллекции
(warehouses, periods, documentTypes, chartAccounts, cashAccounts, organization, accountingPolicy) грузятся раз
на запрос в маленький sync-доступный объект; tiny-хелперы читают его (остаются sync). Это НЕ «тяжёлый снэпшот»
(growing-транзакционные коллекции уже на async-repos), а bounded reference-config. Тогда:
- tiny-хелперы и creates справочников остаются sync поверх reference-cache;
- транзакционные данные — через async-repos (Postgres);
- `state`(транзакционный)/`loadSnapshot`/`saveState`/глобальный лок сносятся; остаётся лишь загрузка reference-cache.
Альтернатива — тотальный async + Promise.all во всех колбэках (больше кода, выше риск).
**РЕШЕНИЕ ПРИНЯТО: reference-cache** (прагматично, ниже риск, не «всесущий snapshot» — bounded reference-config).
Исполняю им: tiny-хелперы и creates справочников остаются sync поверх reference-cache; транзакционное ядро уже async.

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
   заменяет full-state-write-lock). Удалить остатки `state_json`-снэпшота.
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
