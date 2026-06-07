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
     external_event typed `TableSpec.serialize` + typed hydrator). Lookup: typed/public columns
     (`public_id`, `channel_id`, `external_id`, `idempotency_key`); `state_json` не участвует в runtime read/write.
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
Полиш по публичным API закрыт: `channel-service.updateSalesChannel` и
`external-product-service.refreshExternalReferencesForProduct` обновляют остатки через typed store,
а не через пустой state в Postgres-сессии.

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
- ✅ Старый переходный слой: бэк `GET /api/collections/:name` (классический пер-ресурс, тот же public-шейпинг,
  что `/api/state`, 404 на неизвестную) + хук `useCollection(name)` дали механический срез
  `state.X` → `useCollection("X")`. После финального фронтового среза hook удалён, а public
  `/api/collections/*` route больше не публикуется; тестовый helper собирает нужные данные через dedicated
  resource/workspace endpoints.
- ✅ Уже на запросах (dedicated): события (`/api/integrations/events`+`/:id`), остатки (`/api/integrations/observed-stock`),
  аудит (`/api/controls/audit-events`), sync-runs (`/api/integrations/channels/:id/sync-runs`).
- ✅ Старый промежуточный этап: все страницы были сняты с `/api/state` и переведены на `useCollection(...)`.
  Это уже убрало всесущий публичный snapshot, но **не является финальным REST-критерием**: `useCollection`
  остаётся generic collection API, а не понятным ресурсным контрактом.
- ✅ **God-объект убран целиком:** `AppShell` больше НЕ дёргает `/api/state`; `workingPeriodId`,
  organization и остальной shell-контекст берутся из dedicated DTO. `AppCtx` без `state`.
  Ни одна строка фронта не держит всесущий снимок и не вызывает `/api/collections/*`.
- ✅ Бэкенд `/api/state` и public `/api/collections/:name` удалены. Полного публичного снимка состояния
  больше нет ни во фронте, ни в API-контракте.
- ✅ Часть GET-ручек уже обслуживается read-model путём до snapshot-сессии: collections, dashboard, reports,
  stream-чтения (sync-runs/observed-stock/audit), legacy-списки, channel detail и detail-чтения account/journal/product.
- ⚠️ Это промежуточный слой: Postgres read-model сейчас читает те же таблицы `state_json` по коллекциям. Он убирает
  большой API-snapshot и лишние read-session загрузки, но не заменяет финальный переход на нормализованные таблицы.
- ✅ Product area двигается от generic collections к dedicated DTO:
  `ProductCardPage` → `/api/products/:id/workspace`, `ProductsPage` → `/api/products/workspace`,
  `ProductFormPage` → `/api/products/:id`, `ChannelMappingPage` → `/api/products/channel-mapping`.
  Эти страницы больше не используют `useCollection` и не вызывают `/api/collections/*` на фронте.
- ✅ Accounting pages двигаются от generic collections к dedicated DTO:
  `AccountingWorkspace`/`LedgerPage`/`JournalPage`/`JournalEntryPage` →
  `/api/accounting/journal/workspace`, `ChartAccountsPage` → `/api/accounting/accounts/workspace`.
  Весь `src/frontend/pages/accounting` больше не использует `useCollection`.
- ✅ Setup/settings/access/controls сняты с generic collections:
  `SetupPage`/`SettingsOverviewPage` → `/api/setup`, `AuditPage` → `/api/controls/audit-events`
  без чтения `users`, `ControlsWorkspace` → `/api/controls/workspace`.
  В `src/frontend/pages/setup`, `src/frontend/pages/access`, `src/frontend/pages/controls` больше нет
  `useCollection` и глобального `queryClient.invalidateQueries()`.
- ✅ Documents pages сняты с generic collections:
  `DocumentsPage` → `/api/documents/workspace` с серверными агрегатами `entryCount`/
  `journalLineCount`/`linkCount`, `DocumentCardPage` → `/api/documents/:id` с карточечным payload.
  В `src/frontend/pages/documents` больше нет `useCollection` и глобального `queryClient.invalidateQueries()`.
- ✅ Onboarding existing-store снят с generic collections:
  `BackfillWizardPage` → `/api/onboarding/existing-store/workspace` + точечные project endpoints.
  В `src/frontend/pages/onboarding` больше нет `useCollection` и глобального `queryClient.invalidateQueries()`.
- ✅ Expenses pages сняты с generic collections:
  `ExpensesWorkspace` → `/api/finance/expenses/workspace`, `ExpenseFormPage` →
  `/api/finance/expenses/form-workspace`, `ExpenseCardPage` → `/api/finance/expenses/:id`.
  В `src/frontend/pages/expenses` больше нет `useCollection` и глобального `queryClient.invalidateQueries()`.
- ✅ Finance/Money workspace снят с generic collections:
  `MoneyWorkspace`/`FinanceWorkspace` → `/api/finance/workspace`.
  Главный экран денег больше не собирает 14 `useCollection(...)`; на время перехода остаётся точечная
  инвалидизация старых collection-ключей для ещё не мигрированных смежных страниц.
- ✅ Money forms/payout pages сняты с generic collections:
  `OwnerContributionFormPage`/`OwnerWithdrawalFormPage` → `/api/money/owner-form-workspace`,
  `PayoutFormPage` → `/api/finance/payouts/form-workspace`, `PayoutsPage` →
  `/api/finance/payouts/workspace`, `PayoutReconciliationPage` →
  `/api/finance/payouts/:id/workspace`.
  В `src/frontend/pages/money` больше нет `useCollection` и глобального `queryClient.invalidateQueries()`.
- ✅ Inventory workspace снят с generic collections:
  `InventoryWorkspace` → `/api/inventory/workspace` с явным складским payload
  (`stockStates`, `products`, `warehouses`, `documents`, `stockMovements`).
  Главный экран склада больше не собирает состояние из пяти `useCollection(...)`.
- ✅ Procurement workspace снят с generic collections:
  `ProcurementWorkspace` → `/api/procurement/workspace` с явным payload по заказам,
  строкам, поставщикам, документам, оплатам, приемкам, расходам поставки и закрытию недопоставок.
  Главный экран поставок больше не собирает состояние из 11 `useCollection(...)`.
- ✅ Карточка заказа поставщику снята с generic collections:
  `PurchaseOrderCardPage` → `/api/procurement/purchase-orders/:id/workspace` с явным payload только по
  конкретному заказу: строки, поставщик, склад, документы, платежи, приемки, расходы, партии,
  проводки и решения по недопоставкам. После мутаций карточка инвалидирует свой workspace и
  затронутые соседние workspaces, без глобального `queryClient.invalidateQueries()`.
- ✅ Формы поставок сняты с generic collections:
  `procurement/forms` → `/api/procurement/forms/workspace` с контекстом создания/редактирования заказа,
  оплаты поставщику, приемки, доп. расхода и разбора недопоставки. Endpoint умеет возвращать общий
  контекст активных заказов или scoped-контекст одного `purchaseOrderId`; формы больше не используют
  `useCollection` и не делают глобального `queryClient.invalidateQueries()`.
- ✅ `ReceiptDispatchPage` убрал последний широкий `queryClient.invalidateQueries()` в сценарии отправки
  приемки в канал: после commit инвалидируются только scoped receipt-dispatch keys и затронутые
  соседние workspaces (`procurement`, `inventory`, `documents`, `accounting-journal`, `dashboard`,
  конкретная карточка документа).
- ✅ Channels pages сняты с generic collections:
  `ChannelsWorkspace` → `/api/channels/workspace`, `ChannelDetailPage`/`ChannelSyncPage` →
  `/api/integrations/channels/:id`, `SyncInboxPage` → `/api/integrations/inbox/workspace`,
  `ChannelFinancePage` → `/api/integrations/channels/:id/finance/workspace`,
  `FinanceEventCardPage` → `/api/integrations/finance-events/:id/workspace`.
  В `src/frontend/pages/channels` больше нет `useCollection` и глобального `queryClient.invalidateQueries()`;
  мутации инвалидируют scoped channel/workspace keys и временно старые collection-ключи для совместимости.
- ✅ Sales pages сняты с generic collections:
  `SalesWorkspace`, карточка продажи, возвраты и ручная продажа читают `/api/sales/workspace`.
  В `src/frontend/pages/sales` больше нет `useCollection` и глобального `queryClient.invalidateQueries()`.
- ✅ Inventory forms сняты с generic collections:
  формы ввода начальных остатков, движения, перемещения, сверки и корректировки читают
  `/api/inventory/forms/workspace`. В `src/frontend/pages/inventory/forms.tsx` больше нет `useCollection`
  и глобального `queryClient.invalidateQueries()`.
- ✅ Фронтовый transitional hook `useCollection` удалён. `src/frontend` больше не вызывает `/api/collections/*`;
  public `/api/collections/:name` тоже удалён. Legacy list endpoints (`/api/products`, `/api/documents`
  и т.п.) теперь читают явные `readModelApp.repos.*`, без внутреннего `collectionFor` helper в HTTP-слое.
  Это ещё не финальная раскладка controllers/services, но публичный API больше не шейпится generic collection helper'ом.
- ✅ Legacy read-list endpoints сняты с `AccountingApp` в Postgres path:
  добавлен `RuntimeReadContext` (`repos + typed stores + setupMetadata`) и `PostgresRuntimeStore.openReadContext`.
  `/api/setup`, `/api/products`, `/api/documents`, `/api/accounting/journal`, `/api/returns`, `/api/finance/payouts`
  и похожие простые read-list ручки читают репозитории/typed stores без создания доменного app facade.
  In-memory fallback остаётся только для тестового контура. Следующий backend-долг — detail/workspace read paths
  и write use-cases, где всё ещё нужен `AccountingApp`.
- ✅ Большой helper-layer DTO-readers переведён на `RuntimeReadContext`: product/inventory/procurement/sales/channel/
  accounting/controls/onboarding workspace payloads, document drilldown/history/links/descendants, sales/return/payout/
  finance-event details, finance/expense/payout workspaces, MCP settings и простые filtered endpoints больше
  не открывают `openReadModelApp` в Postgres path.
- ✅ Detail/card GET-ручки сняты с `readModelAppFor` в Postgres path: account/journal/product details,
  product lots/stock movements/card/brief, procurement purchase-order/receipt/cost/shortage details,
  transfer detail, sales-point stock и channel detail теперь собираются через `RuntimeReadContext`
  (`repos + typed stores + channelCredentialStatus`). `readModelAppFor` в Postgres runtime теперь
  намеренно падает, а prod-readiness фиксирует, что dashboard/workspace reads не открывают read session.
  Оставшиеся `readModelAppFor` в HTTP-слое — только in-memory/test fallback для старого app facade,
  reports/dashboard/ledger fallback без БД.
- ✅ Production persistence-контракт больше не публикует `openReadModelApp`: `PostgresRuntimeStore`
  не умеет отдавать read-model `AccountingApp` наружу. Внутренний factory переименован в
  `openPostgresRepositoryBackedApp` и используется только для repository-backed `openReadSession`/
  `openWriteSession`, то есть для write/control use-cases до финального удаления `AccountingApp`.
  HTTP `readModelAppFor` теперь только локальный in-memory fallback без БД.
- ✅ `PostgresRuntimeStore.loadApp()` удалён: runtime больше не имеет публичного метода, который
  материализует целый `AccountingApp` из Postgres. Единственный оставшийся app-facade путь —
  явные request sessions (`openReadSession/openWriteSession`) для пока не перенесённых write/control
  use-cases.
- ✅ MCP key authentication снят с `AccountingApp` sessions: `RuntimePersistence.authenticateAgentToken`
  проверяет `agent_token` и обновляет `last_used_at` прямым Postgres-путём. `/mcp` больше не открывает
  `openReadSession/openWriteSession` только ради проверки ключа; prod-readiness покрывает это регрессом.
- ✅ Ещё три GET сняты с request session: `/api/meta/navigation` зарегистрирован до session middleware,
  а `/api/procurement/receipts/:id/channel-dispatch/state` читает `plugin_state_record` через
  `RuntimeReadContext`, без `AccountingApp` и `createPluginStateApi`. `/api/procurement/receipts/:id/dispatch-context`
  тоже собирает read DTO через `RuntimeReadContext`, включая строки приемки, доступный остаток,
  уже отгруженное количество, связки external offer и plugin meta. Prod-readiness держит
  `readSessions = 0` на этих read paths.
- ✅ Rollback/shortage previews вынесены в backend service поверх `RuntimeReadContext`
  (`src/backend/services/rollback-preview-service.ts`) и зарегистрированы до session middleware:
  `/api/procurement/receipts/:id/delete-preview`, `/api/procurement/costs/:id/delete-preview`,
  `/api/procurement/purchase-orders/:id/shortages/preview`, `/api/payments/:id/delete-preview`,
  `/api/inventory/transfers/:id/delete-preview`, `/api/sales/:id/delete-preview`. Эти контроллеры
  теперь идут по схеме `controller → service → repositories`, не открывают `AccountingApp` read session
  и покрыты prod-readiness проверкой `readSessions = 0`.
- ✅ Receipt preview тоже снят с session middleware: GET/POST
  `/api/procurement/purchase-orders/:id/receipt-preview` обслуживаются
  `src/backend/services/procurement-preview-service.ts` через `RuntimeReadContext`. POST preview больше
  не открывает write session ради чистого расчёта; prod-readiness сравнивает DTO с прежним
  `AccountingApp.previewGoodsReceipt`.
- ✅ `GET /api/onboarding/existing-store/projects/:id` снят с session middleware и скрытого write side
  effect: `src/backend/services/onboarding-project-service.ts` строит read-only DTO проекта, items и
  summary через `RuntimeReadContext`, клонируя вычисленные статусы/payload без `upsert`. Write/control
  endpoints онбординга (`import`, `match-products`, `patch item`, `review`, `create-opening-balances`)
  остаются в session-зоне до следующего транзакционного слоя.
- ✅ User-write endpoints управления доступами сняты с session middleware:
  `/api/settings/users/invite`, `/api/settings/users/:id/role`,
  `/api/settings/users/:id/disable`, `/api/settings/users/:id/resend` обслуживаются
  `src/backend/services/access-management-service.ts` через `RuntimeWriteContext`.
  Контроллеры больше не пишут через request-scoped `AccountingApp`; prod-readiness фиксирует
  `writeSessions = 0`, а Postgres runtime проверяет запись в нормализованной таблице
  `user_account`.
- ✅ MCP/agent-token writes и права агента на канал сняты с session middleware:
  `/api/mcp/keys`, `/api/mcp/keys/:id/revoke`, `/api/agent-tokens`,
  `/api/agent-tokens/:id/revoke`, `/api/channels/:id/agent-permission`
  обслуживаются `src/backend/services/agent-token-service.ts` через `RuntimeWriteContext`.
  Выпуск ключа, `tokenHash`, public token shaping и upsert permission больше не пишут через
  request-scoped `AccountingApp`; prod-readiness фиксирует `writeSessions = 0`, Postgres runtime
  проверяет typed rows в `agent_token` и `channel_agent_permission`.
- ✅ Observed stock write/control endpoints сняты с session middleware:
  `/api/channels/:id/observed-stock`, `/api/inventory/reconciliation/:id/ignore`
  обслуживаются `src/backend/services/observed-stock-service.ts` через `RuntimeWriteContext`
  и typed `ObservedStockStore`. Дедуп по ключу `(channelId, externalProductId, warehouseId,
  observedAt)` и ignore больше не пишут через request-scoped `AccountingApp`; prod-readiness
  фиксирует `writeSessions = 0`, Postgres runtime проверяет typed row в `observed_stock`.
- ✅ External event ingest/control endpoints сняты с session middleware:
  `/api/channels/:id/external-events`, `/api/integrations/events/:id/reprocess`,
  `/api/integrations/events/:id/ignore` обслуживаются
  `src/backend/services/external-event-service.ts` через `RuntimeWriteContext` и typed
  `ExternalEventStore`. Дедуп по identity, классификация статуса по SKU/link, ignore и reprocess
  больше не пишут через request-scoped `AccountingApp`; prod-readiness фиксирует `writeSessions = 0`,
  Postgres runtime проверяет typed row в `external_event`.
- ✅ External product/link commands сняты с session middleware:
  `/api/channels/:id/external-products`, `/api/external-products/:id/link`,
  `/api/products/:productId/external-links`, DELETE `/api/products/:productId/external-links/:linkId`,
  `/api/external-products/:id/create-internal-product`, `/api/external-products/:id/ignore`,
  `/api/external-products/:id/reprocess-events` обслуживаются
  `src/backend/services/external-product-service.ts` через `RuntimeWriteContext`. Создание внутреннего
  товара переиспользует `product-service`, refresh linked observed/events идет через typed stores;
  prod-readiness фиксирует `writeSessions = 0`, Postgres runtime проверяет typed rows в
  `external_product`, `product_external_link`, `product`.
- ✅ Channel create/update commands сняты с session middleware:
  `/api/channels`, `/api/integrations/channels`, PATCH `/api/integrations/channels/:id`
  обслуживаются `src/backend/services/channel-service.ts` через `RuntimeWriteContext`.
  Автосоздание sales-point склада, привязка склада к каналу и обновление `observed_stock`
  при смене точки продаж больше не пишут через request-scoped `AccountingApp`; prod-readiness
  фиксирует `writeSessions = 0`, Postgres runtime проверяет typed rows в `sales_channel`
  и связанном `warehouse`.
- ✅ Channel credentials/check/disable commands сняты с session middleware:
  `/api/integrations/channels/validate`, POST/DELETE `/api/integrations/channels/:id/credentials`,
  `/api/integrations/channels/:id/check`, `/api/integrations/channels/:id/disable`
  обслуживаются `src/backend/services/channel-credential-service.ts` через `RuntimeWriteContext`.
  `RuntimeWriteContext.channelCredentials` теперь умеет читать, сохранять и очищать
  `channel_credential` напрямую: Postgres пишет encrypted credentials точечно, без
  request-scoped `AccountingApp` и без session-side-effect сохранения всего credential map.
  Prod-readiness фиксирует `writeSessions = 0`, Postgres runtime проверяет encrypted row,
  отсутствие сырого ключа, очистку credentials и статус канала.
- ✅ Начат перенос write/control на обычные сервисы без `AccountingApp` session: добавлен
  `RuntimeWriteContext` и `PostgresRuntimeStore.runWriteContext`, который открывает транзакцию,
  отдаёт сервису `repos + typed stores`, сохраняет `next_id` и коммитит без request-scoped app facade.
  `POST/PATCH/DELETE /api/products/:id/images...` теперь зарегистрированы до session middleware и
  обслуживаются `src/backend/services/product-image-service.ts` по схеме
  `controller → service → repositories → Postgres`; prod-readiness фиксирует `writeSessions = 0`,
  Postgres-тест проверяет запись `product.image_url` и audit row.
- ✅ Метаданные фотостудии тоже сняты с `AccountingApp`: `confirm/approve/patch/delete`
  `/api/products/:id/card/assets/:assetId` и создание asset metadata в upload path обслуживаются
  `src/backend/services/product-asset-service.ts` через `RuntimeWriteContext`; audit вынесен в общий
  `runtime-audit-service.ts`. In-memory regression проверяет, что эти commands не открывают
  `openWriteSession`, Postgres-тест проверяет обновление `product_asset.role/status` и audit row.
- ✅ Product CRUD (`POST /api/products`, update/archive/restore) снят с request-scoped `AccountingApp`
  и обслуживается `src/backend/services/product-service.ts` через `RuntimeWriteContext`: duplicate SKU,
  статус и audit сохраняются на repo уровне. Prod-readiness проверяет create/update/archive/restore
  без `openWriteSession`, Postgres runtime продолжает создавать товар через публичный API и читать его из
  typed таблицы `product`.
- ✅ Простые справочные write-ручки (`POST /api/warehouses`, `POST /api/counterparties`,
  `POST/PATCH /api/money/cash-accounts`) вынесены в `src/backend/services/reference-data-service.ts`
  и обслуживаются через `RuntimeWriteContext` до session middleware. Prod-readiness фиксирует, что
  эти commands не открывают `openWriteSession`; Postgres runtime проверяет typed rows в `warehouse`,
  `counterparty`, `cash_account`.
- ✅ Recalculation jobs (`POST /api/recalculation-jobs`, `POST /api/recalculation-jobs/:id/retry`,
  `POST /api/reports/recalculate`) вынесены в `src/backend/services/recalculation-service.ts` и
  обслуживаются через `RuntimeWriteContext`. Prod-readiness покрывает create/retry/reports-recalculate
  без `openWriteSession`; Postgres runtime проверяет typed rows в `recalculation_job`.
- ✅ Organization update (`PATCH /api/organization`) вынесен в
  `src/backend/services/organization-service.ts`: singleton `organization` сохраняется через
  `repos.saveSingletons` и audit пишется без request-scoped `AccountingApp`. Prod-readiness проверяет
  отсутствие `openWriteSession`, Postgres runtime проверяет typed singleton row в `organization`.
- ✅ Setup lifecycle (`POST/PUT /api/setup`) вынесен в `src/backend/services/setup-service.ts`.
  Bootstrap/update setup создают singleton `organization/accounting_policy`, periods, системные
  справочники, роли/пользователя владельца и audit через `RuntimeWriteContext`; seed helpers вынесены
  в `src/core/setup-seeds.ts`, чтобы `AccountingApp` и сервис использовали один источник.

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
Postgres repositories (`openPostgresRepositoryBackedApp`) и не вызывают `loadSnapshot/saveState`. Удалён
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

### ✅ `state_json` удалён из целевой схемы и runtime-БД
`schema.sql` больше не создаёт `state_json` и legacy `accounting_runtime_entity`/`accounting_runtime_channel_credential`.
Generic runtime repo больше не имеет fallback `select state_json`/`hydrateEntity(row.state_json)`: все runtime specs
обязаны читать typed columns. Для старых БД сохранён только временный legacy-bootstrap: runtime/migrator создают
`state_json` на время backfill старых payload-колонок и затем всегда дропают их. Новый PG-тест проверяет реальную
схему через `information_schema`: после `PostgresRuntimeStore.init()` + `runMigrations()` нет ни одной
`state_json`-колонки. Проверка: `npm run build`, `npm test`, `npm run test:postgres` зелёные.

### ✅ Legacy full-snapshot/entity-store importer удалён
Runtime больше не читает `accounting_runtime_snapshot`, `accounting_runtime_entity` и
`accounting_runtime_channel_credential`; `exportRuntimeEntities` удалён. Если нормализованных строк ещё нет,
Postgres runtime создаёт только metadata и ждёт обычный `/api/setup`, а не пытается восстановить старый
всесущий snapshot. Тест prod-readiness теперь проверяет durable rows через dedicated resource/workspace endpoints.

### ✅ Backend reports/ledger API сняты с `AccountingApp.reports()`
`/api/reports*` и `/api/ledger` в Postgres-runtime теперь читают typed Postgres read-model напрямую:
`readRuntimeLedgerBalances()` агрегирует проводки SQL-группировкой по `journal_line`, `readRuntimeReports()`
собирает публичный report shape без создания `AccountingApp`. `RuntimePersistence` получил
`readReports/readLedgerBalances`, поэтому PG-тесты с `PostgresRuntimeStore` тоже идут через новый путь.
Остаток этапа reports — фронтовый `ReportsPage`: он всё ещё строит расширенные drilldown/юнит-экономику из
набора `useCollection(...)`; следующий срез — перевести экран на серверные report DTO вместо клиентского
перебора коллекций.

### ✅ Backend dashboard API снят с `AccountingApp.dashboard()`
`/api/dashboard` в Postgres-runtime теперь обслуживается через `readRuntimeDashboard()`:
singleton `organization/accountingPolicy`, counters, current period и ledger balances читаются из typed
Postgres read-model без создания `AccountingApp`. `RuntimePersistence` получил `readDashboard`, а
prod-readiness фиксирует, что dashboard больше не открывает request-scoped snapshot/read session.

### ✅ Frontend ReportsPage больше не собирает локальный god-state
Экран отчётов перешёл с `state = { ...useCollection(...) }` на `/api/reports/workspace` с query-фильтрами
`dateFrom/dateTo/balanceDate/compareBalanceDate/pnlGranularity`. Postgres runtime обслуживает endpoint через
`readRuntimeReportWorkspace()` и typed коллекции, без `openReadModelApp`; in-memory fallback есть только для
тестового контура. Балансовый drilldown временно снят с клиентского расчёта и должен стать отдельной
атомарной ручкой, если понадобится вернуть кликабельную расшифровку.

### ✅ HomePage переведён на dashboard DTO
Главная страница больше не тянет `organization/products/documents/inventoryLots/sales/stockStates/purchaseOrders`
через `useCollection`. `/api/dashboard` возвращает counters, `inventoryCostRub` и `recentDocuments`; Postgres
runtime собирает их из typed read-model.

### ✅ Shell/Topbar используют dashboard DTO
`AppShell`, `Topbar` и redirect для existing-store больше не читают `organization/periods` через collections.
`/api/dashboard` теперь возвращает `periods`, а React Query переиспользует один `["dashboard"]` cache key.

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
6. Стыковка: `tsc` 0 → fast → PG → smoke (browser). Тесты, дергающие `/api/state`, перевести на dedicated
   resource/workspace endpoints.

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
