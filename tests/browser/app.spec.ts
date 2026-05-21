import { expect, test, type Page } from "@playwright/test";

test("user can open the app with data and inspect reports", async ({ page, request }) => {
  await request.post("/api/dev/reset");
  await request.post("/api/dev/demo");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Рабочий стол" })).toBeVisible();
  await page.getByRole("link", { name: "Отчеты" }).click();
  await expect(page.locator("main h1", { hasText: "Отчеты" })).toBeVisible();
  await expect(page.locator("main").getByText("Чистая прибыль").first()).toBeVisible();
});

test("sync run auto-materializes channel sales and shows unit breakdown", async ({ page, request }) => {
  await request.post("/api/dev/reset");
  await request.post("/api/dev/demo");
  const initial = await fetchState(request);
  const channel = initial.salesChannels.find((candidate: any) => candidate.name.includes("Ozon"));
  if (!channel) throw new Error("ozon_channel_not_found");

  await request.post(`/api/integrations/channels/${channel.id}/sync-runs`, {
    data: { credentials: { clientId: "demo-client", apiKey: "demo-key" }, streams: ["sales", "finance_events"] }
  });

  const after = await fetchState(request);
  const saleEvent = after.externalEvents.find((event: any) => event.externalId === "ozon-sale-demo-1");
  const feeEvent = after.externalEvents.find((event: any) => event.externalId === "ozon-fee-demo-1");
  const linkedFinance = after.channelFinanceEvents.find((event: any) => event.externalEventId === feeEvent?.id);
  expect(saleEvent?.status).toBe("processed");
  expect(feeEvent?.status).toBe("processed");
  expect(linkedFinance?.status).toBe("posted");
  expect(linkedFinance?.linkedSaleId).toBeTruthy();

  await page.goto("/reports/unit-economics");
  await expect(page.locator("main h1", { hasText: "Юнит-экономика" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Детализация юнитки");
  await expect(page.locator("main")).toContainText("Комиссия маркетплейса");
  await expect(page.locator("main")).toContainText("Категории канала");
});

test("unconfigured app renders setup-first experience and creates accounting base", async ({ page, request }) => {
  await request.post("/api/dev/reset");

  await page.goto("/");
  await expect(page.locator(".topbar")).toContainText("Не настроена");
  await expect(page.locator(".topbar")).toContainText("Период не выбран");
  await expect(page.getByRole("heading", { name: /Начните уч[её]т магазина/ })).toBeVisible();
  await expect(page.getByText("Первичная настройка")).toBeVisible();
  await expect(page.getByText("Что появится после настройки")).toBeVisible();
  await expect(page.getByRole("link", { name: "Уже работающий магазин" })).toHaveCount(0);

  await page.getByRole("link", { name: "Перейти к настройке" }).click();
  await expect(page.getByRole("heading", { name: "Первичная настройка учета" })).toBeVisible();
  await page.getByLabel("Название организации").fill("QA магазин");
  await page.getByRole("button", { name: "Далее" }).click();
  await page.getByRole("button", { name: "Далее" }).click();
  await page.getByLabel("Дата старта учета").fill("2026-08-01");
  await page.getByRole("button", { name: "Проверить настройки" }).click();
  await page.getByRole("button", { name: "Создать учетную базу" }).click();

  await expect(page.locator(".topbar")).toContainText("QA магазин");
  await expect(page.getByRole("heading", { name: "Поставки" })).toBeVisible();
  const state = await fetchState(request);
  expect(state.organization.displayName).toBe("QA магазин");
  expect(state.accountingPolicy.accountingStartDate).toBe("2026-08-01");
  expect(state.periods.length).toBeGreaterThan(0);
});

test("render-critical workspaces expose spec controls and labels", async ({ page, request }) => {
  await request.post("/api/dev/reset");
  await request.post("/api/dev/demo");
  const state = await fetchState(request);
  const ids = idsFromState(state);

  await page.goto("/settings/chart-accounts");
  await expect(page.locator("main h1", { hasText: "План счетов" })).toBeVisible();
  await page.getByPlaceholder("Поиск по коду или названию").fill("41.01");
  await page.getByLabel("Тип счета").selectOption("asset");
  await expect(page.getByLabel("Только активные")).toBeChecked();
  await expect(page.locator("main")).toContainText("Товары на своем складе");

  for (const [route, heading, marker] of [
    ["/reports", "Отчеты", "Чистая прибыль"],
    ["/reports/profit-and-loss", "Прибыль и убытки", "Валовая прибыль"],
    ["/reports/balance-sheet", "Баланс", "Активы = Обязательства + Капитал"],
    ["/reports/unit-economics", "Юнит-экономика", "Показать продажи"]
  ] as const) {
    await page.goto(route);
    await expect(page.locator("main h1", { hasText: heading })).toBeVisible();
    await expect(page.locator("main")).toContainText(marker);
    await expect(page.getByRole("button", { name: "Пересчитать отчет" }).first()).toBeVisible();
  }

  await page.goto(`/controls/period-closing/${ids.periodId}`);
  await expect(page.locator("main h1")).toContainText("Закрытие периода");
  await expect(page.getByRole("button", { name: "Запустить проверку" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Сформировать отчеты" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Закрыть период" })).toBeVisible();

  await page.goto("/onboarding/existing-store");
  await expect(page).toHaveURL(/\/setup\/existing-store/);
  await expect(page.getByRole("heading", { name: "Первичная настройка учета" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Канал Ozon");
  for (const label of ["Сопоставление товаров", "Себестоимость остатков", "Проверка и документы"]) {
    await expect(page.locator("main")).toContainText(label);
  }
  await expect(page.locator("main")).not.toContainText("Дата начала учета");
  await expect(page.locator("main")).not.toContainText("Загрузить данные");
  await expect(page.getByRole("button", { name: "Продолжить" }).first()).toBeVisible();

  await page.goto("/controls/audit");
  await expect(page.getByRole("heading", { name: "Аудит действий" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Пригласить пользователя");
  await expect(page.locator("main")).not.toContainText("Выпустить токен");
});

test("sidebar highlights semantic section aliases", async ({ page, request }) => {
  await request.post("/api/dev/reset");
  await request.post("/api/dev/demo");
  const state = await fetchState(request);
  const ids = idsFromState(state);

  const cases = [
    ["/integrations/channels", "Маркетплейсы"],
    [`/integrations/channels/${ids.channelId}/sync`, "Маркетплейсы"],
    ["/integrations/inbox", "Маркетплейсы"],
    ["/settings/chart-accounts", "Учет"],
    ["/reports/journal", "Учет"],
    ["/reports/ledger", "Учет"],
    ["/reports/profit-and-loss", "Отчеты"],
    ["/finance/payouts", "Деньги"],
    [`/finance/payouts/${ids.payoutId}/reconciliation`, "Деньги"],
    ["/finance/expenses", "Расходы"],
    ["/returns", "Продажи"],
    ["/controls/audit", "Контроль"],
    ["/settings", "Настройки"]
  ] as const;

  for (const [route, expected] of cases) {
    await page.goto(route);
    await expect(page.locator("main h1").first(), route).toBeVisible();
    await expect(page.locator(".sidebar nav a.active span"), route).toHaveText([expected]);
  }
});

test("all spec screens are reachable after demo bootstrap", async ({ page, request }) => {
  await request.post("/api/dev/reset");
  await request.post("/api/dev/demo");
  const state = await fetchState(request);
  const ids = idsFromState(state);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const routes = [
    "/",
    "/setup",
    "/settings",
    "/setup/review",
    "/accounting",
    "/settings/chart-accounts",
    "/reports/journal",
    `/reports/journal/${ids.journalEntryId}`,
    "/reports/ledger",
    "/documents",
    `/documents/${ids.documentId}`,
    "/products",
    "/products/new",
    `/products/${ids.productId}`,
    `/products/${ids.productId}/edit`,
    `/products/${ids.productId}/lots`,
    "/products/channel-mapping",
    "/inventory",
    "/inventory/opening-balances/new",
    "/inventory/movements",
    "/inventory/transfers/new",
    `/inventory/sales-points/${ids.salesPointWarehouseId}`,
    "/inventory/reconciliation",
    "/inventory/reconciliation/current/resolve",
    "/procurement",
    "/procurement/purchase-orders",
    "/procurement/purchase-orders/new",
    `/procurement/purchase-orders/${ids.purchaseOrderId}`,
    `/procurement/purchase-orders/${ids.purchaseOrderId}/edit`,
    `/procurement/purchase-orders/${ids.purchaseOrderId}/payments/new`,
    `/procurement/purchase-orders/${ids.purchaseOrderId}/receipts/new`,
    `/procurement/purchase-orders/${ids.purchaseOrderId}/costs/new`,
    `/procurement/purchase-orders/${ids.purchaseOrderId}/shortages/new`,
    "/money",
    "/money/owner-contributions/new",
    "/money/supplier-payments/new",
    "/finance/payouts",
    `/finance/payouts/${ids.payoutId}/reconciliation`,
    "/finance/expenses",
    "/finance/expenses/new",
    "/channels",
    "/integrations/channels",
    "/integrations/channels/new",
    `/integrations/channels/${ids.channelId}/sync`,
    "/integrations/inbox",
    `/integrations/channels/${ids.channelId}/finance`,
    `/integrations/finance-events/${ids.financeEventId}`,
    "/sales",
    `/sales/${ids.saleId}`,
    `/sales/${ids.saleId}/returns/new`,
    "/returns",
    "/expenses",
    "/controls",
    "/controls/corrections",
    `/controls/period-closing/${ids.periodId}`,
    `/controls/period-closing/${ids.periodId}/report`,
    "/reports",
    "/reports/profit-and-loss",
    "/reports/balance-sheet",
    "/reports/unit-economics",
    "/onboarding/existing-store",
    "/onboarding/existing-store/import/review",
    "/controls/audit"
  ];

  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("main h1").first(), route).toBeVisible();
    await expect(page.locator("main")).toContainText(/\S/);
    await expectPageLayoutContained(page, route);
  }

  expect(consoleErrors).toEqual([]);
});

test("posted receipt can open channel dispatch flow and build Ozon allocation plan", async ({ page, request }) => {
  await request.post("/api/dev/reset");
  await request.post("/api/dev/demo");
  const state = await fetchState(request);
  const purchaseOrderId = state.purchaseOrders[0]?.id;
  const receipt = state.goodsReceipts[0];
  const salesPointWarehouseId = state.salesChannels[0]?.salesPointWarehouseId;
  if (!purchaseOrderId || !receipt || !salesPointWarehouseId) throw new Error("dispatch_demo_data_missing");

  await page.goto(`/procurement/purchase-orders/${purchaseOrderId}`);
  await page.getByRole("tab", { name: "Приемки" }).click();
  await page.getByRole("button", { name: "Отправить в канал" }).first().click();

  await expect(page.getByRole("heading", { name: "Отправка в канал продаж" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Провести перемещение" })).toBeVisible();
  await expect(page.locator("main")).toContainText("План распределения канала");
  await page.getByRole("button", { name: "Подготовить план" }).first().click();
  await expect(page.locator("main")).toContainText("Кластеры Ozon");
  await page.locator("main label").filter({ hasText: /Центр|Северо-Запад|Урал/ }).first().click();
  await page.getByRole("button", { name: "Автораспределить" }).click();
  await expect(page.locator("main")).toContainText("Черновик плана");
  const nextState = await fetchState(request);
  expect(nextState.pluginStateRecords.some((record: any) => record.namespace === "dispatch_flow" && record.scopeId === receipt.id)).toBe(true);
});

test("posted receipt dispatch allows direct internal transfer without cluster plan", async ({ page, request }) => {
  await request.post("/api/dev/reset");
  await request.post("/api/dev/demo");
  const state = await fetchState(request);
  const purchaseOrderId = state.purchaseOrders[0]?.id;
  const receipt = state.goodsReceipts[0];
  const channel = state.salesChannels[0];
  if (!purchaseOrderId || !receipt || !channel) throw new Error("dispatch_demo_data_missing");

  await page.goto(`/procurement/purchase-orders/${purchaseOrderId}`);
  await page.getByRole("tab", { name: "Приемки" }).click();
  await page.getByRole("button", { name: "Отправить в канал" }).first().click();

  await expect(page.getByRole("heading", { name: "Отправка в канал продаж" })).toBeVisible();
  await expect(page.locator("main")).toContainText("обычное внутреннее перемещение на точку продаж");
  await page.getByRole("button", { name: "Провести перемещение" }).click();
  await expect(page).toHaveURL(/\/documents\/doc_/);

  const nextState = await fetchState(request);
  expect(
    nextState.stockTransfers.some(
      (transfer: any) => transfer.sourceGoodsReceiptId === receipt.id && transfer.channelId === channel.id && transfer.status === "posted"
    )
  ).toBe(true);
});

test("api errors surface in a global alert instead of an inline aside block", async ({ page }) => {
  await page.goto("/procurement/receipts/receipt_missing_999999/dispatch");
  await expect(page.getByRole("alert")).toContainText("Не найдена запись receipt_missing_999999");
  await expect(page.locator("aside.flex.flex-col.gap-4")).not.toContainText("Не найдена запись receipt_missing_999999");
});

test("product page keeps tables contained and header actions aligned", async ({ page, request }) => {
  await request.post("/api/dev/reset");
  await request.post("/api/dev/demo");
  const state = await fetchState(request);
  const ids = idsFromState(state);
  const product = state.products.find((item: any) => item.id === ids.productId);

  await page.goto(`/products/${ids.productId}`);
  await expect(page.locator("main h1").first()).toContainText(product?.name ?? "");

  const layout = await page.evaluate(() => {
    const actions = Array.from(document.querySelectorAll(".specActions :is(a, button)")).map((control) => {
      const rect = control.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
    const tabs = Array.from(document.querySelectorAll(".contextTabs button")).map((tab) => {
      const rect = tab.getBoundingClientRect();
      return { top: rect.top, height: rect.height, text: (tab.textContent ?? "").trim() };
    });
    const tableScroll = document.querySelector(".tableScroll");
    const scrollRect = tableScroll?.getBoundingClientRect();
    const panelRect = tableScroll?.closest(".renderPanel")?.getBoundingClientRect();
    const scrollOverflow = tableScroll ? tableScroll.scrollWidth - tableScroll.clientWidth : 0;
    const clippedButtons = Array.from(document.querySelectorAll(".tableScroll button"))
      .filter((button) => {
        const buttonRect = button.getBoundingClientRect();
        const cellRect = button.closest("td")?.getBoundingClientRect();
        return button.scrollWidth > button.clientWidth + 1 || (cellRect ? buttonRect.right > cellRect.right + 1 : false);
      })
      .map((button) => (button.textContent ?? "").trim());
    const clippedCells = Array.from(document.querySelectorAll(".tableScroll th, .tableScroll td"))
      .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
      .map((cell) => (cell.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80));
    return {
      actions,
      tabs,
      scrollRight: scrollRect?.right ?? 0,
      panelRight: panelRect?.right ?? 0,
      scrollLeft: scrollRect?.left ?? 0,
      panelLeft: panelRect?.left ?? 0,
      scrollOverflow,
      clippedButtons,
      clippedCells
    };
  });

  expect(layout.actions.length).toBeGreaterThanOrEqual(1);
  expect(layout.tabs.map((tab) => tab.text.replace(/\s+\d+$/, ""))).toEqual(expect.arrayContaining(["Обзор", "Остатки", "Партии себестоимости", "Движения"]));
  expect(Math.abs(layout.tabs[0].top - layout.tabs[1].top)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.tabs[0].height - layout.tabs[1].height)).toBeLessThanOrEqual(1);
  expect(layout.scrollLeft).toBeGreaterThanOrEqual(layout.panelLeft - 1);
  expect(layout.scrollRight).toBeLessThanOrEqual(layout.panelRight + 1);
  expect(layout.scrollOverflow).toBeLessThanOrEqual(1);
  expect(layout.clippedButtons).toEqual([]);
  expect(layout.clippedCells).toEqual([]);
  await expectPageLayoutContained(page, `/products/${ids.productId}`);
});

test("main user actions are clickable and create accounting artifacts", async ({ page, request }) => {
  await request.post("/api/dev/reset");
  await request.post("/api/dev/demo");
  let state = await fetchState(request);
  let ids = idsFromState(state);

  await page.goto("/products/new");
  await page.getByLabel("Название").fill("QA быстрый товар");
  await page.getByRole("button", { name: /Сохранить и открыть/ }).click();
  await expect(page).toHaveURL(/\/products\/prod_/);
  await expect(page.locator("main h1").first()).toContainText("QA быстрый товар");

  await page.goto("/procurement/purchase-orders/new");
  await expect(page.locator("main h1", { hasText: "Новый заказ поставщику" })).toBeVisible();
  await page.getByLabel("Название нового поставщика").fill("Test Supplier Ltd");
  await page.getByLabel("Дата заказа").fill("2026-07-10");
  await page.getByLabel("Валюта поставщика", { exact: true }).selectOption("USD");
  await page.getByLabel("Количество 1").fill("42");
  await page.getByLabel("Цена поставщика 1").fill("12.34");
  await page.getByLabel("Комментарий строки 1").fill("test editable line");
  await page.getByLabel("Комментарий для поставки").fill("editable purchase order");
  await page.getByRole("button", { name: "Создать и отправить поставщику" }).click();
  await expect(page).toHaveURL(/\/procurement\/purchase-orders\/po_/);
  const stateAfterOrder = await fetchState(request);
  const createdOrder = stateAfterOrder.purchaseOrders.at(-1);
  expect(createdOrder.totalQty).toBe(42);
  expect(createdOrder.totalSupplierAmount).toBeCloseTo(518.28, 2);
  expect(createdOrder.supplierCurrency).toBe("USD");
  expect(createdOrder.comment).toBe("editable purchase order");

  await page.goto(`/integrations/channels/${ids.channelId}/sync`);
  await expect(page.getByRole("button", { name: "Запустить обновление" })).toBeVisible();

  await page.goto(`/procurement/purchase-orders/${ids.purchaseOrderId}/payments/new`);
  await page.getByLabel("Дата оплаты").fill("2026-06-20");
  await page.getByRole("button", { name: "Провести оплату" }).click();
  await expect(page).toHaveURL(new RegExp(`/procurement/purchase-orders/${ids.purchaseOrderId}$`));

  await page.goto(`/procurement/purchase-orders/${ids.purchaseOrderId}/receipts/new`);
  const receiptButton = page.getByRole("button", { name: "Провести приемку" });
  if (await receiptButton.isEnabled()) {
    await receiptButton.click();
    await expect(page).toHaveURL(new RegExp(`/procurement/purchase-orders/${ids.purchaseOrderId}$`));
  }

  await page.goto(`/procurement/purchase-orders/${ids.purchaseOrderId}/costs/new`);
  await page.getByRole("button", { name: "Провести расход" }).click();
  await expect(page).toHaveURL(new RegExp(`/procurement/purchase-orders/${ids.purchaseOrderId}$`));

  await page.goto("/money/owner-contributions/new");
  await page.getByRole("button", { name: "Провести пополнение" }).click();
  await expect(page).toHaveURL(/\/money$/);

  await page.goto("/finance/expenses/new");
  await page.getByRole("button", { name: "Провести расход" }).click();
  await expect(page).toHaveURL(/\/expenses$/);

  state = await fetchState(request);
  ids = idsFromState(state);
  await page.goto(`/controls/period-closing/${ids.periodId}`);
  await page.getByRole("button", { name: "Сформировать отчеты" }).click();
  await page.goto(`/controls/period-closing/${ids.periodId}/report`);
  await expect(page.getByRole("heading", { name: "Отчет закрытия периода" })).toBeVisible();
  await page.goto(`/controls/period-closing/${ids.periodId}`);
  await page.getByRole("button", { name: "Запустить проверку" }).click();
  await expect(page.getByRole("button", { name: "Закрыть период" })).toBeDisabled();
  await expect(page.locator("main")).toContainText("Нужно сверить выплат");
});

test("purchase order card supports edit before dependencies and receipt correction afterwards", async ({ page, request }) => {
  await request.post("/api/dev/reset");
  await request.post("/api/dev/demo");
  const unique = Date.now().toString().slice(-5);
  let state = await fetchState(request);
  const productId = state.products[0]?.id;

  await page.goto("/procurement/purchase-orders/new");
  await page.getByLabel("Название нового поставщика").fill(`UI Supplier ${unique}`);
  await page.getByLabel("Дата заказа").fill("2026-06-20");
  await page.getByLabel("Товар 1").selectOption(productId);
  await page.getByLabel("Количество 1").fill("8");
  await page.getByLabel("Цена поставщика 1").fill("2.5");
  await page.getByLabel("Комментарий для поставки").fill("заказ до редактирования");
  await page.getByRole("button", { name: "Создать и отправить поставщику" }).click();
  await expect(page).toHaveURL(/\/procurement\/purchase-orders\/po_/);

  const orderId = page.url().match(/po_[^/]+$/)?.[0];
  expect(orderId).toBeTruthy();
  await expect(page.getByRole("tab", { name: /Состав/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Оплаты/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Приемки/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Расходы/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Расхождения/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Документы/ })).toBeVisible();

  await page.locator(".specActions").getByRole("link", { name: "Редактировать" }).click();
  await expect(page).toHaveURL(new RegExp(`/procurement/purchase-orders/${orderId}/edit$`));
  await page.getByLabel("Количество 1").fill("7");
  await page.getByLabel("Комментарий для поставки").fill("заказ после редактирования");
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(page).toHaveURL(new RegExp(`/procurement/purchase-orders/${orderId}$`));

  state = await fetchState(request);
  const updatedOrder = state.purchaseOrders.find((order: any) => order.id === orderId);
  expect(updatedOrder?.totalQty).toBe(7);
  expect(updatedOrder?.comment).toBe("заказ после редактирования");

  await page.goto(`/procurement/purchase-orders/${orderId}/payments/new`);
  await page.getByLabel("Сумма в рублях").fill("1400");
  await page.getByRole("button", { name: "Провести оплату" }).click();
  await expect(page).toHaveURL(new RegExp(`/procurement/purchase-orders/${orderId}$`));

  await page.goto(`/procurement/purchase-orders/${orderId}/receipts/new`);
  await page.getByLabel(/Принимаем:/).fill("5");
  await page.getByRole("button", { name: "Провести приемку" }).click();
  await expect(page).toHaveURL(new RegExp(`/procurement/purchase-orders/${orderId}$`));
  await expect(page.locator("main")).toContainText("Исходный заказ уже связан с оплатами или приёмками");
  await expect(page.locator(".specActions").getByRole("button", { name: "Редактировать" })).toBeDisabled();

  await page.getByRole("tab", { name: /Приемки/ }).click();
  await page.getByRole("button", { name: "Исправить приемку" }).click();
  await expect(page.getByRole("heading", { name: "Исправить приемку" })).toBeVisible();
  await page.getByLabel("Новое количество").fill("4");
  await page.getByLabel("Причина исправления").fill("Пересчет показал недостачу");
  await page.getByRole("button", { name: "Применить исправление" }).click();
  await expect(page.getByRole("heading", { name: "Исправить приемку" })).toBeHidden();

  state = await fetchState(request);
  const orderLine = state.purchaseOrderLines.find((line: any) => line.purchaseOrderId === orderId);
  const correctedReceiptLine = state.goodsReceiptLines.find((line: any) => line.purchaseOrderLineId === orderLine?.id);
  expect(correctedReceiptLine?.qtyReceived).toBe(4);
  expect(state.documentVersions.some((version: any) => version.documentId === updatedOrder?.documentId)).toBeTruthy();
});

test("major forms submit the values typed by the user", async ({ page, request }) => {
  await request.post("/api/dev/reset");
  await request.post("/api/dev/demo");
  let state = await fetchState(request);
  let ids = idsFromState(state);

  const unique = Date.now().toString().slice(-5);
  const sku = `QA-SKU-${unique}`;
  const productName = `QA товар ${unique}`;

  await page.goto("/products/new");
  await page.getByLabel("Внутренний SKU").fill(sku);
  await page.getByLabel("Название").fill(productName);
  await page.getByLabel("Штрихкод").fill(`46${unique}`);
  await page.getByLabel("Категория").fill("QA категория");
  await page.getByRole("button", { name: "Сохранить и открыть" }).click();
  await expect(page).toHaveURL(/\/products\/prod_/);
  state = await fetchState(request);
  const product = state.products.find((item: any) => item.sku === sku);
  expect(product?.name).toBe(productName);
  expect(product?.category).toBe("QA категория");

  await page.goto("/inventory/opening-balances/new");
  await expect(page.getByLabel("Дата учёта")).toHaveValue("2026-06-01");
  await page.getByLabel("Товар", { exact: true }).selectOption(product.id);
  await page.getByLabel("Количество").fill("17");
  await page.getByLabel("Себестоимость единицы").fill("100");
  await page.getByRole("button", { name: "Провести стартовый остаток" }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  state = await fetchState(request);
  expect(state.inventoryLots.some((lot: any) => lot.productId === product.id && lot.qtyInitial === 17 && lot.costInitialRub === 1700)).toBeTruthy();

  await page.goto("/procurement/purchase-orders/new");
  await page.getByLabel("Дата заказа").fill("2026-06-20");
  await page.getByLabel("Товар 1").selectOption(product.id);
  await page.getByLabel("Количество 1").fill("8");
  await page.getByLabel("Цена поставщика 1").fill("2.5");
  await page.getByLabel("Комментарий строки 1").fill("typed PO line");
  await page.getByLabel("Комментарий для поставки").fill("typed PO header");
  await page.getByRole("button", { name: "Создать и отправить поставщику" }).click();
  await expect(page).toHaveURL(/\/procurement\/purchase-orders\/po_/);
  state = await fetchState(request);
  const order = state.purchaseOrders.find((candidate: any) => candidate.comment === "typed PO header");
  expect(order.totalQty).toBe(8);
  expect(order.totalSupplierAmount).toBe(20);
  expect(order.comment).toBe("typed PO header");

  await page.goto(`/procurement/purchase-orders/${order.id}/payments/new`);
  await page.getByLabel("Сумма в рублях").fill("1600");
  await page.getByLabel("Комментарий").fill("typed supplier payment");
  await page.getByRole("button", { name: "Провести оплату" }).click();
  await expect(page).toHaveURL(new RegExp(`/procurement/purchase-orders/${order.id}$`));
  state = await fetchState(request);
  expect(state.payments.some((payment: any) => payment.paymentType === "supplier_payment" && payment.amountRub === 1600 && payment.comment === "typed supplier payment")).toBeTruthy();

  await page.goto(`/procurement/purchase-orders/${order.id}/receipts/new`);
  await page.getByLabel(/Принимаем:/).fill("3");
  await page.getByRole("button", { name: "Провести приемку" }).click();
  await expect(page).toHaveURL(new RegExp(`/procurement/purchase-orders/${order.id}$`));
  state = await fetchState(request);
  expect(state.goodsReceiptLines.some((line: any) => line.productId === product.id && line.qtyReceived === 3)).toBeTruthy();

  await page.goto(`/procurement/purchase-orders/${order.id}/costs/new`);
  await page.getByLabel("Сумма").fill("7654");
  await page.getByLabel("Комментарий").fill("typed procurement cost");
  await page.getByRole("button", { name: "Провести расход" }).click();
  await expect(page).toHaveURL(new RegExp(`/procurement/purchase-orders/${order.id}$`));
  state = await fetchState(request);
  expect(state.procurementCosts.some((cost: any) => cost.amountRub === 7654 && cost.comment === "typed procurement cost")).toBeTruthy();

  await page.goto("/money/owner-contributions/new");
  await page.getByLabel("Сумма").fill("12345");
  await page.getByLabel("Комментарий").fill("typed owner contribution");
  await page.getByRole("button", { name: "Провести пополнение" }).click();
  await expect(page).toHaveURL(/\/money$/);
  state = await fetchState(request);
  expect(state.payments.some((payment: any) => payment.paymentType === "owner_contribution" && payment.amountRub === 12345 && payment.comment === "typed owner contribution")).toBeTruthy();

  await page.goto("/integrations/channels/new");
  await page.getByLabel("Название").fill(`QA канал ${unique}`);
  await expect(page.getByText("Тип канала")).toHaveCount(0);
  await expect(page.getByText("Плагин")).toHaveCount(0);
  await expect(page.getByText("Точка продаж")).toHaveCount(0);
  await page.getByRole("button", { name: "Далее" }).click();
  await expect(page.getByLabel("Client-Id")).toBeVisible();
  await expect(page.getByLabel("Api-Key")).toBeVisible();
  await expect(page.getByRole("button", { name: "Далее" })).toBeDisabled();
  await request.post("/api/integrations/channels", {
    data: {
      name: `QA канал ${unique}`,
      channelType: "marketplace",
      pluginCode: "ozon",
      enabledStreams: ["products", "stocks", "sales", "returns", "finance_events", "payouts"]
    }
  });
  state = await fetchState(request);
  const channel = state.salesChannels.find((item: any) => item.name === `QA канал ${unique}`);
  expect(channel?.channelType).toBe("marketplace");
  expect(channel?.salesPointWarehouseId).toBeTruthy();

  await page.goto("/finance/expenses/new");
  await page.getByLabel("Сумма").fill("6789");
  await page.getByLabel("Комментарий").fill("typed expense");
  await page.getByRole("button", { name: "Провести расход" }).click();
  await expect(page).toHaveURL(/\/expenses$/);
  state = await fetchState(request);
  expect(state.operatingExpenses.some((expense: any) => expense.amountRub === 6789 && expense.comment === "typed expense")).toBeTruthy();

  ids = idsFromState(state);
  expect(ids.periodId).toBeTruthy();
});

test("sales, finance events and payout reconciliation expose workflow controls", async ({ page, request }) => {
  await request.post("/api/dev/reset");
  await request.post("/api/dev/demo");
  const state = await fetchState(request);
  const ids = idsFromState(state);

  await page.goto("/sales/new");
  await expect(page.locator("main h1")).toContainText("Ручная продажа");
  await expect(page.getByRole("button", { name: "Сохранить черновик" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Провести продажу" })).toBeVisible();

  await page.goto(`/sales/${ids.saleId}`);
  await expect(page.locator("main")).toContainText("Себестоимость");
  await expect(page.getByRole("link", { name: "Создать возврат" })).toBeVisible();

  await page.goto("/returns");
  await expect(page.locator("main h1")).toContainText("Возвраты");
  await expect(page.locator("main")).toContainText("Восстановленная себестоимость");

  await page.goto(`/integrations/channels/${ids.channelId}/finance`);
  await expect(page.locator("main h1")).toContainText("Финансы");
  await expect(page.getByRole("button", { name: "Обработать новые операции" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Требуют внимания");

  await page.goto(`/finance/payouts/${ids.payoutId}/reconciliation`);
  await expect(page.locator("main h1")).toContainText("Сверка выплаты");
  await expect(page.getByRole("button", { name: "Пересчитать состав" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Провести выплату" })).toBeVisible();
});

async function fetchState(request: { get(url: string): Promise<{ json(): Promise<any> }> }) {
  const response = await request.get("/api/state");
  const payload = await response.json();
  return payload.data;
}

async function expectPageLayoutContained(page: Page, route: string) {
  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const viewportWidth = root.clientWidth;
    const pageScrollWidth = Math.max(root.scrollWidth, body.scrollWidth);
    const unwrappedTables = Array.from(document.querySelectorAll(".renderPanel table, .panel table"))
      .filter((table) => !table.closest(".tableScroll") && !table.closest(".panelBody"))
      .map((table) => ({
        tag: table.tagName.toLowerCase(),
        className: String((table as HTMLElement).className),
        text: (table.textContent ?? "").trim().slice(0, 80)
      }));
    const offenders = Array.from(document.querySelectorAll("body *"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.right > viewportWidth + 1 && !element.closest(".tableScroll");
      })
      .slice(0, 5)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: String((element as HTMLElement).className),
        text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80)
      }));
    return { viewportWidth, pageScrollWidth, unwrappedTables, offenders };
  });

  expect(layout.pageScrollWidth, `${route} has horizontal page overflow: ${JSON.stringify(layout.offenders)}`).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.unwrappedTables, `${route} has panel tables without a scroll container`).toEqual([]);
}

function idsFromState(state: any) {
  return {
    productId: state.products[0]?.id,
    documentId: state.documents[0]?.id,
    journalEntryId: state.journalEntries[0]?.id,
    purchaseOrderId: state.purchaseOrders[0]?.id,
    salesPointWarehouseId: state.warehouses.find((warehouse: any) => warehouse.warehouseType === "sales_point")?.id,
    channelId: state.salesChannels[0]?.id,
    saleId: state.sales[0]?.id,
    payoutId: state.payouts[0]?.id,
    financeEventId: state.channelFinanceEvents[0]?.id,
    periodId: state.periods[0]?.id
  };
}
