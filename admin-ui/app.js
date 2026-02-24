const API_BASE = window.__ADMIN_API_BASE__ || "/v1/admin";

/* ============================================================ */
/* Auth                                                         */
/* ============================================================ */
let _hmacToken = localStorage.getItem("_mpflow_token") || null;

const state = {
  user: null,
  cards: [],
  orders: [],
  selectedCard: null,
  selectedCardDetail: null,
  searchQuery: "",
  cardSort: { field: "updated_at", dir: "desc" },
  editingOrderId: null,
  showArchived: false,
  orderSearchQuery: "",
  orderSort: { field: "created_at", dir: "desc" },
  ueData: null, pnlData: null,
  ueExpanded: false, ueOpsExpanded: false,
  matrixData: [],
  suppliesData: undefined,
  selectedSkuDetail: null,
  financeLoaded: false,
  financeSearchQuery: "",
  financeSort: { field: "happened_at", dir: "desc" },
  demandPlan: null,
  demandSyncedAt: null,
  demandExpandedRows: new Set(),
  cardPageId: null,
  previousHash: "catalog",
  mcpLoaded: false,
  pricesLoaded: false,
  priceProducts: [],
  priceDefaults: {},
  priceSearchQuery: "",
  priceSort: { field: "title", dir: "asc" },
  priceGlobalRoi: 20,
  priceRowRoi: {},
  priceRowPrice: {},
  priceSyncing: false, // deprecated — kept for compat
  syncFreshness: {},
  syncRunning: false,
  syncLoaded: false,
  calcCategories: [],
  calcTypes: [],
  promoLoaded: false,
  promoItems: [],
  promoSort: { field: "title", dir: "asc" },
};

/* ============================================================ */
/* DOM refs                                                     */
/* ============================================================ */
const $ = (id) => document.getElementById(id);

const loginView = $("loginView");
const appView = $("appView");
const loginError = $("loginError");
const currentUser = $("currentUser");
const sectionTitle = $("sectionTitle");
const sectionSubtitle = $("sectionSubtitle");
const ozonCredsStatus = $("ozonCredsStatus");
const ozonBadge = $("ozonBadge");
const ozonIntegrationDetails = $("ozonIntegrationDetails");

const cardsSection = $("cardsSection");
const ordersSection = $("ordersSection");
const analyticsSection = $("analyticsSection");
const demandSection = $("demandSection");
const logisticsSection = $("logisticsSection");
const financeSection = $("financeSection");
const mcpSection = $("mcpSection");
const pricesSection = $("pricesSection");
const promoSection = $("promoSection");
const syncSectionEl = $("syncSection");
const pluginsSection = $("pluginsSection");
const settingsSection = $("settingsSection");
const cardsTableBody = $("cardsTableBody");
const ordersTableBody = $("ordersTableBody");

const cardDetailTitle = $("cardDetailTitle");
const cardDetailStatus = $("cardDetailStatus");
const source1688Status = $("source1688Status");
const cardSourcesList = $("cardSourcesList");
const cardLotsBody = $("cardLotsBody");
const cardSalesBody = $("cardSalesBody");

const fieldSku = $("cardSkuInput");
const fieldTitle = $("cardTitleInput");
const fieldBrand = $("cardBrandInput");
const fieldStatus = $("cardStatusInput");
const fieldOzonProduct = $("cardOzonProductInput");
const fieldOzonOffer = $("cardOzonOfferInput");
const fieldDescription = $("cardDescriptionInput");
const fieldDimPackageLength = $("dimPackageLength");
const fieldDimPackageWidth = $("dimPackageWidth");
const fieldDimPackageHeight = $("dimPackageHeight");
const fieldDimPackageWeight = $("dimPackageWeight");
const fieldPurchasePrice = $("fieldPurchasePrice");
const fieldPurchaseCurrency = $("fieldPurchaseCurrency");

const ozonClientIdInput = $("ozonClientIdInput");
const ozonApiKeyInput = $("ozonApiKeyInput");

// New drawer / modal / UI refs
const createCardDrawerBackdrop = $("createCardDrawerBackdrop");
const createCardDrawerPanel = $("createCardDrawerPanel");
const orderDrawerBackdrop = $("orderDrawerBackdrop");
const orderDrawerPanel = $("orderDrawerPanel");
const orderDrawerTitle = $("orderDrawerTitle");
const ozonModal = $("ozonModal");
const financeModal = $("financeModal");
const toastContainer = $("toastContainer");
const sidebarEl = $("sidebarEl");
const sidebarOverlay = $("sidebarOverlay");

/* ============================================================ */
/* Section titles                                               */
/* ============================================================ */
const SECTION_META = {
  cardsSection: { title: "Каталог", subtitle: "Карточки товаров, остатки и интеграции", hash: "catalog" },
  ordersSection: { title: "Закупки", subtitle: "Заказы поставщикам, приёмка и расходы", hash: "orders" },
  analyticsSection: { title: "Аналитика", subtitle: "Юнит-экономика по SKU", hash: "analytics" },
  demandSection: { title: "Планирование", subtitle: "Что и сколько заказать у поставщика", hash: "demand" },
  logisticsSection: { title: "Логистика", subtitle: "Матрица движения товаров: закупки, склад, Ozon", hash: "logistics" },
  financeSection: { title: "Финансы", subtitle: "Ручные доходы и расходы", hash: "finance" },
  pricesSection: { title: "Цены", subtitle: "Анализ цен и калькулятор безубыточности", hash: "prices" },
  promoSection: { title: "Продвижение", subtitle: "Управление акциями и ценовыми индексами", hash: "promo" },
  syncSection: { title: "Синхронизация", subtitle: "Обновление данных из Ozon", hash: "sync" },
  mcpSection: { title: "MCP", subtitle: "Подключение AI-клиентов", hash: "mcp" },
  pluginsSection: { title: "Плагины", subtitle: "Установленные расширения", hash: "plugins" },
  settingsSection: { title: "Настройки", subtitle: "Параметры аккаунта", hash: "settings" },
  cardPageSection: { title: "", subtitle: "", hash: null },
};

const FINANCE_CATEGORIES = {
  expense: [
    { value: "rent", label: "Аренда" },
    { value: "salary", label: "Зарплата" },
    { value: "ads", label: "Реклама (внешняя)" },
    { value: "packaging", label: "Упаковка" },
    { value: "logistics", label: "Логистика" },
    { value: "tools", label: "Инструменты и сервисы" },
    { value: "tax", label: "Налоги и взносы" },
    { value: "inventory_loss", label: "Потери / расхождения" },
    { value: "other_expense", label: "Прочие расходы" },
  ],
  income: [
    { value: "refund", label: "Возврат средств" },
    { value: "subsidy", label: "Субсидия / грант" },
    { value: "other_income", label: "Прочие доходы" },
  ],
};

function financeCategoryLabel(value) {
  for (const cats of Object.values(FINANCE_CATEGORIES)) {
    const found = cats.find((c) => c.value === value);
    if (found) return found.label;
  }
  return value || "—";
}

const HASH_TO_SECTION = Object.fromEntries(
  Object.entries(SECTION_META).map(([id, meta]) => [meta.hash, id])
);

function esc(s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

const UNSAFE_TAGS = new Set(["SCRIPT", "IFRAME", "OBJECT", "EMBED", "LINK", "META"]);
const _rawInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");

function sanitizeHtml(html) {
  const template = document.createElement("template");
  _rawInnerHTML.set.call(template, String(html ?? ""));
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const toRemove = [];
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (UNSAFE_TAGS.has(el.tagName)) {
      toRemove.push(el);
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "src" || name === "xlink:href") && value.startsWith("javascript:")) {
        el.removeAttribute(attr.name);
      }
    }
  }
  toRemove.forEach((el) => el.remove());
  return _rawInnerHTML.get.call(template);
}

if (_rawInnerHTML && _rawInnerHTML.get && _rawInnerHTML.set) {
  Object.defineProperty(Element.prototype, "innerHTML", {
    configurable: true,
    enumerable: _rawInnerHTML.enumerable ?? false,
    get() {
      return _rawInnerHTML.get.call(this);
    },
    set(value) {
      _rawInnerHTML.set.call(this, sanitizeHtml(value));
    },
  });
}

/* ============================================================ */
/* Helpers                                                      */
/* ============================================================ */
function formatMoney(value) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(
    Number(value || 0)
  );
}

function formatDateTime(value) {
  if (!value) return "—";
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? String(value) : dt.toLocaleString("ru-RU");
}

function showMessage(el, text, isError = false) {
  el.textContent = text;
  el.style.color = isError ? "#ba1f1f" : "";
}

/* ============================================================ */
/* Freshness & Sync Dashboard                                   */
/* ============================================================ */

function formatFreshness(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин. назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч. назад`;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${hh}:${mi}`;
}

function syncStatusColor(isoStr) {
  if (!isoStr) return "red";
  const diffH = (Date.now() - new Date(isoStr).getTime()) / 3600000;
  if (diffH < 1) return "green";
  if (diffH < 24) return "yellow";
  return "red";
}

const SYNC_REGISTRY = [
  { key: "ozon_product_import", label: "Импорт товаров", desc: "Каталог из Ozon", endpoint: "/ozon/import/products", body: { page_size: 100, max_pages: 20, update_existing: true, fill_dimensions_from_ozon: true }, group: "catalog",
    api: "/v2/product/list, /v4/product/info/attributes", db: "master_cards" },
  { key: "ozon_sales", label: "Продажи (UE)", desc: "FBO + FBS отправления → продажи + FIFO", endpoint: "/ozon/sync/sales", body: {}, group: "analytics",
    api: "/v3/posting/fbo/list, /v3/posting/fbs/list", db: "sales_orders, sales_order_items, fifo_allocations" },
  { key: "ozon_finance", label: "Финансы", desc: "Транзакции из Ozon Finance", endpoint: "/ozon/sync/finance", body: {}, group: "analytics",
    api: "/v3/finance/transaction/list", db: "finance_transactions" },
  { key: "ozon_unit_economics", label: "Юнит-экономика", desc: "Себестоимость по операциям SKU", endpoint: "/ozon/sync/unit-economics", body: { limit: 1000, max_pages: 50 }, group: "analytics",
    api: "/v3/finance/transaction/list", db: "ozon_sku_economics (16 столбцов затрат)" },
  { key: "ozon_supplies", label: "Поставки", desc: "Поставки на склады Ozon", endpoint: "/ozon/sync/supplies", body: {}, group: "logistics",
    api: "/v3/supply-order/list, /v3/supply-order/get, /v1/supply-order/bundle", db: "ozon_supplies, ozon_supply_items, stock_movements" },
  { key: "ozon_warehouse_stock", label: "Остатки на складе", desc: "FBS/rFBS/FBP остатки", endpoint: "/ozon/sync/warehouse-stock", body: {}, group: "logistics",
    api: "/v4/product/info/stocks", db: "ozon_warehouse_stock" },
  { key: "fbo_postings", label: "Продажи FBO", desc: "Полная история FBO + отмены", endpoint: "/ozon/sync/fbo-postings", body: {}, group: "logistics",
    api: "/v2/posting/fbo/list", db: "sales_orders, sales_order_items, fifo_allocations" },
  { key: "ozon_returns", label: "Возвраты", desc: "Возвраты и отмены покупателей", endpoint: "/ozon/sync/returns", body: {}, group: "logistics",
    api: "/v1/returns/list", db: "ozon_returns" },
  { key: "ozon_cluster_stock", label: "Кластерные остатки", desc: "FBO аналитика по кластерам", endpoint: "/ozon/sync/cluster-stock", body: {}, group: "demand",
    api: "/v1/analytics/stocks", db: "ozon_cluster_stock" },
  { key: "pricing_sync", label: "Цены и категории", desc: "Категории, комиссии, тарифы", endpoint: "/pricing/sync", body: {}, group: "prices",
    api: "/v3/product/list, /v1/description-category/tree, /v5/product/info/prices", db: "master_cards (attributes JSONB)" },
];

const SYNC_GROUPS = [
  { key: "catalog", label: "Каталог" },
  { key: "analytics", label: "Аналитика" },
  { key: "logistics", label: "Логистика" },
  { key: "demand", label: "Планирование" },
  { key: "prices", label: "Цены" },
];

const SECTION_SYNC_MAP = {
  cardsSection: ["ozon_product_import"],
  analyticsSection: ["ozon_unit_economics", "ozon_sales"],
  demandSection: ["ozon_cluster_stock"],
  logisticsSection: ["ozon_supplies", "ozon_warehouse_stock", "fbo_postings", "ozon_returns"],
  financeSection: ["ozon_finance"],
  pricesSection: ["pricing_sync"],
};

const _spinSvg = `<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>`;

async function loadSyncFreshness() {
  try {
    const data = await apiRequest("/ozon/sync/freshness");
    state.syncFreshness = data.sync_types || {};
  } catch { state.syncFreshness = {}; }
}

function freshnessLabelHtml(syncTypes) {
  const fr = state.syncFreshness || {};
  let oldest = null;
  for (const st of syncTypes) {
    const ts = fr[st];
    if (!ts) { oldest = null; break; }
    if (!oldest || ts < oldest) oldest = ts;
  }
  if (!oldest) {
    return `<span class="freshness-label text-xs text-slate-400 cursor-pointer" title="Данные не синхронизированы"><span class="inline-block w-1.5 h-1.5 rounded-full bg-red-400 mr-1"></span>Не синхр.</span>`;
  }
  const color = syncStatusColor(oldest);
  const dotCls = { green: "bg-emerald-500", yellow: "bg-amber-400", red: "bg-red-400" }[color];
  const label = formatFreshness(oldest);
  return `<span class="freshness-label text-xs text-slate-400 cursor-pointer" title="${new Date(oldest).toLocaleString("ru-RU")}"><span class="inline-block w-1.5 h-1.5 rounded-full ${dotCls} mr-1"></span>${esc(label)}</span>`;
}

function updateAllFreshnessLabels() {
  for (const [sectionId, syncTypes] of Object.entries(SECTION_SYNC_MAP)) {
    if (!syncTypes.length) continue;
    const elId = sectionId === "logisticsSection" ? "logisticsFreshnessLabel"
      : sectionId.replace("Section", "Freshness");
    const el = $(elId);
    if (el) el.innerHTML = freshnessLabelHtml(syncTypes);
  }
}

function renderSyncDashboard() {
  const container = $("syncDashboardRows");
  if (!container) return;
  const fr = state.syncFreshness || {};
  let html = "";
  for (const group of SYNC_GROUPS) {
    const items = SYNC_REGISTRY.filter((s) => s.group === group.key);
    if (!items.length) continue;
    html += `<div class="space-y-2"><h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">${esc(group.label)}</h3>`;
    for (const sync of items) {
      const ts = fr[sync.key];
      const color = syncStatusColor(ts);
      const timeLabel = ts ? formatFreshness(ts) : "Нет данных";
      const dotCls = { green: "bg-emerald-500", yellow: "bg-amber-400", red: "bg-red-400" }[color];
      const tip = `API: ${sync.api}\nБД: ${sync.db}`;
      html += `<div class="flex items-center gap-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3" data-sync-key="${sync.key}" title="${esc(tip)}">
        <span class="w-2 h-2 rounded-full ${dotCls} flex-shrink-0"></span>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-slate-800 dark:text-slate-200">${esc(sync.label)}</div>
          <div class="text-xs text-slate-400">${esc(sync.desc)}</div>
        </div>
        <span class="text-xs text-slate-400 whitespace-nowrap">${esc(timeLabel)}</span>
        <button class="sync-row-btn inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors" data-sync-key="${sync.key}">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          Синк
        </button>
      </div>`;
    }
    html += `</div>`;
  }
  container.innerHTML = html;
}

async function loadSyncDashboard() {
  await loadSyncFreshness();
  renderSyncDashboard();
  updateAllFreshnessLabels();
}

function toNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Number(num.toFixed(3)) : null;
}

function getCardAttributes(card) {
  const raw = card?.attributes;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === "object") return p;
    } catch (_) {}
  }
  return {};
}

function getDimensions(attributes) {
  const d = attributes?.dimensions;
  return d && typeof d === "object" && !Array.isArray(d) ? d : {};
}

function getCardCnyPrice(card) {
  const attrs = getCardAttributes(card);
  const sources = attrs.sources || {};
  for (const [key, src] of Object.entries(sources)) {
    if (key.startsWith("1688:") && src?.data) {
      const p = Number(src.data.price_min);
      if (Number.isFinite(p) && p > 0) return p;
    }
  }
  return 0;
}

function getCardVolume(card) {
  const dims = getDimensions(getCardAttributes(card));
  const l = Number(dims.package_length_cm || dims.length_cm || 0);
  const w = Number(dims.package_width_cm || dims.width_cm || 0);
  const h = Number(dims.package_height_cm || dims.height_cm || 0);
  return l > 0 && w > 0 && h > 0 ? l * w * h : 0;
}

function getCardWeight(card) {
  const dims = getDimensions(getCardAttributes(card));
  return Number(dims.package_weight_kg || dims.weight_kg || 0);
}

function fillDimensionInputs(dimensions) {
  fieldDimPackageLength.value = dimensions.package_length_cm ?? dimensions.length_cm ?? "";
  fieldDimPackageWidth.value = dimensions.package_width_cm ?? dimensions.width_cm ?? "";
  fieldDimPackageHeight.value = dimensions.package_height_cm ?? dimensions.height_cm ?? "";
  fieldDimPackageWeight.value = dimensions.package_weight_kg ?? dimensions.weight_kg ?? "";
}

function readDimensionInputs() {
  return {
    package_length_cm: toNumberOrNull(fieldDimPackageLength.value),
    package_width_cm: toNumberOrNull(fieldDimPackageWidth.value),
    package_height_cm: toNumberOrNull(fieldDimPackageHeight.value),
    package_weight_kg: toNumberOrNull(fieldDimPackageWeight.value),
  };
}

function validateRequiredDimensions(dims) {
  return ["package_length_cm", "package_width_cm", "package_height_cm", "package_weight_kg"].every((k) =>
    Boolean(dims[k])
  );
}

function collectOzonCredsFromInputs() {
  const c = ozonClientIdInput.value.trim();
  const a = ozonApiKeyInput.value.trim();
  return { client_id: c || undefined, api_key: a || undefined };
}

/* ============================================================ */
/* Navigation                                                   */
/* ============================================================ */
function setLoginMode(isLogin) {
  const loadingView = $("loadingView");
  if (loadingView) loadingView.classList.add("hidden");
  loginView.classList.toggle("hidden", !isLogin);
  appView.classList.toggle("hidden", isLogin);
}

function setActiveSection(sectionId) {
  const cardPageEl = $("cardPageSection");
  for (const sec of [cardsSection, ordersSection, analyticsSection, demandSection, logisticsSection, financeSection, pricesSection, promoSection, syncSectionEl, mcpSection, pluginsSection, settingsSection, cardPageEl]) {
    if (sec) sec.classList.toggle("hidden", sec.id !== sectionId);
  }
  if (sectionId === "demandSection" && !state.demandPlan) loadDemandClusterStock();
  if (sectionId === "financeSection" && !state.financeLoaded) loadFinanceTransactions();
  if (sectionId === "pricesSection" && !state.pricesLoaded) loadPriceProducts();
  if (sectionId === "promoSection" && !state.promoLoaded) loadPromoData();
  if (sectionId === "syncSection" && !state.syncLoaded) { state.syncLoaded = true; loadSyncDashboard(); }
  if (sectionId === "mcpSection" && !state.mcpLoaded) loadMcpSection();
  if (sectionId === "pluginsSection") renderPluginsSection();
  if (sectionId === "settingsSection" && !state.settingsLoaded) loadSettings();
  if (sectionId === "cardPageSection") {
    const cid = cardIdFromHash();
    if (cid) loadCardPage(cid);
    document.querySelectorAll(".menu-item").forEach((btn) => btn.classList.remove("active"));
    sectionTitle.textContent = "";
    sectionSubtitle.textContent = "";
    closeMobileSidebar();
    return;
  }
  const meta = SECTION_META[sectionId] || {};
  sectionTitle.textContent = meta.title || "";
  sectionSubtitle.textContent = meta.subtitle || "";
  document.querySelectorAll(".menu-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === sectionId);
  });
  if (meta.hash) location.hash = meta.hash;
  closeMobileSidebar();
}

function sectionFromHash() {
  const h = location.hash.replace("#", "");
  if (h.startsWith("card/")) return "cardPageSection";
  return HASH_TO_SECTION[h] || "cardsSection";
}

function cardIdFromHash() {
  const h = location.hash.replace("#", "");
  return h.startsWith("card/") ? h.substring(5) : null;
}

function switchAnalyticsTab(tab) {
  const economy = $("analyticsTabEconomy");
  const stock = $("analyticsTabStock");
  const btnEco = $("tabBtnEconomy");
  const btnStock = $("tabBtnStock");
  const active = "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm";
  const inactive = "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300";
  if (tab === "stock") {
    economy.classList.add("hidden");
    stock.classList.remove("hidden");
    btnEco.className = `analytics-tab-btn px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${inactive}`;
    btnStock.className = `analytics-tab-btn px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${active}`;
  } else {
    stock.classList.add("hidden");
    economy.classList.remove("hidden");
    btnEco.className = `analytics-tab-btn px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${active}`;
    btnStock.className = `analytics-tab-btn px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${inactive}`;
  }
}

/* ============================================================ */
/* API                                                          */
/* ============================================================ */
async function apiRequest(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (!options.skipAuth && _hmacToken) {
    headers["Authorization"] = `Bearer ${_hmacToken}`;
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) {}
  if (!response.ok) {
    const detail = data?.detail || data?.message || text || `HTTP ${response.status}`;
    if (response.status === 401 && !options.skipAuth) {
      console.warn("[auth] 401 from", path, "— signing out");
      await logout();
    }
    throw new Error(detail);
  }
  return data;
}

/* ============================================================ */
/* Render: Cards                                                */
/* ============================================================ */
function renderCards() {
  cardsTableBody.innerHTML = "";
  updateSortArrows("cardsTableHead", state.cardSort);

  for (const card of state.cards) {
    const tr = document.createElement("tr");
    tr.className = "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors";
    if (card.status === "archived") tr.classList.add("archived-row");
    tr.dataset.cardId = card.id;
    const attrs = getCardAttributes(card);
    const pp = attrs.purchase;
    const ppText = pp && pp.price ? `${pp.price} ${pp.currency || "CNY"}` : "—";
    tr.innerHTML = `
      <td>${card.sku || "—"}</td>
      <td>${card.title || "—"}</td>
      <td>${ppText}</td>
      <td>${card.ozon_offer_id || "—"}</td>
    `;
    cardsTableBody.appendChild(tr);
  }
  if (!state.cards.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="muted">${state.searchQuery ? "Ничего не найдено" : "Карточек пока нет"}</td>`;
    cardsTableBody.appendChild(tr);
  }
}

/* ============================================================ */
/* Render: Card detail (slide-over)                             */
/* ============================================================ */
/* ============================================================ */
/* Card page navigation                                        */
/* ============================================================ */
function navigateToCard(cardId) {
  state.previousHash = location.hash.replace("#", "") || "catalog";
  location.hash = "card/" + cardId;
}

function navigateBack() {
  const prev = state.previousHash || "catalog";
  location.hash = prev.startsWith("card/") ? "catalog" : prev;
}

function switchCardPageTab(tabName) {
  document.querySelectorAll(".card-page-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === tabName);
  });
  document.querySelectorAll(".card-tab-pane").forEach((p) => {
    p.classList.toggle("hidden", p.id !== tabName);
  });
}

async function loadCardPage(cardId) {
  if (state.cardPageId === cardId && state.selectedCardDetail) {
    renderCardPage();
    return;
  }
  try {
    const data = await apiRequest(`/master-cards/${cardId}`);
    state.cardPageId = cardId;
    state.selectedCard = state.cards.find((c) => c.id === cardId) || null;
    state.selectedCardDetail = data;
    renderCardPage();
    switchCardPageTab("cardTabInfo");
  } catch (err) {
    showToast(`Ошибка загрузки карточки: ${err.message}`, "error");
    navigateBack();
  }
}

/* ============================================================ */
/* Generic drawer / modal / toast helpers                        */
/* ============================================================ */
function openDrawer(backdrop, panel) {
  backdrop.classList.remove("hidden");
  panel.classList.remove("hidden");
  requestAnimationFrame(() => {
    backdrop.classList.add("visible");
    panel.classList.add("visible");
  });
}

function closeDrawer(backdrop, panel) {
  backdrop.classList.remove("visible");
  panel.classList.remove("visible");
  setTimeout(() => {
    backdrop.classList.add("hidden");
    panel.classList.add("hidden");
  }, 300);
}

function openModal(el) { el.classList.remove("hidden"); }
function closeModal(el) { el.classList.add("hidden"); }

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

/* ============================================================ */
/* Theme                                                         */
/* ============================================================ */
function initTheme() {
  const saved = localStorage.getItem("theme");
  const dark = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
  updateThemeIcons(dark);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle("dark");
  document.documentElement.classList.toggle("light", !isDark);
  localStorage.setItem("theme", isDark ? "dark" : "light");
  updateThemeIcons(isDark);
}

function updateThemeIcons(isDark) {
  const lightIcon = $("themeIconLight");
  const darkIcon = $("themeIconDark");
  if (lightIcon) lightIcon.classList.toggle("hidden", isDark);
  if (darkIcon) darkIcon.classList.toggle("hidden", !isDark);
}

/* ============================================================ */
/* Mobile sidebar                                                */
/* ============================================================ */
function openMobileSidebar() {
  sidebarEl.classList.add("open");
  sidebarOverlay.classList.remove("hidden");
}

function closeMobileSidebar() {
  sidebarEl.classList.remove("open");
  sidebarOverlay.classList.add("hidden");
}

function renderCardPage() {
  const detail = state.selectedCardDetail;
  if (!detail?.item) return;
  const item = detail.item;
  const attributes = getCardAttributes(item);
  const dimensions = getDimensions(attributes);

  // Title bar
  cardDetailTitle.textContent = item.title || "Без названия";
  const subtitle = $("cardPageSubtitle");
  if (subtitle) subtitle.textContent = `SKU: ${item.sku || "—"} \u00b7 Offer ID: ${item.ozon_offer_id || "—"}`;
  $("archiveCardBtn").textContent = item.status === "archived" ? "Восстановить" : "Архивировать";

  // Form fields
  fieldSku.value = item.sku || "";
  fieldTitle.value = item.title || "";
  fieldBrand.value = item.brand || "";
  fieldStatus.value = item.status || "draft";
  fieldOzonProduct.value = item.ozon_product_id || "";
  fieldOzonOffer.value = item.ozon_offer_id || "";
  fieldDescription.value = item.description || "";
  fillDimensionInputs(dimensions);
  const purchase = attributes.purchase || {};
  fieldPurchasePrice.value = purchase.price ?? "";
  fieldPurchaseCurrency.value = purchase.currency || "CNY";
  renderCardSources(attributes);

  // FIFO tab — compute fallback if any sale has cogs_rub=0
  const lots = detail.lots || [];
  const sales = detail.sales || [];
  const needsFallback = sales.some((s) => Number(s.cogs_rub || 0) === 0 && Number(s.quantity || 0) > 0);
  if (needsFallback && lots.length) computeFifoFallback(lots, sales);
  renderCardPageLots(lots);
  renderCardSales(sales);
  renderCardPageLogisticsSummary();

  showMessage(cardDetailStatus, "");
  showMessage(source1688Status, "");
  // Reset 1688 SKU picker
  $("source1688SkuPicker").style.display = "none";
  $("source1688SkuGrid").innerHTML = "";
  $("source1688Url").value = "";
  state._selected1688Sku = null;

  // Inject plugin card tabs
  injectPluginCardTabs();
}

function renderCardSources(attributes) {
  const container = cardSourcesList;
  container.innerHTML = "";
  const sources = attributes?.sources;
  const entries = sources && typeof sources === "object" ? Object.entries(sources) : [];

  // Auto-inject virtual Ozon source if card has ozon_product_id but no explicit ozon source
  const item = state.selectedCardDetail?.item;
  if (item?.ozon_product_id && !entries.some(([, s]) => (s.provider || "").toLowerCase() === "ozon")) {
    entries.push(["ozon:" + item.ozon_product_id, {
      provider: "ozon",
      kind: "marketplace",
      external_ref: item.ozon_offer_id || item.ozon_product_id,
      updated_at: item.updated_at,
      data: {
        title: item.title,
        url: `https://www.ozon.ru/product/${item.ozon_product_id}`,
        images: item.ozon_main_image ? [item.ozon_main_image] : [],
      },
    }]);
  }

  const badge = $("sourcesCountBadge");
  if (badge) badge.textContent = String(entries.length);

  if (!entries.length) {
    container.innerHTML = '<div class="muted" style="padding:4px">Нет источников</div>';
    return;
  }

  for (const [key, source] of entries) {
    const data = source?.data && typeof source.data === "object" ? source.data : {};
    const provider = (source.provider || "source").toLowerCase();
    const card = document.createElement("div");
    card.className = "source-card";

    // Build link — construct full URL from provider + ref when data.url is missing
    let linkUrl = data.url || null;
    if (!linkUrl && source.external_ref) {
      if (provider === "1688") linkUrl = `https://detail.1688.com/offer/${source.external_ref}.html`;
      else if (provider === "ozon") linkUrl = `https://www.ozon.ru/product/${data.sku || source.external_ref}`;
      else if (String(source.external_ref).startsWith("http")) linkUrl = source.external_ref;
    }
    const titleText = data.title || data.name || linkUrl || "Без названия";
    const titleHtml = linkUrl
      ? `<a href="${linkUrl}" target="_blank" rel="noopener" class="source-card-title">${titleText}</a>`
      : `<span class="source-card-title">${titleText}</span>`;

    // Thumbnail
    const images = data.images || [];
    const thumbHtml = images.length
      ? `<img src="${images[0]}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : `<div class="source-card-thumb-empty">--</div>`;

    // Price
    const price = data.selected_sku_price || data.price_min;
    const priceHtml = price ? `<div class="source-card-price">${price} CNY</div>` : "";

    // Meta line
    const metaParts = [];
    if (data.selected_sku_id) metaParts.push(`SKU: ${data.selected_sku_id}`);
    if (data.note) metaParts.push(data.note);
    const metaHtml = metaParts.length ? `<div class="source-card-meta">${metaParts.join(" | ")}</div>` : "";

    // Badge class
    const badgeClass = provider === "1688" ? "badge-1688" : provider === "ozon" ? "badge-ozon" : "badge-muted";

    card.innerHTML = `
      <div class="source-card-header">
        <span class="badge ${badgeClass}">${source.provider || "source"}</span>
        <span class="badge badge-muted">${source.kind || "unknown"}</span>
        <span class="source-card-date">${formatDateTime(source.updated_at)}</span>
      </div>
      <div class="source-card-body">
        <div class="source-card-thumb">${thumbHtml}</div>
        <div class="source-card-info">
          ${titleHtml}
          ${priceHtml}
          ${metaHtml}
        </div>
      </div>
      <div class="source-card-actions">
        <button class="ghost-btn source-delete-btn" data-source-key="${key}" style="font-size:12px;padding:4px 8px">Удалить</button>
      </div>
    `;
    container.appendChild(card);
  }

  // Auto-collapse add-source if sources exist
  const accordion = $("addSourceAccordion");
  if (accordion && entries.length > 0) accordion.removeAttribute("open");
}

/**
 * Client-side FIFO fallback: enrich lots and sales with computed COGS
 * when backend data has cogs_rub=0 (old data before FIFO fix).
 */
function computeFifoFallback(lots, sales) {
  // Clone lot quantities for simulation
  const lotSim = lots.map((l) => ({
    ...l,
    _simRemaining: Number(l.initial_qty || 0),
  }));
  // Sort lots by received_at ASC (FIFO)
  lotSim.sort((a, b) => (a.received_at || "").localeCompare(b.received_at || ""));
  // Sort sales by sold_at ASC (chronological)
  const sortedSales = [...sales].sort((a, b) => (a.sold_at || "").localeCompare(b.sold_at || ""));

  for (const sale of sortedSales) {
    let need = Number(sale.quantity || 0);
    if (need <= 0) continue;
    let totalCost = 0;
    for (const lot of lotSim) {
      if (need <= 0) break;
      const avail = lot._simRemaining;
      if (avail <= 0) continue;
      const take = Math.min(need, avail);
      const unitCost = Number(lot.unit_cost_rub || 0);
      totalCost += take * unitCost;
      lot._simRemaining -= take;
      need -= take;
    }
    // Tag sale with computed cost if original is zero
    if (Number(sale.cogs_rub || 0) === 0) {
      sale._computed_cogs = totalCost;
    }
  }
  // Tag lots with computed remaining
  for (let i = 0; i < lots.length; i++) {
    lots[i]._computed_remaining = lotSim[i]._simRemaining;
  }
}

function showCostBreakdownPopover(anchor, lot) {
  document.querySelectorAll(".cost-breakdown-popover").forEach(el => el.remove());
  const cost = Number(lot.unit_cost_rub || 0);
  if (!cost) return;
  const qty = Number(lot.initial_qty || 1);
  const items = [];
  if (Array.isArray(lot.allocations) && lot.allocations.length) {
    for (const a of lot.allocations) {
      if (a.allocated_rub) items.push({ label: a.name || "Распред.", value: Number(a.allocated_rub) / qty });
    }
  } else {
    items.push(
      { label: "Закупка", value: Number(lot.purchase_price_rub || 0) / qty },
      { label: "Упаковка", value: Number(lot.packaging_cost_rub || 0) / qty },
      { label: "Доставка", value: Number(lot.logistics_cost_rub || 0) / qty },
      { label: "Таможня", value: Number(lot.customs_cost_rub || 0) / qty },
      { label: "Прочее", value: Number(lot.extra_cost_rub || 0) / qty },
    );
  }
  const nonZero = items.filter(i => i.value > 0);
  if (!nonZero.length) return;

  const dark = document.documentElement.classList.contains("dark");
  const pop = document.createElement("div");
  pop.className = "cost-breakdown-popover";
  pop.style.cssText = `position:fixed;z-index:9999;background:${dark ? "#1e293b" : "#fff"};border:1px solid ${dark ? "#334155" : "#e2e8f0"};border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.15);padding:8px 0;min-width:220px;font-size:12px`;

  let html = '<div style="padding:4px 12px 6px;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8">Разбивка себестоимости</div>';
  for (const item of nonZero) {
    const pct = ((item.value / cost) * 100).toFixed(0);
    html += `<div style="padding:3px 12px;display:flex;gap:6px;align-items:center;border-top:1px solid ${dark ? "#334155" : "#f1f5f9"}">
      <span style="flex:1;color:${dark ? "#cbd5e1" : "#475569"}">${item.label}</span>
      <span style="font-weight:600;white-space:nowrap;min-width:70px;text-align:right">${formatMoney(item.value)}</span>
      <span style="color:#94a3b8;white-space:nowrap;min-width:32px;text-align:right">${pct}%</span>
    </div>`;
  }
  html += `<div style="padding:4px 12px;display:flex;gap:6px;align-items:center;border-top:2px solid ${dark ? "#475569" : "#cbd5e1"};font-weight:700">
    <span style="flex:1">Итого</span>
    <span style="white-space:nowrap;min-width:70px;text-align:right">${formatMoney(cost)}</span>
    <span style="color:#94a3b8;white-space:nowrap;min-width:32px;text-align:right">100%</span>
  </div>`;
  pop.innerHTML = html;
  document.body.appendChild(pop);

  const rect = anchor.getBoundingClientRect();
  let top = rect.bottom + 4;
  let left = rect.right - pop.offsetWidth;
  if (left < 8) left = 8;
  if (top + pop.offsetHeight > window.innerHeight - 8) top = rect.top - pop.offsetHeight - 4;
  pop.style.top = top + "px";
  pop.style.left = left + "px";
}

function renderCardPageLots(lots) {
  const tbody = cardLotsBody;
  const tfoot = $("cpLotsFoot");
  tbody.innerHTML = "";
  if (tfoot) tfoot.innerHTML = "";
  if (!Array.isArray(lots) || !lots.length) {
    tbody.innerHTML = "<tr><td colspan='6' class='muted'>Партии не найдены</td></tr>";
    return;
  }
  let totalInitial = 0, totalSold = 0, totalRemaining = 0, totalValue = 0;
  for (const lot of lots) {
    const initial = Number(lot.initial_qty || 0);
    const rem = lot._computed_remaining != null ? lot._computed_remaining : Number(lot.remaining_qty || 0);
    const sold = Math.max(0, initial - rem);
    const cost = Number(lot.unit_cost_rub || 0);
    const val = rem * cost;
    totalInitial += initial;
    totalSold += sold;
    totalRemaining += rem;
    totalValue += val;
    const hasBreakdown = Number(lot.purchase_price_rub || 0) > 0 || Number(lot.logistics_cost_rub || 0) > 0;
    const costStyle = hasBreakdown ? "text-decoration:underline dotted;text-underline-offset:3px;cursor:help" : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-4 py-2.5 text-sm">${formatDateTime(lot.received_at)}</td>
      <td class="text-right px-4 py-2.5 text-sm">${initial.toLocaleString("ru-RU")}</td>
      <td class="text-right px-4 py-2.5 text-sm text-slate-500">${sold > 0 ? sold.toLocaleString("ru-RU") : "—"}</td>
      <td class="text-right px-4 py-2.5 text-sm font-medium">${rem.toLocaleString("ru-RU")}</td>
      <td class="text-right px-4 py-2.5 text-sm"><span class="cost-cell" style="${costStyle}">${formatMoney(cost)}</span></td>
      <td class="text-right px-4 py-2.5 text-sm">${formatMoney(val)}</td>
    `;
    if (hasBreakdown) {
      const costCell = tr.querySelector(".cost-cell");
      costCell.addEventListener("mouseenter", () => showCostBreakdownPopover(costCell, lot));
      costCell.addEventListener("mouseleave", () => {
        setTimeout(() => document.querySelectorAll(".cost-breakdown-popover").forEach(el => el.remove()), 150);
      });
    }
    tbody.appendChild(tr);
  }
  if (tfoot) {
    tfoot.innerHTML = `<tr class="font-bold text-sm">
      <td class="px-4 py-2.5">Итого (${lots.length})</td>
      <td class="text-right px-4 py-2.5">${totalInitial.toLocaleString("ru-RU")}</td>
      <td class="text-right px-4 py-2.5 text-slate-500">${totalSold > 0 ? totalSold.toLocaleString("ru-RU") : ""}</td>
      <td class="text-right px-4 py-2.5">${totalRemaining.toLocaleString("ru-RU")}</td>
      <td class="text-right px-4 py-2.5"></td>
      <td class="text-right px-4 py-2.5">${formatMoney(totalValue)}</td>
    </tr>`;
  }
}

function renderCardPageLogisticsSummary() {
  const container = $("cpLogisticsSummary");
  if (!container) return;
  const matrixRow = state.matrixData.find((r) => r.master_card_id === state.cardPageId);
  if (!matrixRow) {
    container.innerHTML = '<div class="col-span-full text-sm text-slate-400">Нет данных логистики. Синхронизируйте данные в разделе Логистика.</div>';
    return;
  }
  const metrics = [
    { label: "На складе", value: matrixRow.warehouse_stock },
    { label: "На Ozon", value: matrixRow.ozon_stock },
    { label: "В доставке", value: matrixRow.delivering_qty },
    { label: "Выкуплено", value: matrixRow.purchased_qty },
    { label: "Едет на склад", value: matrixRow.returns_in_transit },
  ];
  container.innerHTML = metrics.map((m) => `
    <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
      <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">${m.label}</div>
      <div class="text-2xl font-bold text-slate-900 dark:text-white">${Number(m.value || 0).toLocaleString("ru-RU")}</div>
    </div>
  `).join("");
}

function renderCardSales(sales) {
  cardSalesBody.innerHTML = "";
  if (!Array.isArray(sales) || !sales.length) {
    cardSalesBody.innerHTML = "<tr><td colspan='6' class='muted'>Продаж пока нет</td></tr>";
    return;
  }
  for (const sale of sales) {
    const qty = Number(sale.quantity || 0);
    const cogs = Number(sale._computed_cogs || sale.cogs_rub || 0);
    const costPerUnit = qty > 0 && cogs > 0 ? cogs / qty : 0;
    const salePrice = Number(sale.unit_sale_price_rub || 0);
    const isCancelled = (sale.status || "").toLowerCase() === "cancelled";

    // Ozon economics data (from LEFT JOIN ozon_sku_economics)
    // Three cases:
    // 1. Normal sale (ue_revenue > 0): profit = ue_total - cogs
    // 2. Return/cancel (ue_revenue ≤ 0, ue_total present): profit = ue_total (no COGS — item returned)
    // 3. Only acquiring fee (ue_total small negative, no revenue/returns): show "—"
    const ueTotal = sale.ue_total != null ? Number(sale.ue_total) : null;
    const ueRevenue = sale.ue_revenue != null ? Number(sale.ue_revenue) : 0;
    const ueRetL = Number(sale.ue_return_logistics || 0);
    const ueRetP = Number(sale.ue_return_processing || 0);
    const isReturn = ueRevenue <= 0 && (ueRetL !== 0 || ueRetP !== 0);
    const isSale = ueRevenue > 0;
    const hasUE = ueTotal !== null && (isSale || isReturn);
    let profitPerUnit = 0;
    if (isSale) profitPerUnit = costPerUnit > 0 ? ueTotal - costPerUnit : ueTotal;
    else if (isReturn) profitPerUnit = ueTotal; // no COGS — item came back
    const profitCls = profitPerUnit > 0 ? "text-green-600" : profitPerUnit < 0 ? "text-red-500" : "";

    const tr = document.createElement("tr");
    if (isCancelled && !hasUE) tr.classList.add("opacity-40", "line-through");
    tr.innerHTML = `
      <td class="px-4 py-2.5 text-sm">${formatDateTime(sale.sold_at)}</td>
      <td class="px-4 py-2.5 text-sm">${sale.external_order_id || "—"}</td>
      <td class="text-right px-4 py-2.5 text-sm">${qty > 0 ? qty.toLocaleString("ru-RU") : "—"}</td>
      <td class="text-right px-4 py-2.5 text-sm">${costPerUnit > 0 ? formatMoney(costPerUnit) : "—"}</td>
      <td class="text-right px-4 py-2.5 text-sm">${salePrice > 0 ? formatMoney(salePrice) : "—"}</td>
      <td class="text-right px-4 py-2.5 text-sm ${profitCls} ${hasUE ? 'sale-profit-cell' : ''}" style="position:relative">${hasUE ? formatMoney(profitPerUnit) : "—"}</td>
    `;

    // Tooltip on profit cell with full breakdown
    if (hasUE) {
      const profitTd = tr.querySelector(".sale-profit-cell");
      const ueRev = Number(sale.ue_revenue || 0);
      const ueCom = Number(sale.ue_commission || 0);
      const ueLM = Number(sale.ue_last_mile || 0);
      const uePipe = Number(sale.ue_pipeline || 0);
      const ueFull = Number(sale.ue_fulfillment || 0);
      const ueDrop = Number(sale.ue_dropoff || 0);
      const ueAcq = Number(sale.ue_acquiring || 0);
      const ueMkt = Number(sale.ue_marketing || 0);
      const ueOth = Number(sale.ue_other_services || 0);
      const logistics = ueLM + uePipe + ueFull + ueDrop;
      const returns = ueRetL + ueRetP;
      const fmtLine = (label, val) => {
        if (Math.abs(val) < 0.005) return "";
        return `<div class="flex justify-between gap-4"><span class="text-slate-400">${label}</span><span>${formatMoney(val)}</span></div>`;
      };
      let lines = "";
      if (isReturn) {
        lines += `<div class="text-yellow-400 text-xs mb-1 font-medium">Возврат / отмена</div>`;
      }
      lines += fmtLine("Выручка Ozon", ueRev);
      lines += fmtLine("Комиссия", ueCom);
      if (Math.abs(logistics) >= 0.005) lines += fmtLine("Логистика", logistics);
      if (Math.abs(ueAcq) >= 0.005) lines += fmtLine("Эквайринг", ueAcq);
      if (Math.abs(returns) >= 0.005) lines += fmtLine("Возвр. логистика", returns);
      if (Math.abs(ueMkt) >= 0.005) lines += fmtLine("Маркетинг", ueMkt);
      if (Math.abs(ueOth) >= 0.005) lines += fmtLine("Прочее", ueOth);
      lines += `<div class="border-t border-slate-600 mt-1 pt-1 flex justify-between gap-4"><span class="text-slate-300">= Итого Ozon</span><span class="font-medium">${formatMoney(ueTotal)}</span></div>`;
      if (isSale && costPerUnit > 0) {
        lines += fmtLine("Себестоимость", -costPerUnit);
        lines += `<div class="border-t border-slate-600 mt-1 pt-1 flex justify-between gap-4 font-semibold"><span class="text-white">Прибыль</span><span class="${profitCls}">${formatMoney(profitPerUnit)}</span></div>`;
      } else if (isReturn) {
        lines += `<div class="border-t border-slate-600 mt-1 pt-1 flex justify-between gap-4 font-semibold"><span class="text-white">Убыток</span><span class="text-red-500">${formatMoney(profitPerUnit)}</span></div>`;
      }
      profitTd.addEventListener("mouseenter", (e) => {
        let tip = document.getElementById("saleProfitTip");
        if (!tip) { tip = document.createElement("div"); tip.id = "saleProfitTip"; document.body.appendChild(tip); }
        tip.className = "fixed z-50 bg-slate-800 text-white text-xs rounded-lg shadow-xl px-4 py-3 border border-slate-700 min-w-[220px]";
        tip.innerHTML = lines;
        tip.style.display = "block";
        const rect = profitTd.getBoundingClientRect();
        tip.style.left = Math.max(0, rect.left - 230) + "px";
        // Position above if tooltip would clip bottom of viewport
        const tipH = tip.offsetHeight || 180;
        const top = rect.top + tipH > window.innerHeight ? rect.bottom - tipH : rect.top;
        tip.style.top = Math.max(0, top) + "px";
      });
      profitTd.addEventListener("mouseleave", () => {
        const tip = document.getElementById("saleProfitTip");
        if (tip) tip.style.display = "none";
      });
    }

    cardSalesBody.appendChild(tr);
  }
}

/* ============================================================ */
/* Render: Orders                                               */
/* ============================================================ */
function renderOrders() {
  ordersTableBody.innerHTML = "";
  updateSortArrows("ordersTableHead", state.orderSort);
  for (const order of state.orders) {
    const tr = document.createElement("tr");
    tr.dataset.orderId = order.id;
    const isDraft = order.status === "draft";
    const actions = isDraft
      ? `<button data-action="receive" data-order-id="${order.id}" class="ghost-btn">Принять</button>
         <button data-action="edit" data-order-id="${order.id}" class="ghost-btn">Ред.</button>
         <button data-action="delete" data-order-id="${order.id}" data-order-number="${order.order_number}" class="ghost-btn danger-text">Удал.</button>`
      : `<button data-action="unreceive" data-order-id="${order.id}" class="ghost-btn danger-text">Отменить приёмку</button>`;
    tr.innerHTML = `
      <td><button class="order-expand-toggle" data-order-id="${order.id}">▶</button></td>
      <td>${order.order_number}</td>
      <td>${order.supplier_name}</td>
      <td>${order.status}</td>
      <td>${formatMoney(order.total_amount_rub)}</td>
      <td>${actions}</td>
    `;
    ordersTableBody.appendChild(tr);
  }
  if (!state.orders.length) {
    ordersTableBody.innerHTML = `<tr><td colspan="6" class="muted">Заказов пока нет</td></tr>`;
  }
}

/* ============================================================ */
/* Order detail expand                                          */
/* ============================================================ */
async function toggleOrderDetail(orderId, toggleBtn) {
  const existingRow = ordersTableBody.querySelector(`tr.order-detail-row[data-detail-for="${orderId}"]`);
  if (existingRow) {
    existingRow.remove();
    toggleBtn.classList.remove("expanded");
    return;
  }
  toggleBtn.classList.add("expanded");
  try {
    const data = await apiRequest(`/supplier-orders/${orderId}`);
    const items = data.items || [];
    const sharedCosts = data.order?.shared_costs || [];
    const isReceived = data.order?.status === "received";
    const parentRow = toggleBtn.closest("tr");
    const detailRow = document.createElement("tr");
    detailRow.className = "order-detail-row";
    detailRow.dataset.detailFor = orderId;

    let html = `<td colspan="6"><div class="order-detail-inner">`;
    if (isReceived) {
      html += `<strong>Позиции</strong><table><thead><tr>
        <th>Товар</th><th>Заказано</th><th>Принято</th><th>Себест.</th><th>Итого</th>
      </tr></thead><tbody>`;
      for (const item of items) {
        const recvQty = Number(item.received_qty ?? item.quantity ?? 0);
        const total = (Number(item.unit_cost_rub || 0) * recvQty).toFixed(2);
        html += `<tr>
          <td>${item.title || item.master_card_title || "—"}</td>
          <td>${Number(item.quantity || 0).toFixed(3)}</td>
          <td style="font-weight:600">${recvQty.toFixed(3)}</td>
          <td>${formatMoney(item.unit_cost_rub || 0)}</td>
          <td>${formatMoney(total)}</td>
        </tr>`;
      }
    } else {
      html += `<strong>Позиции</strong><table><thead><tr>
        <th>Товар</th><th>Кол-во</th><th>Себест.</th><th>Итого</th>
      </tr></thead><tbody>`;
      for (const item of items) {
        const total = (Number(item.unit_cost_rub || 0) * Number(item.quantity || 0)).toFixed(2);
        html += `<tr>
          <td>${item.title || item.master_card_title || "—"}</td>
          <td>${Number(item.quantity || 0).toFixed(3)}</td>
          <td>${formatMoney(item.unit_cost_rub || 0)}</td>
          <td>${formatMoney(total)}</td>
        </tr>`;
      }
    }
    html += `</tbody></table>`;

    if (sharedCosts.length) {
      html += `<strong style="display:block;margin-top:8px">Общие расходы</strong><table><thead><tr>
        <th>Название</th><th>Сумма</th><th>Метод</th>
      </tr></thead><tbody>`;
      const methodNames = { by_cny_price: "По цене CNY", by_volume: "По объёму", by_weight: "По весу", equal: "Равномерно" };
      for (const sc of sharedCosts) {
        html += `<tr><td>${sc.name}</td><td>${formatMoney(sc.total_rub)}</td><td>${methodNames[sc.method] || sc.method}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    if (data.order?.received_at) {
      html += `<div class="muted" style="margin-top:8px">Принят: ${formatDateTime(data.order.received_at)}</div>`;
    }
    html += `</div></td>`;
    detailRow.innerHTML = html;
    parentRow.after(detailRow);
  } catch (err) {
    toggleBtn.classList.remove("expanded");
    console.error("Failed to load order detail:", err);
  }
}

/* ============================================================ */
/* Unit Economics                                               */
/* ============================================================ */

const OZON_COST_COLS = [
  "commission", "last_mile", "pipeline", "fulfillment",
  "dropoff", "acquiring", "return_logistics", "return_processing",
  "marketing", "installment", "other_services",
];
const OZON_COL_LABELS = {
  commission: "Комис.", last_mile: "Посл.м.", pipeline: "Тр.расх", fulfillment: "Фулф.",
  dropoff: "Прим.", acquiring: "Экв.", return_logistics: "Возв.л", return_processing: "Возв.о",
  marketing: "Реклама", installment: "Расср.", other_services: "Прочее",
};
const OPS_COLS = ["orders_qty", "returns_qty", "services_ops", "other_ops"];
const OPS_COL_LABELS = { orders_qty: "Заказы", returns_qty: "Возвр.", services_ops: "Услуги", other_ops: "Прочее" };

function ozonCostSum(item) {
  return OZON_COST_COLS.reduce((s, c) => s + Number(item[c] || 0), 0);
}

function marginClass(pct) {
  if (pct > 20) return "margin-good";
  if (pct >= 0) return "margin-warn";
  return "margin-bad";
}

function calcRoi(item) {
  const absCogs = Math.abs(Number(item.cogs || 0));
  return absCogs > 0 ? Math.round((Number(item.profit || 0) / absCogs) * 100) : null;
}

function renderUeHead() {
  const thead = $("ueTableHead");
  const expanded = state.ueExpanded;
  const opsExpanded = state.ueOpsExpanded;
  const thCls = "text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500";
  const thLeftCls = "text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500";
  const thToggleCls = `${thCls} cursor-pointer select-none hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors`;

  let html = `<tr class="bg-slate-50 dark:bg-slate-800/50">
    <th class="${thLeftCls}">SKU</th>
    <th class="${thLeftCls}">Товар</th>`;

  if (opsExpanded) {
    for (const c of OPS_COLS) html += `<th class="${thCls} ue-ops-col">${OPS_COL_LABELS[c]}</th>`;
    html += `<th class="${thToggleCls} ue-ops-col" id="ueOpsCollapse" title="Свернуть">◀</th>`;
  } else {
    html += `<th id="ueOpsToggle" class="${thToggleCls}" title="Нажмите для детализации">Опер. ▶</th>`;
  }

  html += `<th class="${thCls}">Выручка</th>`;

  if (expanded) {
    for (const c of OZON_COST_COLS) {
      html += `<th class="${thCls} ue-detail-col">${OZON_COL_LABELS[c]}</th>`;
    }
  } else {
    html += `<th id="ueOzonToggle" class="${thToggleCls}" title="Нажмите для детализации">Расх. Ozon ▶</th>`;
  }

  html += `<th class="${thCls}">Себест.</th>
    <th class="${thCls}">Прибыль</th>
    <th class="${thCls}">Маржа</th>
    <th class="${thCls}">ROI</th>`;

  if (expanded) {
    html += `<th class="${thToggleCls}" id="ueOzonCollapse" title="Свернуть">◀</th>`;
  }

  html += `</tr>`;
  thead.innerHTML = html;

  // Bind toggle clicks
  const opsToggle = $("ueOpsToggle");
  if (opsToggle) opsToggle.addEventListener("click", () => { state.ueOpsExpanded = true; renderUnitEconomics(state.ueData); });
  const opsCollapse = $("ueOpsCollapse");
  if (opsCollapse) opsCollapse.addEventListener("click", () => { state.ueOpsExpanded = false; renderUnitEconomics(state.ueData); });
  const toggle = $("ueOzonToggle");
  if (toggle) toggle.addEventListener("click", () => { state.ueExpanded = true; renderUnitEconomics(state.ueData); });
  const collapse = $("ueOzonCollapse");
  if (collapse) collapse.addEventListener("click", () => { state.ueExpanded = false; renderUnitEconomics(state.ueData); });
}

function opsColVal(item, col) {
  const v = Number(item[col] || 0);
  if (col === "returns_qty") return v > 0 ? `<span style="color:#ef4444">-${v}</span>` : "—";
  if (col === "orders_qty") return v > 0 ? `<span style="color:#22c55e">${v}</span>` : "0";
  return v || "—";
}

function renderUnitEconomics(data) {
  state.ueData = data;
  const tbody = $("ueTableBody");
  const tfoot = $("ueTableFoot");
  tbody.innerHTML = "";
  tfoot.innerHTML = "";
  renderUeHead();

  const items = data?.items || [];
  const expanded = state.ueExpanded;
  const opsExpanded = state.ueOpsExpanded;
  const opsCols = opsExpanded ? OPS_COLS.length + 1 : 1;
  const ozonCols = expanded ? OZON_COST_COLS.length + 1 : 1;
  const totalCols = 2 + opsCols + 1 + ozonCols + 4;

  for (const item of items) {
    const tr = document.createElement("tr");
    if (item.master_card_id) {
      tr.dataset.cardId = item.master_card_id;
      tr.style.cursor = "pointer";
    }
    const mCls = marginClass(item.margin_pct);
    const roi = calcRoi(item);
    const roiCls = roi !== null ? marginClass(roi) : "";

    let cells = `
      <td class="px-2 py-1.5" style="font-size:12px">${item.sku}</td>
      <td class="px-2 py-1.5" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${item.product_name || ""}">${item.product_name || "—"}</td>`;

    if (opsExpanded) {
      for (const c of OPS_COLS) cells += `<td class="px-2 py-1.5 text-right ue-ops-col">${opsColVal(item, c)}</td>`;
      cells += `<td class="ue-ops-col"></td>`;
    } else {
      cells += `<td class="px-2 py-1.5 text-right">${item.operations_count}</td>`;
    }

    cells += `<td class="px-2 py-1.5 text-right">${formatMoney(item.revenue)}</td>`;

    if (expanded) {
      for (const c of OZON_COST_COLS) cells += `<td class="px-2 py-1.5 text-right ue-detail-col">${formatMoney(item[c])}</td>`;
      cells += `<td></td>`;
    } else {
      cells += `<td class="px-2 py-1.5 text-right">${formatMoney(ozonCostSum(item))}</td>`;
    }

    cells += `
      <td class="px-2 py-1.5 text-right">${formatMoney(item.cogs)}</td>
      <td class="px-2 py-1.5 text-right">${formatMoney(item.profit)}</td>
      <td class="px-2 py-1.5 text-right ${mCls}" style="font-weight:600">${item.margin_pct}%</td>
      <td class="px-2 py-1.5 text-right ${roiCls}" style="font-weight:600">${roi !== null ? roi + "%" : "—"}</td>`;

    tr.innerHTML = cells;
    tbody.appendChild(tr);
  }

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="${totalCols}" class="muted px-3 py-4">Нет данных. Нажмите «Синхронизировать» для загрузки.</td></tr>`;
    return;
  }

  const totals = data?.totals || {};
  const footTr = document.createElement("tr");
  footTr.style.fontWeight = "600";
  const tMCls = marginClass(totals.margin_pct);
  const tRoi = calcRoi(totals);
  const tRoiCls = tRoi !== null ? marginClass(tRoi) : "";

  const footColspan = 2 + opsCols;
  let footCells = `<td class="px-2 py-2" colspan="${footColspan}">ИТОГО</td>
    <td class="px-2 py-2 text-right">${formatMoney(totals.revenue)}</td>`;

  if (expanded) {
    for (const c of OZON_COST_COLS) footCells += `<td class="px-2 py-2 text-right">${formatMoney(totals[c])}</td>`;
    footCells += `<td></td>`;
  } else {
    footCells += `<td class="px-2 py-2 text-right">${formatMoney(ozonCostSum(totals))}</td>`;
  }

  footCells += `
    <td class="px-2 py-2 text-right">${formatMoney(totals.cogs)}</td>
    <td class="px-2 py-2 text-right">${formatMoney(totals.profit)}</td>
    <td class="px-2 py-2 text-right ${tMCls}">${totals.margin_pct || 0}%</td>
    <td class="px-2 py-2 text-right ${tRoiCls}">${tRoi !== null ? tRoi + "%" : "—"}</td>`;

  footTr.innerHTML = footCells;
  tfoot.appendChild(footTr);

}

/* ---- Stock Valuation Block (below UE) ---- */

function showLotPopover(anchor, lots) {
  // Remove any existing popover
  document.querySelectorAll(".lot-popover").forEach(el => el.remove());

  const pop = document.createElement("div");
  pop.className = "lot-popover";
  pop.style.cssText = "position:fixed;z-index:9999;background:var(--popover-bg,#fff);border:1px solid var(--popover-border,#e2e8f0);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.15);padding:8px 0;min-width:280px;font-size:12px";

  // Dark mode
  if (document.documentElement.classList.contains("dark")) {
    pop.style.background = "#1e293b";
    pop.style.borderColor = "#334155";
  }

  let html = '<div style="padding:4px 12px 6px;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8">Остатки по лотам (FIFO)</div>';
  for (const lot of lots) {
    const date = lot.received_at ? new Date(lot.received_at).toLocaleDateString("ru-RU") : "—";
    const orderLabel = lot.order_number || "—";
    const clickable = lot.order_id ? ` style="color:#6366f1;cursor:pointer;text-decoration:underline" data-order-id="${lot.order_id}"` : "";
    html += `<div style="padding:4px 12px;display:flex;gap:8px;align-items:center;border-top:1px solid ${document.documentElement.classList.contains("dark") ? "#334155" : "#f1f5f9"}">
      <span style="flex:1"><span${clickable}>${orderLabel}</span> <span style="color:#94a3b8;margin-left:4px">${date}</span></span>
      <span style="font-weight:600;white-space:nowrap">${lot.qty} шт</span>
      <span style="white-space:nowrap">${formatMoney(lot.unit_cost)}/шт</span>
    </div>`;
  }
  pop.innerHTML = html;

  document.body.appendChild(pop);

  // Position below anchor
  const rect = anchor.getBoundingClientRect();
  let top = rect.bottom + 4;
  let left = rect.right - pop.offsetWidth;
  if (left < 8) left = 8;
  if (top + pop.offsetHeight > window.innerHeight - 8) top = rect.top - pop.offsetHeight - 4;
  pop.style.top = top + "px";
  pop.style.left = left + "px";

  // Click order links → navigate to orders section
  pop.querySelectorAll("[data-order-id]").forEach(el => {
    el.addEventListener("click", () => {
      pop.remove();
      const orderBtn = document.querySelector('[data-section="ordersSection"]');
      if (orderBtn) orderBtn.click();
    });
  });

  // Close on outside click
  const closeHandler = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor) {
      pop.remove();
      document.removeEventListener("click", closeHandler, true);
    }
  };
  setTimeout(() => document.addEventListener("click", closeHandler, true), 0);
}

function renderStockValuation(sv, ueItems) {
  const card = $("stockValCard");
  const summary = $("stockValSummary");
  const thead = $("stockValHead");
  const tbody = $("stockValBody");
  const tfoot = $("stockValFoot");

  if (!sv || !sv.items || !sv.items.length) {
    card.innerHTML = `<div class="p-6 text-center text-sm text-slate-400">Нет данных по складу за выбранный период</div>`;
    return;
  }

  // Build UE lookup by SKU
  const ueBySku = {};
  for (const u of (ueItems || [])) {
    if (u.sku) ueBySku[u.sku] = u;
  }

  // FIFO: consume `consumed` units from oldest lots, return remaining lots
  function fifoRemaining(lots, consumed) {
    const rem = [];
    let left = consumed;
    for (const lot of lots) {
      const qty = lot.initial_qty || lot.qty || 0;
      if (left >= qty) { left -= qty; continue; }
      const r = left > 0 ? qty - left : qty;
      left = 0;
      rem.push({ ...lot, qty: r });
    }
    return rem;
  }

  // Merge rows: stock + UE, FIFO on frontend
  const rows = [];
  let totalPurchased = 0, totalStock = 0, totalStockCost = 0, totalPotential = 0;
  for (const item of sv.items) {
    const ue = ueBySku[item.sku] || {};
    const purchased = (Number(ue.orders_qty) || 0) - (Number(ue.returns_qty) || 0);
    const roi = calcRoi(ue);
    const lots = item.lots || [];
    const remaining = fifoRemaining(lots, purchased);
    const stockQty = remaining.reduce((s, l) => s + l.qty, 0);
    const stockCost = remaining.reduce((s, l) => s + l.qty * (l.unit_cost || 0), 0);
    const potential = roi !== null && stockCost > 0 ? stockCost * roi / 100 : 0;

    totalPurchased += purchased;
    totalStock += stockQty;
    totalStockCost += stockCost;
    totalPotential += potential;

    rows.push({ ...item, purchased, stockQty, roi, stockCost: Math.round(stockCost * 100) / 100, potential: Math.round(potential * 100) / 100, lots: remaining });
  }

  // Summary cards
  const cardCls = "rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-center";
  const labelCls = "text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1";
  const valCls = "text-lg font-bold text-slate-900 dark:text-white";
  const potColor = totalPotential >= 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-500 dark:text-red-400";

  summary.innerHTML = `
    <div class="${cardCls}">
      <div class="${labelCls}">Себестоимость остатка</div>
      <div class="${valCls}">${formatMoney(totalStockCost)}</div>
    </div>
    <div class="${cardCls}">
      <div class="${labelCls}">Потенциальная прибыль</div>
      <div class="${valCls} ${potColor}">${formatMoney(totalPotential)}</div>
      <div class="text-[10px] text-slate-400 mt-0.5">ROI × себестоимость остатка</div>
    </div>`;

  // Table head
  const thCls = "text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500";
  const thLeftCls = "text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500";
  thead.innerHTML = `<tr class="bg-slate-50 dark:bg-slate-800/50">
    <th class="${thLeftCls}">SKU</th>
    <th class="${thLeftCls}">Товар</th>
    <th class="${thCls}">Выкуплено</th>
    <th class="${thCls}">Остаток</th>
    <th class="${thCls}">ROI</th>
    <th class="${thCls}">С/с остатка</th>
    <th class="${thCls}">Потенц. прибыль</th>
  </tr>`;

  // Table body
  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    const roiCls = r.roi !== null ? marginClass(r.roi) : "";
    const pCls = r.potential >= 0 ? "margin-good" : "margin-bad";
    const hasLots = r.lots.length > 0;

    let costCellClass = "px-2 py-1.5 text-right";
    if (hasLots) costCellClass += " cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors";
    const costCellAttr = hasLots ? ' style="text-decoration:underline dotted;text-underline-offset:3px"' : "";

    tr.innerHTML = `
      <td class="px-2 py-1.5" style="font-size:12px">${r.sku}</td>
      <td class="px-2 py-1.5" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.product_name || ""}">${r.product_name || "—"}</td>
      <td class="px-2 py-1.5 text-right">${r.purchased}</td>
      <td class="px-2 py-1.5 text-right font-semibold">${r.stockQty}</td>
      <td class="px-2 py-1.5 text-right ${roiCls}" style="font-weight:600">${r.roi !== null ? r.roi + "%" : "—"}</td>
      <td class="${costCellClass}" data-lots='${JSON.stringify(r.lots).replace(/'/g, "&#39;")}'${costCellAttr}>${formatMoney(r.stockCost)}</td>
      <td class="px-2 py-1.5 text-right ${pCls}" style="font-weight:600">${formatMoney(r.potential)}</td>`;

    if (hasLots) {
      const costCell = tr.querySelectorAll("td")[5];
      costCell.addEventListener("click", (e) => {
        e.stopPropagation();
        showLotPopover(costCell, r.lots);
      });
    }
    tbody.appendChild(tr);
  }

  // Table footer
  const footTr = document.createElement("tr");
  footTr.style.fontWeight = "600";
  const ftPCls = totalPotential >= 0 ? "margin-good" : "margin-bad";
  footTr.innerHTML = `
    <td class="px-2 py-2" colspan="2">ИТОГО</td>
    <td class="px-2 py-2 text-right">${totalPurchased}</td>
    <td class="px-2 py-2 text-right">${totalStock}</td>
    <td class="px-2 py-2"></td>
    <td class="px-2 py-2 text-right">${formatMoney(totalStockCost)}</td>
    <td class="px-2 py-2 text-right ${ftPCls}">${formatMoney(totalPotential)}</td>`;
  tfoot.innerHTML = "";
  tfoot.appendChild(footTr);
}

function _localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getUeDates() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const fromEl = $("ueDateFrom");
  const toEl = $("ueDateTo");
  if (!fromEl.value) fromEl.value = _localDateStr(firstDay);
  if (!toEl.value) toEl.value = _localDateStr(today);
  return { from: fromEl.value, to: toEl.value };
}

async function syncAndLoadUnitEconomics() {
  const { from, to } = getUeDates();
  try {
    await apiRequest("/ozon/sync/unit-economics", {
      method: "POST",
      body: { date_from: from, date_to: to, limit: 1000, max_pages: 50 },
    });
  } catch (_) { /* sync best-effort */ }
  const data = await apiRequest(`/reports/unit-economics?date_from=${from}&date_to=${to}`);
  renderUnitEconomics(data);
  renderStockValuation(data?.stock_valuation, data?.items);
}

async function loadUnitEconomics() {
  const { from, to } = getUeDates();
  const data = await apiRequest(`/reports/unit-economics?date_from=${from}&date_to=${to}`);
  renderUnitEconomics(data);
  renderStockValuation(data?.stock_valuation, data?.items);
}

function reloadAnalytics() {
  loadUnitEconomics();
  loadPnlOzon();
}

/* ============================================================ */
/* P&L Report                                                   */
/* ============================================================ */

const PNL_EXPENSE_LABELS = {
  commission: "Комиссия Ozon",
  logistics: "Логистика",
  fbo: "Услуги FBO",
  acquiring: "Эквайринг",
  marketing: "Реклама",
  returns: "Возвраты",
  other: "Прочее",
};

function renderPnl(data) {
  state.pnlData = data;
  const container = $("pnlBody");
  if (!data || data.error) {
    container.innerHTML = `<p class="text-sm text-red-400">${data?.error || "Ошибка загрузки P&L"}</p>`;
    return;
  }
  const inc = data.income || {};
  const exp = data.ozon_expenses || {};
  const netIncome = Number(inc.net_income || 0);
  const pct = (v) => netIncome ? `(${(Math.abs(v) / netIncome * 100).toFixed(1)}%)` : "";
  const mCls = data.margin_pct > 20 ? "margin-good" : data.margin_pct >= 0 ? "margin-warn" : "margin-bad";

  // Helpers
  const row = (label, value, hint = "", cls = "") =>
    `<div class="flex justify-between py-1 ${cls}">
      <span class="text-slate-600 dark:text-slate-400">${label}</span>
      <span class="font-medium tabular-nums ${Number(value) < 0 ? "text-red-500" : ""}">
        ${formatMoney(value)}${hint ? ` <span class="text-slate-400 text-[10px] ml-1">${hint}</span>` : ""}
      </span>
    </div>`;
  const divider = `<div class="border-t border-slate-200 dark:border-slate-700 my-2"></div>`;
  const boldRow = (label, value, cls = "") =>
    `<div class="flex justify-between py-1.5 ${cls}">
      <span class="font-semibold text-slate-800 dark:text-slate-200">${label}</span>
      <span class="font-bold tabular-nums ${Number(value) < 0 ? "text-red-500" : "text-green-600"}">${formatMoney(value)}</span>
    </div>`;

  const chevron = `<svg class="w-3.5 h-3.5 text-slate-400 transition-transform group-open:rotate-90 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>`;

  // Returns netting hints
  const retHint = (salesVal, retVal) => {
    const s = Number(salesVal || 0), r = Number(retVal || 0);
    if (!r) return "";
    return `${formatMoney(s)} − ${formatMoney(Math.abs(r))} возвр.`;
  };

  // Net income sub-lines
  const netRevenue = Number(inc.revenue || 0) + Number(inc.returns_revenue || 0);
  const netPoints = Number(inc.points_for_discounts || 0) + Number(inc.returns_points || 0);
  const netPartner = Number(inc.partner_programs || 0) + Number(inc.returns_partner || 0);
  const manualIncome = Number(data.manual_income || 0);
  const manualExpense = Number(data.manual_expense || 0);

  // Services detail grouped
  const svcDetail = data.services_detail || [];
  const svcByGroup = {};
  for (const s of svcDetail) {
    if (!svcByGroup[s.group]) svcByGroup[s.group] = [];
    svcByGroup[s.group].push(s);
  }

  // Total expenses
  const totalExpenses = Math.abs(Number(exp.total || 0)) + Number(data.cogs || 0) + manualExpense + Number(data.tax_usn || 0);

  // Sub-chevron for nested groups
  const subChevron = `<svg class="w-3 h-3 text-slate-400 transition-transform group-open/sub:rotate-90 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>`;

  let html = `<div class="text-sm space-y-1">`;

  // === INCOME ===
  let incChildren = "";
  incChildren += row("Выручка", netRevenue, retHint(inc.revenue, inc.returns_revenue));
  incChildren += row("Баллы за скидки", netPoints, retHint(inc.points_for_discounts, inc.returns_points));
  if (netPartner) incChildren += row("Программы партнёров", netPartner, retHint(inc.partner_programs, inc.returns_partner));
  const manualIncomeDetail = data.manual_income_detail || [];
  if (manualIncome) {
    if (manualIncomeDetail.length > 1) {
      let mSubItems = "";
      for (const d of manualIncomeDetail) mSubItems += row(financeCategoryLabel(d.category), d.amount);
      incChildren += `<details class="group/sub">
        <summary class="flex items-center gap-1.5 cursor-pointer select-none py-1">
          ${subChevron}
          <span class="text-slate-600 dark:text-slate-400 flex-1">Ручные доходы</span>
          <span class="font-medium tabular-nums">${formatMoney(manualIncome)}</span>
        </summary>
        <div class="pl-5 text-xs space-y-0.5">${mSubItems}</div>
      </details>`;
    } else {
      const lbl = manualIncomeDetail.length === 1 ? `Ручные доходы (${financeCategoryLabel(manualIncomeDetail[0].category)})` : "Ручные доходы";
      incChildren += row(lbl, manualIncome);
    }
  }

  html += `<details class="group bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg px-3 py-1">
    <summary class="flex items-center gap-1.5 cursor-pointer select-none py-1.5">
      ${chevron}
      <span class="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex-1">Доходы</span>
      <span class="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">${formatMoney(netIncome)}</span>
    </summary>
    <div class="pl-5 space-y-0.5 pb-1">${incChildren}</div>
  </details>`;

  // === ALL EXPENSES (unified) ===
  let allExpChildren = "";

  // Ozon expenses sub-group
  let ozonSubItems = "";
  for (const [key, label] of Object.entries(PNL_EXPENSE_LABELS)) {
    const val = Number(exp[key] || 0);
    if (!val) continue;
    const groupSvcs = svcByGroup[key] || [];
    if (groupSvcs.length > 1) {
      let svcItems = "";
      for (const s of groupSvcs) svcItems += row(s.name, s.amount);
      ozonSubItems += `<details class="group/sub">
        <summary class="flex items-center gap-1.5 cursor-pointer select-none py-1">
          ${subChevron}
          <span class="text-slate-600 dark:text-slate-400 flex-1">${label}</span>
          <span class="font-medium tabular-nums text-red-500">${formatMoney(val)} <span class="text-slate-400 text-[10px] ml-1">${pct(val)}</span></span>
        </summary>
        <div class="pl-5 text-xs space-y-0.5">${svcItems}</div>
      </details>`;
    } else {
      ozonSubItems += row(label, val, pct(val));
    }
  }
  allExpChildren += `<details class="group/sub">
    <summary class="flex items-center gap-1.5 cursor-pointer select-none py-1">
      ${subChevron}
      <span class="text-slate-600 dark:text-slate-400 flex-1">Расходы Ozon</span>
      <span class="font-medium tabular-nums text-red-500">${formatMoney(exp.total)} <span class="text-slate-400 text-[10px] ml-1">${pct(Math.abs(exp.total))}</span></span>
    </summary>
    <div class="pl-5 space-y-0.5">${ozonSubItems}</div>
  </details>`;

  // COGS
  allExpChildren += row("Себестоимость (FIFO)", -data.cogs, pct(data.cogs));

  // Manual expenses
  const manualExpenseDetail = data.manual_expense_detail || [];
  if (manualExpense) {
    if (manualExpenseDetail.length > 1) {
      let meSubItems = "";
      for (const d of manualExpenseDetail) meSubItems += row(financeCategoryLabel(d.category), -d.amount, pct(d.amount));
      allExpChildren += `<details class="group/sub">
        <summary class="flex items-center gap-1.5 cursor-pointer select-none py-1">
          ${subChevron}
          <span class="text-slate-600 dark:text-slate-400 flex-1">Ручные расходы</span>
          <span class="font-medium tabular-nums text-red-500">${formatMoney(-manualExpense)} <span class="text-slate-400 text-[10px] ml-1">${pct(manualExpense)}</span></span>
        </summary>
        <div class="pl-5 text-xs space-y-0.5">${meSubItems}</div>
      </details>`;
    } else {
      const lbl = manualExpenseDetail.length === 1 ? `Ручные расходы (${financeCategoryLabel(manualExpenseDetail[0].category)})` : "Ручные расходы";
      allExpChildren += row(lbl, -manualExpense, pct(manualExpense));
    }
  }

  // Tax
  const taxLabel = `Налог УСН ${data.usn_rate || 7}%`;
  const taxBase = data.taxable_revenue != null ? data.taxable_revenue : inc.revenue;
  const taxNote = `${data.usn_rate || 7}% × ${formatMoney(taxBase)}`;
  allExpChildren += row(taxLabel, -data.tax_usn);
  allExpChildren += `<div class="text-[10px] text-slate-400 pl-4 -mt-1 pb-1">${taxNote}</div>`;

  html += `<details class="group bg-red-50/50 dark:bg-red-950/20 rounded-lg px-3 py-1">
    <summary class="flex items-center gap-1.5 cursor-pointer select-none py-1.5">
      ${chevron}
      <span class="text-xs font-semibold uppercase tracking-wider text-red-500 dark:text-red-400 flex-1">Расходы</span>
      <span class="font-semibold tabular-nums text-red-500">${formatMoney(-totalExpenses)}</span>
    </summary>
    <div class="pl-5 space-y-0.5 pb-1">${allExpChildren}</div>
  </details>`;

  // === DOUBLE DIVIDER ===
  html += `<div class="border-t-2 border-slate-300 dark:border-slate-600 my-3"></div>`;

  // === NET PROFIT ===
  html += boldRow("Чистая прибыль", data.net_profit);
  html += `<div class="flex justify-between py-0.5">
    <span class="text-slate-500 text-xs">Маржа</span>
    <span class="font-semibold text-xs ${mCls}">${data.margin_pct}%</span>
  </div>`;

  html += `</div>`;
  container.innerHTML = html;
}

async function loadPnlOzon() {
  const { from, to } = getUeDates();
  try {
    const data = await apiRequest("/reports/pnl-ozon", {
      method: "POST",
      body: { date_from: from, date_to: to },
    });
    renderPnl(data);
  } catch (err) {
    renderPnl({ error: err.message });
  }
}

async function loadAdminSettings() {
  try {
    const s = await apiRequest("/settings");
    const input = $("usnRateInput");
    if (input && s.usn_rate != null) input.value = s.usn_rate;
  } catch (_) { /* ignore */ }
}

async function saveUsnRate() {
  const input = $("usnRateInput");
  const val = parseFloat(input.value);
  if (isNaN(val) || val < 0 || val > 100) return;
  try {
    await apiRequest("/settings", { method: "PUT", body: { usn_rate: val } });
    $("saveUsnBtn").classList.add("hidden");
    await loadPnlOzon();
  } catch (err) {
    showToast("Ошибка: " + err.message, "error");
  }
}

/* ============================================================ */
/* Multi-item order form                                        */
/* ============================================================ */
let orderItemCounter = 0;

function buildCardOptions() {
  return state.cards.map((c) => `<option value="${c.id}">${c.sku || "NO-SKU"} — ${c.title}</option>`).join("");
}

function addOrderItemRow() {
  const id = ++orderItemCounter;
  const container = $("orderItemsContainer");
  const row = document.createElement("div");
  row.className = "order-item-row";
  row.dataset.rowId = id;
  row.innerHTML = `
    <label class="field-label">Товар<select class="oi-card" data-row="${id}">${buildCardOptions()}</select></label>
    <label class="field-label">Кол-во<input class="oi-qty" type="number" step="0.001" min="0.001" value="1" /></label>
    <label class="field-label">CNY/шт<input class="oi-cny" type="number" step="0.01" min="0" value="0" /></label>
    <label class="field-label">Накл. расх. ₽<input class="oi-individual" type="number" step="0.01" min="0" value="0" /></label>
    <button type="button" class="remove-row-btn" data-remove-item="${id}">&times;</button>
  `;
  container.appendChild(row);
  autoFillCny(row);
  recalcOrderTotal();
}

function autoFillCny(row) {
  const select = row.querySelector(".oi-card");
  const cnyInput = row.querySelector(".oi-cny");
  const cardId = select.value;
  const card = state.cards.find((c) => c.id === cardId);
  if (card) {
    const cny = getCardCnyPrice(card);
    if (cny > 0) cnyInput.value = cny;
  }
}

function removeOrderItemRow(rowId) {
  const row = $("orderItemsContainer").querySelector(`[data-row-id="${rowId}"]`);
  if (row && $("orderItemsContainer").children.length > 1) {
    row.remove();
    recalcOrderTotal();
  }
}

let sharedCostCounter = 0;

function addSharedCostRow() {
  const id = ++sharedCostCounter;
  const container = $("sharedCostsContainer");
  const row = document.createElement("div");
  row.className = "shared-cost-row";
  row.dataset.rowId = id;
  row.innerHTML = `
    <label class="field-label">Название<input class="sc-name" placeholder="Закупка товара" /></label>
    <label class="field-label">Сумма ₽<input class="sc-amount" type="number" step="0.01" min="0" value="0" /></label>
    <label class="field-label">Распределить по
      <select class="sc-method">
        <option value="by_cny_price">Цена CNY</option>
        <option value="by_volume">Объём</option>
        <option value="by_weight">Вес</option>
        <option value="equal">Равномерно</option>
      </select>
    </label>
    <button type="button" class="remove-row-btn" data-remove-cost="${id}">&times;</button>
  `;
  container.appendChild(row);
  recalcOrderTotal();
}

function removeSharedCostRow(rowId) {
  const row = $("sharedCostsContainer").querySelector(`[data-row-id="${rowId}"]`);
  if (row) { row.remove(); recalcOrderTotal(); }
}

function collectOrderItems() {
  const items = [];
  for (const row of $("orderItemsContainer").children) {
    items.push({
      master_card_id: row.querySelector(".oi-card")?.value || null,
      quantity: Number(row.querySelector(".oi-qty")?.value || 0),
      cny_price_per_unit: Number(row.querySelector(".oi-cny")?.value || 0),
      individual_cost_rub: Number(row.querySelector(".oi-individual")?.value || 0),
    });
  }
  return items;
}

function collectSharedCosts() {
  const costs = [];
  for (const row of $("sharedCostsContainer").children) {
    const name = row.querySelector(".sc-name")?.value?.trim();
    const amount = Number(row.querySelector(".sc-amount")?.value || 0);
    const method = row.querySelector(".sc-method")?.value || "equal";
    if (name && amount > 0) costs.push({ name, total_rub: amount, method });
  }
  return costs;
}

function allocateSharedCosts(items, sharedCosts) {
  const allocations = items.map(() => ({}));
  for (const sc of sharedCosts) {
    const weights = items.map((item) => {
      if (sc.method === "by_cny_price") return item.cny_price_per_unit * item.quantity;
      if (sc.method === "by_volume") {
        const card = state.cards.find((c) => c.id === item.master_card_id);
        return card ? getCardVolume(card) * item.quantity : 0;
      }
      if (sc.method === "by_weight") {
        const card = state.cards.find((c) => c.id === item.master_card_id);
        return card ? getCardWeight(card) * item.quantity : 0;
      }
      return item.quantity;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const useEqual = totalWeight === 0;
    items.forEach((_, i) => {
      const share = useEqual ? sc.total_rub / items.length : (weights[i] / totalWeight) * sc.total_rub;
      allocations[i][sc.name] = Math.round(share * 100) / 100;
    });
  }
  return allocations;
}

function recalcOrderTotal() {
  const items = collectOrderItems();
  const sharedCosts = collectSharedCosts();
  const allocations = allocateSharedCosts(items, sharedCosts);
  let grandTotal = 0;
  items.forEach((item, i) => {
    const allocated = Object.values(allocations[i]).reduce((a, b) => a + b, 0);
    grandTotal += allocated + item.individual_cost_rub;
  });
  $("orderTotalDisplay").textContent = `Итого: ${formatMoney(grandTotal)}`;
  renderAllocationPreview(items, sharedCosts, allocations);
}

function renderAllocationPreview(items, sharedCosts, allocations) {
  const thead = $("allocationPreviewHead");
  const tbody = $("allocationPreviewBody");
  thead.innerHTML = "";
  tbody.innerHTML = "";
  if (!items.length || !sharedCosts.length) return;

  let headerHtml = "<tr><th>Товар</th>";
  for (const sc of sharedCosts) headerHtml += `<th>${sc.name}</th>`;
  headerHtml += "<th>Накл.</th><th>Итого</th><th>Итого/шт</th></tr>";
  thead.innerHTML = headerHtml;

  items.forEach((item, i) => {
    const card = state.cards.find((c) => c.id === item.master_card_id);
    const name = card ? (card.sku || card.title) : "—";
    let rowHtml = `<tr><td>${name}</td>`;
    let total = 0;
    for (const sc of sharedCosts) {
      const val = allocations[i][sc.name] || 0;
      total += val;
      rowHtml += `<td>${formatMoney(val)}</td>`;
    }
    total += item.individual_cost_rub;
    const perUnit = item.quantity > 0 ? total / item.quantity : 0;
    rowHtml += `<td>${formatMoney(item.individual_cost_rub)}</td>`;
    rowHtml += `<td>${formatMoney(total)}</td>`;
    rowHtml += `<td>${formatMoney(perUnit)}</td></tr>`;
    tbody.innerHTML += rowHtml;
  });
}

/* ============================================================ */
/* Edit order                                                   */
/* ============================================================ */
async function startEditOrder(orderId) {
  const data = await apiRequest(`/supplier-orders/${orderId}`);
  const order = data.order;
  const items = data.items || [];

  state.editingOrderId = orderId;
  $("orderSubmitBtn").textContent = "Сохранить изменения";
  $("cancelEditBtn").style.display = "";

  $("orderSupplier").value = order.supplier_name || "";
  $("orderDate").value = order.order_date || "";
  $("orderNotes").value = order.notes || "";

  // Populate items
  $("orderItemsContainer").innerHTML = "";
  orderItemCounter = 0;
  for (const item of items) {
    addOrderItemRow();
    const row = $("orderItemsContainer").lastElementChild;
    const cardSelect = row.querySelector(".oi-card");
    if (item.master_card_id) cardSelect.value = item.master_card_id;
    row.querySelector(".oi-qty").value = item.quantity || 1;
    row.querySelector(".oi-cny").value = item.cny_price_per_unit || 0;
    row.querySelector(".oi-individual").value = item.individual_cost_rub || 0;
  }
  if (!items.length) addOrderItemRow();

  // Populate shared costs
  $("sharedCostsContainer").innerHTML = "";
  sharedCostCounter = 0;
  const sharedCosts = typeof order.shared_costs === "string" ? JSON.parse(order.shared_costs) : order.shared_costs || [];
  for (const sc of sharedCosts) {
    addSharedCostRow();
    const row = $("sharedCostsContainer").lastElementChild;
    row.querySelector(".sc-name").value = sc.name || "";
    row.querySelector(".sc-amount").value = sc.total_rub || 0;
    row.querySelector(".sc-method").value = sc.method || "equal";
  }

  recalcOrderTotal();
  orderDrawerTitle.textContent = "Редактирование заказа";
  openDrawer(orderDrawerBackdrop, orderDrawerPanel);
}

function resetOrderForm() {
  state.editingOrderId = null;
  $("orderSubmitBtn").textContent = "Создать заказ";
  $("cancelEditBtn").style.display = "none";
  $("orderForm").reset();
  $("orderItemsContainer").innerHTML = "";
  $("sharedCostsContainer").innerHTML = "";
  orderItemCounter = 0;
  sharedCostCounter = 0;
  addOrderItemRow();
  recalcOrderTotal();
}

function cancelEditOrder() {
  resetOrderForm();
  closeDrawer(orderDrawerBackdrop, orderDrawerPanel);
}

/* ============================================================ */
/* Data loading                                                 */
/* ============================================================ */
async function loadCards() {
  const params = new URLSearchParams({ limit: "200" });
  if (state.showArchived) params.set("include_archived", "true");
  if (state.searchQuery) params.set("q", state.searchQuery);
  params.set("sort", `${state.cardSort.field}:${state.cardSort.dir}`);
  const data = await apiRequest(`/master-cards?${params}`);
  state.cards = data.items || [];
  renderCards();
}

async function loadOrders() {
  const params = new URLSearchParams({ limit: "200" });
  if (state.orderSearchQuery) params.set("q", state.orderSearchQuery);
  params.set("sort", `${state.orderSort.field}:${state.orderSort.dir}`);
  const data = await apiRequest(`/supplier-orders?${params}`);
  state.orders = data.items || [];
  renderOrders();
}

async function loadCurrentUser() {
  const data = await apiRequest("/auth/me");
  state.user = data.user;
  currentUser.textContent = `${state.user.username}${state.user.is_admin ? " (admin)" : ""}`;
}

async function loadOzonIntegration() {
  try {
    const data = await apiRequest("/integrations/ozon");
    if (data.has_credentials) {
      ozonBadge.textContent = "Подключено";
      ozonBadge.className = "badge badge-success";
      showMessage(ozonCredsStatus, `Креды: ${data.client_id_masked || "client_id"}, ${data.api_key_masked || "api_key"}`);
      ozonClientIdInput.placeholder = data.client_id_masked || "Сохранён";
      ozonApiKeyInput.placeholder = data.api_key_masked || "Сохранён";
    } else {
      ozonBadge.textContent = "Не настроено";
      ozonBadge.className = "badge badge-warning";
      openModal(ozonModal);
      showMessage(ozonCredsStatus, "Добавьте креды Ozon для синка и импорта.");
    }
  } catch (error) {
    ozonBadge.textContent = "Ошибка";
    ozonBadge.className = "badge badge-muted";
    showMessage(ozonCredsStatus, `Ошибка: ${error.message}`, true);
  }
}

async function openCard(cardId) {
  // If already on card page, force-reload; otherwise navigate
  if (state.cardPageId === cardId) {
    state.cardPageId = null; // force re-fetch
    await loadCardPage(cardId);
  } else {
    navigateToCard(cardId);
  }
}

/* ============================================================ */
/* Plugin System                                                */
/* ============================================================ */
const _pluginContributions = { cardTabs: [] };
const _pluginModules = {};
const _pluginManifests = [];

window.PluginHost = Object.freeze({
  apiRequest,
  esc,
  formatMoney,
  formatDate: typeof formatDateTime !== "undefined" ? formatDateTime : (d) => d,
  showToast,
  getState: () => ({ ...state }),
  getCardDetail: () => state.selectedCardDetail,
  registerCardTabRenderer(tabId, renderFn) {
    const existing = _pluginContributions.cardTabs.find(t => t.id === tabId);
    if (existing) existing.renderFn = renderFn;
  },
});

async function loadPlugins() {
  try {
    const data = await apiRequest("/plugins");
    const plugins = data?.plugins || [];
    _pluginManifests.length = 0;
    _pluginManifests.push(...plugins);
    const disabled = JSON.parse(localStorage.getItem("_mpflow_disabled_plugins") || "[]");
    plugins.filter(p => !disabled.includes(p.name)).forEach(p => {
      (p.contributes?.cardTabs || []).forEach(tab => {
        if (!_pluginContributions.cardTabs.find(t => t.id === tab.id)) {
          _pluginContributions.cardTabs.push({
            id: tab.id,
            label: tab.label,
            pluginName: p.name,
            renderFn: null,
          });
        }
      });
    });
    console.log("[plugins] Loaded", plugins.length, "plugin(s):", plugins.map(p => p.name).join(", "));
  } catch (e) {
    console.warn("[plugins] Failed to load plugins:", e.message);
  }
}

async function activatePlugin(pluginName) {
  if (_pluginModules[pluginName]) return;
  const manifest = _pluginManifests.find(p => p.name === pluginName);
  if (!manifest?.frontend?.main) return;
  try {
    const url = `./plugins/${pluginName}/${manifest.frontend.main}`;
    const mod = await import(url);
    _pluginModules[pluginName] = mod;
    if (mod.activate) mod.activate(window.PluginHost);
    console.log("[plugins] Activated plugin:", pluginName);
  } catch (e) {
    console.error("[plugins] Failed to activate", pluginName, ":", e);
  }
}

function injectPluginCardTabs() {
  const tabBar = $("cardPageTabBar");
  const panesContainer = $("pluginCardTabPanes");
  if (!tabBar || !panesContainer) return;

  // Remove previously injected plugin tabs
  tabBar.querySelectorAll(".plugin-card-tab").forEach(el => el.remove());
  panesContainer.innerHTML = "";

  for (const tab of _pluginContributions.cardTabs) {
    // Add tab button
    const btn = document.createElement("button");
    btn.className = "card-page-tab plugin-card-tab";
    btn.dataset.tab = tab.id;
    btn.textContent = tab.label;
    btn.addEventListener("click", async () => {
      switchCardPageTab(tab.id);
      await activatePlugin(tab.pluginName);
      // Render plugin content
      const pane = $(tab.id);
      if (pane && tab.renderFn) {
        await tab.renderFn(pane, state.selectedCardDetail);
      }
    });
    tabBar.appendChild(btn);

    // Add tab pane container
    const pane = document.createElement("div");
    pane.id = tab.id;
    pane.className = "card-tab-pane hidden space-y-4 p-4";
    pane.innerHTML = '<div class="text-sm text-slate-400">Загрузка...</div>';
    panesContainer.appendChild(pane);
  }
}

function renderPluginsSection() {
  const container = $("pluginsList");
  if (!container) return;
  const disabled = JSON.parse(localStorage.getItem("_mpflow_disabled_plugins") || "[]");
  if (!_pluginManifests.length) {
    container.innerHTML = '<p class="text-sm text-slate-500">Нет установленных плагинов</p>';
    return;
  }
  container.innerHTML = _pluginManifests.map(p => {
    const isDisabled = disabled.includes(p.name);
    const tabs = (p.contributes?.cardTabs || []).map(t => t.label).join(", ");
    return `
      <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
        <div class="flex items-center justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="text-base font-semibold text-slate-900 dark:text-white">${esc(p.title || p.name)}</h3>
              <span class="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">${esc(p.version || "")}</span>
            </div>
            <p class="text-sm text-slate-500 mt-1">${esc(p.description || "")}</p>
            ${tabs ? `<p class="text-xs text-slate-400 mt-2">Card tabs: ${esc(tabs)}</p>` : ""}
            ${p.provides_kinds?.length ? `<p class="text-xs text-slate-400 mt-1">Provides: ${esc(p.provides_kinds.join(", "))}</p>` : ""}
          </div>
          <label class="relative inline-flex items-center cursor-pointer flex-shrink-0">
            <input type="checkbox" class="sr-only peer" data-plugin="${esc(p.name)}" ${isDisabled ? "" : "checked"} onchange="togglePlugin(this)">
            <div class="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>
      </div>`;
  }).join("");
}

window.togglePlugin = function(el) {
  const name = el.dataset.plugin;
  const disabled = JSON.parse(localStorage.getItem("_mpflow_disabled_plugins") || "[]");
  if (el.checked) {
    const idx = disabled.indexOf(name);
    if (idx !== -1) disabled.splice(idx, 1);
  } else {
    if (!disabled.includes(name)) disabled.push(name);
  }
  localStorage.setItem("_mpflow_disabled_plugins", JSON.stringify(disabled));
  showToast(el.checked ? `Плагин "${name}" включён` : `Плагин "${name}" отключён. Перезагрузите для применения.`);
};

async function bootstrapApp() {
  await loadCurrentUser();
  getUeDates(); // set default date inputs
  await Promise.all([loadCards(), loadOrders(), loadUnitEconomics(), loadPnlOzon(), loadOzonIntegration(), loadAdminSettings(), loadMatrix(), loadSyncFreshness(), loadPlugins()]);
  updateAllFreshnessLabels();
  switchAnalyticsTab("economy");
}

async function logout() {
  state.user = null;
  state.selectedCard = null;
  state.selectedCardDetail = null;
  _hmacToken = null;
  localStorage.removeItem("_mpflow_token");
  setLoginMode(true);
}

async function refreshAfterMutations({ reloadCards = false } = {}) {
  if (reloadCards) await loadCards();
}

/* ============================================================ */
/* Event listeners                                              */
/* ============================================================ */

// Auth — password login
$("passwordLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const username = $("loginUsername").value.trim();
  const password = $("loginPassword").value;
  if (!username || !password) { loginError.textContent = "Заполните все поля"; return; }
  try {
    const resp = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      loginError.textContent = data?.detail || "Ошибка авторизации";
      return;
    }
    _hmacToken = data.access_token;
    localStorage.setItem("_mpflow_token", _hmacToken);
    setLoginMode(false);
    setActiveSection(sectionFromHash());
    await bootstrapApp();
  } catch (err) {
    loginError.textContent = err.message || "Ошибка соединения";
  }
});

$("logoutBtn").addEventListener("click", () => { logout(); });

// Navigation
document.querySelectorAll(".menu-item").forEach((btn) => {
  btn.addEventListener("click", () => setActiveSection(btn.dataset.section));
});

// Search (server-side with debounce)
let cardSearchTimer = null;
$("cardsSearchInput").addEventListener("input", (e) => {
  state.searchQuery = e.target.value.trim();
  clearTimeout(cardSearchTimer);
  cardSearchTimer = setTimeout(() => loadCards(), 300);
});

// Sort
$("cardsTableHead").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-sort]");
  if (!th) return;
  toggleSort(state.cardSort, th.dataset.sort);
  loadCards();
});

// Create card (unified form)
$("createCardForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    title: $("createCardTitle").value.trim(),
    sku: $("createCardSku").value.trim() || null,
    ozon_offer_id: $("createCardOffer").value.trim() || null,
    brand: $("createCardBrand")?.value.trim() || null,
    description: $("createCardDescription")?.value.trim() || null,
  };
  await apiRequest("/master-cards", { method: "POST", body: payload });
  e.target.reset();
  closeDrawer(createCardDrawerBackdrop, createCardDrawerPanel);
  showToast("Карточка создана", "success");
  await loadCards();
});

$("reloadCardsBtn").addEventListener("click", loadCards);

$("showArchivedToggle").addEventListener("change", (e) => {
  state.showArchived = e.target.checked;
  loadCards();
});

// Card table clicks — row click navigates to card page
cardsTableBody.addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-card-id]");
  if (!row) return;
  navigateToCard(row.dataset.cardId);
});

// Card page back button
$("cardPageBackBtn").addEventListener("click", navigateBack);

// Card page tab switching
document.querySelectorAll(".card-page-tab").forEach((btn) => {
  btn.addEventListener("click", () => switchCardPageTab(btn.dataset.tab));
});

// Archive / restore card
$("archiveCardBtn").addEventListener("click", async () => {
  if (!state.selectedCardDetail?.item?.id) return;
  const cardId = state.selectedCardDetail.item.id;
  const newStatus = state.selectedCardDetail.item.status === "archived" ? "active" : "archived";
  const btn = $("archiveCardBtn");
  btn.disabled = true;
  try {
    await apiRequest(`/master-cards/${cardId}`, { method: "PATCH", body: { status: newStatus } });
    await loadCards();
    await openCard(cardId);
  } catch (err) {
    showMessage(cardDetailStatus, `Ошибка: ${err.message}`, true);
  } finally {
    btn.disabled = false;
  }
});

// Save card detail
$("cardDetailForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.selectedCardDetail?.item?.id) return;
  const cardId = state.selectedCardDetail.item.id;
  const attrs = getCardAttributes(state.selectedCardDetail.item);
  const dims = readDimensionInputs();
  if (!validateRequiredDimensions(dims)) {
    showMessage(cardDetailStatus, "Заполните обязательные размеры.", true);
    return;
  }
  attrs.dimensions = { ...(attrs.dimensions || {}), ...Object.fromEntries(Object.entries(dims).filter(([, v]) => v !== null)) };
  for (const k of ["length_cm", "width_cm", "height_cm", "weight_kg"]) delete attrs.dimensions[k];
  // Purchase price
  const ppVal = parseFloat(fieldPurchasePrice.value);
  if (Number.isFinite(ppVal) && ppVal > 0) {
    attrs.purchase = { price: ppVal, currency: fieldPurchaseCurrency.value || "CNY" };
  } else {
    delete attrs.purchase;
  }
  const payload = {
    sku: fieldSku.value.trim() || null, title: fieldTitle.value.trim(),
    brand: fieldBrand.value.trim() || null, status: fieldStatus.value.trim() || "draft",
    ozon_product_id: fieldOzonProduct.value.trim() || null, ozon_offer_id: fieldOzonOffer.value.trim() || null,
    description: fieldDescription.value.trim() || null, attributes: attrs,
  };
  try {
    await apiRequest(`/master-cards/${cardId}`, { method: "PATCH", body: payload });
    showMessage(cardDetailStatus, "Карточка сохранена");
    await refreshAfterMutations({ reloadCards: true });
    await openCard(cardId);
  } catch (err) { showMessage(cardDetailStatus, `Ошибка: ${err.message}`, true); }
});

// 1688 source — two-step: preview → select SKU → attach
function renderSkuPicker(skus) {
  const grid = $("source1688SkuGrid");
  grid.innerHTML = "";
  state._selected1688Sku = null;
  if (!skus || !skus.length) {
    grid.innerHTML = '<div class="muted" style="padding:8px">Нет вариантов SKU — будет прикреплён весь товар</div>';
    return;
  }
  for (const sku of skus) {
    const card = document.createElement("div");
    card.className = "sku-card";
    card.dataset.skuId = sku.sku_id || "";
    card.dataset.skuPrice = sku.price ?? "";
    const imgHtml = sku.image
      ? `<img src="${sku.image}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : `<div class="sku-no-img">нет фото</div>`;
    card.innerHTML = `
      ${imgHtml}
      <div class="sku-name">${sku.name || sku.sku_id || "—"}</div>
      ${sku.price != null ? `<div class="sku-price">${sku.price} CNY</div>` : ""}
    `;
    card.addEventListener("click", () => {
      grid.querySelectorAll(".sku-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      state._selected1688Sku = sku;
    });
    grid.appendChild(card);
  }
  // Auto-select first
  if (skus.length === 1) {
    grid.querySelector(".sku-card")?.click();
  }
}

$("source1688PreviewBtn").addEventListener("click", async () => {
  const url = $("source1688Url").value.trim();
  if (!url) { showMessage(source1688Status, "Введите URL 1688", true); return; }
  showMessage(source1688Status, "Загрузка превью...");
  try {
    const data = await apiRequest("/master-cards/sources/1688/preview", {
      method: "POST", body: { url },
    });
    state._preview1688 = data;
    renderSkuPicker(data.skus || []);
    $("source1688SkuPicker").style.display = "";
    const skuCount = (data.skus || []).length;
    showMessage(source1688Status, `${data.title || "Товар"} — ${skuCount} SKU`);
  } catch (err) { showMessage(source1688Status, `Ошибка: ${err.message}`, true); }
});

$("source1688AttachBtn").addEventListener("click", async () => {
  if (!state.selectedCardDetail?.item?.id) { showMessage(source1688Status, "Сначала откройте карточку", true); return; }
  const cardId = state.selectedCardDetail.item.id;
  const url = $("source1688Url").value.trim();
  if (!url) { showMessage(source1688Status, "Введите URL 1688", true); return; }
  const body = {
    url,
    overwrite_title: $("source1688OverwriteTitle").checked,
  };
  if (state._selected1688Sku) {
    body.selected_sku_id = state._selected1688Sku.sku_id;
    body.selected_sku_price = state._selected1688Sku.price;
  }
  showMessage(source1688Status, "Прикрепление источника...");
  try {
    await apiRequest(`/master-cards/${cardId}/sources/1688/import`, { method: "POST", body });
    showMessage(source1688Status, "Источник 1688 прикреплён");
    await refreshAfterMutations({ reloadCards: true });
    await openCard(cardId);
  } catch (err) { showMessage(source1688Status, `Ошибка: ${err.message}`, true); }
});

// Manual source
$("manualSourceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.selectedCardDetail?.item?.id) { showMessage(cardDetailStatus, "Сначала откройте карточку", true); return; }
  const cardId = state.selectedCardDetail.item.id;
  const provider = $("manualSourceProvider").value.trim();
  const attrs = getCardAttributes(state.selectedCardDetail.item);
  const sources = attrs.sources && typeof attrs.sources === "object" ? { ...attrs.sources } : {};
  sources[`${provider}:${Date.now()}`] = {
    kind: $("manualSourceKind").value, provider,
    external_ref: $("manualSourceRef").value.trim(),
    updated_at: new Date().toISOString(), data: { note: $("manualSourceNote").value.trim() },
  };
  attrs.sources = sources;
  await apiRequest(`/master-cards/${cardId}`, { method: "PATCH", body: { attributes: attrs } });
  e.target.reset();
  await openCard(cardId);
});

// Source type tab switching
document.addEventListener("click", (e) => {
  const tab = e.target.closest(".source-tab");
  if (!tab) return;
  const paneId = tab.dataset.pane;
  tab.parentElement.querySelectorAll(".source-tab").forEach((t) => t.classList.toggle("active", t === tab));
  const wrapper = tab.closest(".add-source-content");
  if (wrapper) wrapper.querySelectorAll(".source-pane").forEach((p) => p.classList.toggle("hidden", p.id !== paneId));
});

// Source delete
cardSourcesList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".source-delete-btn");
  if (!btn || !state.selectedCardDetail?.item?.id) return;
  const sourceKey = btn.dataset.sourceKey;
  if (!confirm(`Удалить источник ${sourceKey}?`)) return;
  const cardId = state.selectedCardDetail.item.id;
  const attrs = getCardAttributes(state.selectedCardDetail.item);
  const sources = attrs.sources && typeof attrs.sources === "object" ? { ...attrs.sources } : {};
  delete sources[sourceKey];
  attrs.sources = sources;
  btn.disabled = true;
  try {
    await apiRequest(`/master-cards/${cardId}`, { method: "PATCH", body: { attributes: attrs } });
    await refreshAfterMutations({ reloadCards: true });
    await openCard(cardId);
  } catch (err) {
    showMessage(cardDetailStatus, `Ошибка: ${err.message}`, true);
  } finally { btn.disabled = false; }
});

// Order form: dynamic rows
$("addOrderItemBtn").addEventListener("click", addOrderItemRow);
$("addSharedCostBtn").addEventListener("click", addSharedCostRow);

$("orderItemsContainer").addEventListener("click", (e) => {
  const id = e.target.dataset.removeItem;
  if (id) removeOrderItemRow(id);
});

$("orderItemsContainer").addEventListener("change", (e) => {
  if (e.target.classList.contains("oi-card")) autoFillCny(e.target.closest(".order-item-row"));
  recalcOrderTotal();
});

$("orderItemsContainer").addEventListener("input", recalcOrderTotal);
$("sharedCostsContainer").addEventListener("input", recalcOrderTotal);
$("sharedCostsContainer").addEventListener("change", recalcOrderTotal);

$("sharedCostsContainer").addEventListener("click", (e) => {
  const id = e.target.dataset.removeCost;
  if (id) removeSharedCostRow(id);
});

// Create order
$("orderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const items = collectOrderItems();
  if (!items.length || !items[0].master_card_id) {
    showMessage($("orderTotalDisplay"), "Добавьте хотя бы одну позицию");
    return;
  }
  const sharedCosts = collectSharedCosts();
  const allocations = allocateSharedCosts(items, sharedCosts);

  const apiItems = items.map((item, i) => {
    const allocated = Object.values(allocations[i]).reduce((a, b) => a + b, 0);
    const allocationList = Object.entries(allocations[i]).map(([name, val]) => ({ name, allocated_rub: val }));
    return {
      master_card_id: item.master_card_id,
      quantity: item.quantity,
      cny_price_per_unit: item.cny_price_per_unit,
      individual_cost_rub: item.individual_cost_rub,
      purchase_price_rub: allocated,
      extra_cost_rub: item.individual_cost_rub,
      allocations: allocationList,
    };
  });

  const payload = {
    supplier_name: $("orderSupplier").value.trim(),
    order_date: $("orderDate").value || null,
    notes: $("orderNotes").value.trim() || null,
    shared_costs: sharedCosts,
    items: apiItems,
  };

  try {
    if (state.editingOrderId) {
      await apiRequest(`/supplier-orders/${state.editingOrderId}`, { method: "PUT", body: payload });
      showToast("Заказ обновлён", "success");
    } else {
      await apiRequest("/supplier-orders", { method: "POST", body: payload });
      showToast("Заказ создан", "success");
    }
    cancelEditOrder();
    await loadOrders();
  } catch (err) {
    showMessage($("orderTotalDisplay"), `Ошибка: ${err.message}`);
  }
});

$("reloadOrdersBtn").addEventListener("click", loadOrders);
$("cancelEditBtn").addEventListener("click", cancelEditOrder);

// Orders search (server-side with debounce)
let orderSearchTimer = null;
$("ordersSearchInput").addEventListener("input", (e) => {
  state.orderSearchQuery = e.target.value.trim();
  clearTimeout(orderSearchTimer);
  orderSearchTimer = setTimeout(() => loadOrders(), 300);
});

// Orders sort
$("ordersTableHead").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-sort]");
  if (!th) return;
  toggleSort(state.orderSort, th.dataset.sort);
  loadOrders();
});

// Order table: expand + receive + edit + delete
ordersTableBody.addEventListener("click", async (e) => {
  const expandBtn = e.target.closest(".order-expand-toggle");
  if (expandBtn) {
    await toggleOrderDetail(expandBtn.dataset.orderId, expandBtn);
    return;
  }
  const receiveBtn = e.target.closest("[data-action='receive']");
  if (receiveBtn) {
    openReceiveModal(receiveBtn.dataset.orderId);
    return;
  }
  const deleteBtn = e.target.closest("[data-action='delete']");
  if (deleteBtn) {
    const num = deleteBtn.dataset.orderNumber || "";
    if (!confirm(`Удалить заказ ${num}?`)) return;
    deleteBtn.disabled = true;
    try {
      await apiRequest(`/supplier-orders/${deleteBtn.dataset.orderId}`, { method: "DELETE" });
      await loadOrders();
    } catch (err) {
      alert(`Ошибка: ${err.message}`);
    } finally { deleteBtn.disabled = false; }
    return;
  }
  const unreceiveBtn = e.target.closest("[data-action='unreceive']");
  if (unreceiveBtn) {
    if (!confirm("Отменить приёмку? Партии будут удалены, заказ вернётся в черновик.")) return;
    unreceiveBtn.disabled = true;
    try {
      await apiRequest(`/supplier-orders/${unreceiveBtn.dataset.orderId}/unreceive`, { method: "POST" });
      await Promise.all([loadOrders(), loadCards()]);
    } catch (err) {
      alert(`Ошибка: ${err.message}`);
    } finally { unreceiveBtn.disabled = false; }
    return;
  }
  const editBtn = e.target.closest("[data-action='edit']");
  if (editBtn) {
    await startEditOrder(editBtn.dataset.orderId);
  }
});

// Finance — category select population
function populateFinanceCategorySelect(kind) {
  const sel = $("financeCategory");
  const prev = sel.value;
  sel.innerHTML = "";
  const cats = FINANCE_CATEGORIES[kind] || [];
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c.value;
    opt.textContent = c.label;
    sel.appendChild(opt);
  }
  if (cats.find((c) => c.value === prev)) sel.value = prev;
}
$("financeKind").addEventListener("change", (e) => populateFinanceCategorySelect(e.target.value));
populateFinanceCategorySelect("expense");

// Finance — open modal (create mode)
function openFinanceCreateModal() {
  $("financeEditId").value = "";
  $("financeModalTitle").textContent = "Новая запись";
  $("financeSubmitBtn").textContent = "Создать";
  $("financeForm").reset();
  $("financeKind").value = "expense";
  populateFinanceCategorySelect("expense");
  openModal(financeModal);
}

// Finance — open modal (edit mode)
function openFinanceEditModal(txn) {
  $("financeEditId").value = txn.id;
  $("financeModalTitle").textContent = "Редактировать запись";
  $("financeSubmitBtn").textContent = "Сохранить";
  $("financeKind").value = txn.kind;
  populateFinanceCategorySelect(txn.kind);
  $("financeCategory").value = txn.category;
  $("financeAmount").value = Number(txn.amount_rub);
  $("financeNotes").value = txn.notes || "";
  if (txn.happened_at) $("financeDate").value = txn.happened_at.slice(0, 10);
  openModal(financeModal);
}

// Finance — form submit (create or update)
$("financeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const editId = $("financeEditId").value;
  const body = {
    kind: $("financeKind").value,
    category: $("financeCategory").value,
    amount_rub: Number($("financeAmount").value),
    notes: $("financeNotes").value.trim() || null,
  };
  const dateVal = $("financeDate").value;
  if (dateVal) body.happened_at = new Date(dateVal).toISOString();
  if (editId) {
    await apiRequest(`/finance/transactions/${editId}`, { method: "PUT", body });
    showToast("Запись обновлена", "success");
  } else {
    await apiRequest("/finance/transactions", { method: "POST", body });
    showToast("Запись создана", "success");
  }
  closeModal(financeModal);
  loadFinanceTransactions();
});

// Finance — load transactions
async function loadFinanceTransactions() {
  state.financeLoaded = true;
  const params = new URLSearchParams({ limit: "200", source: "manual" });
  const from = $("finFilterFrom").value;
  const to = $("finFilterTo").value;
  const kind = $("finFilterKind").value;
  const cat = $("finFilterCategory").value;
  if (from) params.set("date_from", from);
  if (to) params.set("date_to", to);
  if (kind) params.set("kind", kind);
  if (cat) params.set("category", cat);
  if (state.financeSearchQuery) params.set("q", state.financeSearchQuery);
  params.set("sort", `${state.financeSort.field}:${state.financeSort.dir}`);
  const data = await apiRequest(`/finance/transactions?${params}`);
  renderFinanceTable(data);
}

function renderFinanceTable(data) {
  const body = $("financeTableBody");
  updateSortArrows("financeTableHead", state.financeSort);
  const items = data?.items || [];
  if (!items.length) {
    body.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-sm text-slate-400">Нет записей</td></tr>`;
    return;
  }
  body.innerHTML = items.map((t) => {
    const d = t.happened_at ? new Date(t.happened_at).toLocaleDateString("ru-RU") : "—";
    const kindBadge = t.kind === "income"
      ? `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">Доход</span>`
      : `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">Расход</span>`;
    const amtCls = t.kind === "income" ? "text-emerald-600" : "text-red-500";
    return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <td class="px-4 py-2.5 text-sm">${d}</td>
      <td class="px-4 py-2.5">${kindBadge}</td>
      <td class="px-4 py-2.5 text-sm">${financeCategoryLabel(t.category)}</td>
      <td class="px-4 py-2.5 text-sm text-right font-medium tabular-nums ${amtCls}">${formatMoney(t.amount_rub)}</td>
      <td class="px-4 py-2.5 text-sm text-slate-500 truncate max-w-[200px]">${t.notes || ""}</td>
      <td class="px-4 py-2.5 text-right">
        <button data-action="edit-fin" data-txn='${JSON.stringify(t).replace(/'/g, "&#39;")}' class="text-xs text-indigo-600 hover:text-indigo-800 mr-2">Ред.</button>
        <button data-action="del-fin" data-id="${t.id}" class="text-xs text-red-500 hover:text-red-700">Удал.</button>
      </td>
    </tr>`;
  }).join("");
}

// Finance table delegation
$("financeTableBody").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-action='edit-fin']");
  if (editBtn) {
    const txn = JSON.parse(editBtn.dataset.txn);
    openFinanceEditModal(txn);
    return;
  }
  const delBtn = e.target.closest("[data-action='del-fin']");
  if (delBtn) {
    if (!confirm("Удалить запись?")) return;
    await apiRequest(`/finance/transactions/${delBtn.dataset.id}`, { method: "DELETE" });
    showToast("Запись удалена", "success");
    loadFinanceTransactions();
  }
});

// Finance — filter change listeners
$("finFilterFrom").addEventListener("change", loadFinanceTransactions);
$("finFilterTo").addEventListener("change", loadFinanceTransactions);
$("finFilterKind").addEventListener("change", () => {
  populateFinFilterCategory($("finFilterKind").value);
  loadFinanceTransactions();
});
$("finFilterCategory").addEventListener("change", loadFinanceTransactions);
$("reloadFinanceBtn").addEventListener("click", loadFinanceTransactions);

// Finance search (server-side with debounce)
let finSearchTimer = null;
$("finSearchInput").addEventListener("input", (e) => {
  state.financeSearchQuery = e.target.value.trim();
  clearTimeout(finSearchTimer);
  finSearchTimer = setTimeout(() => loadFinanceTransactions(), 300);
});

// Finance sort
$("financeTableHead").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-sort]");
  if (!th) return;
  toggleSort(state.financeSort, th.dataset.sort);
  loadFinanceTransactions();
});

function populateFinFilterCategory(kind) {
  const sel = $("finFilterCategory");
  sel.innerHTML = `<option value="">Все категории</option>`;
  const cats = kind ? (FINANCE_CATEGORIES[kind] || []) : [...FINANCE_CATEGORIES.expense, ...FINANCE_CATEGORIES.income];
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c.value;
    opt.textContent = c.label;
    sel.appendChild(opt);
  }
}
populateFinFilterCategory("");

// Finance — set default date range (current month)
{
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  $("finFilterFrom").value = _localDateStr(firstDay);
  $("finFilterTo").value = _localDateStr(today);
}

// ---- Receive Modal ----
let _receiveOrderId = null;
let _receiveItems = [];

async function openReceiveModal(orderId) {
  _receiveOrderId = orderId;
  const data = await apiRequest(`/supplier-orders/${orderId}`);
  const items = data.items || [];
  _receiveItems = items.map((it) => ({
    item_id: it.id,
    title: it.title || it.master_card_title || "—",
    ordered_qty: Number(it.quantity || 0),
    individual_cost_rub: Number(it.individual_cost_rub || 0),
    purchase_price_rub: Number(it.purchase_price_rub || 0),
  }));
  $("receiveModalSubtitle").textContent = `Заказ #${data.order?.order_number || orderId} — ${data.order?.supplier_name || ""}`;
  renderReceiveItems();
  $("receiveModal").classList.remove("hidden");
}

function renderReceiveItems() {
  const tbody = $("receiveItemsBody");
  tbody.innerHTML = "";
  let grandTotal = 0;
  for (let i = 0; i < _receiveItems.length; i++) {
    const it = _receiveItems[i];
    const lineTotal = it.individual_cost_rub + it.purchase_price_rub;
    const recvQty = it._recvQty != null ? it._recvQty : it.ordered_qty;
    const unitCost = recvQty > 0 ? lineTotal / recvQty : 0;
    const rowTotal = recvQty > 0 ? lineTotal : 0;
    grandTotal += rowTotal;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.title}</td>
      <td>${it.ordered_qty}</td>
      <td><input type="number" min="0" step="1" value="${recvQty}" data-idx="${i}" class="recv-qty-input" /></td>
      <td>${formatMoney(unitCost)}</td>
      <td>${formatMoney(rowTotal)}</td>
    `;
    tbody.appendChild(tr);
  }
  $("receiveTotalDisplay").textContent = `Итого расход: ${formatMoney(grandTotal)}`;
}

$("receiveItemsBody").addEventListener("input", (e) => {
  const inp = e.target.closest(".recv-qty-input");
  if (!inp) return;
  const idx = Number(inp.dataset.idx);
  _receiveItems[idx]._recvQty = Math.max(0, Number(inp.value) || 0);
  renderReceiveItems();
  // restore focus
  const inputs = $("receiveItemsBody").querySelectorAll(".recv-qty-input");
  if (inputs[idx]) { inputs[idx].focus(); inputs[idx].setSelectionRange(inp.value.length, inp.value.length); }
});

$("receiveCancelBtn").addEventListener("click", () => {
  $("receiveModal").classList.add("hidden");
  _receiveOrderId = null;
  _receiveItems = [];
});

$("receiveConfirmBtn").addEventListener("click", async () => {
  if (!_receiveOrderId) return;
  const items = _receiveItems.map((it) => ({
    item_id: it.item_id,
    received_qty: it._recvQty != null ? it._recvQty : it.ordered_qty,
  }));
  $("receiveConfirmBtn").disabled = true;
  try {
    await apiRequest(`/supplier-orders/${_receiveOrderId}/receive`, {
      method: "POST",
      body: { items },
    });
    $("receiveModal").classList.add("hidden");
    _receiveOrderId = null;
    _receiveItems = [];
    await Promise.all([loadOrders(), loadCards()]);
  } catch (err) {
    alert(`Ошибка приёмки: ${err.message}`);
  } finally {
    $("receiveConfirmBtn").disabled = false;
  }
});

// ---- Initial Balance Modal ----
let _ibItems = [];

async function openInitialBalanceModal() {
  _ibItems = [];
  $("ibContent").classList.add("hidden");
  $("ibSubtitle").textContent = "Загрузка остатков с Ozon...";
  openModal($("initialBalanceModal"));
  try {
    const data = await apiRequest("/ozon/stocks", { method: "POST", body: {} });
    if (!data.items || data.items.length === 0) {
      $("ibSubtitle").textContent = data.message || "Нет товаров с остатками на Ozon. Сначала импортируйте товары.";
      return;
    }
    _ibItems = data.items.map((it) => ({
      master_card_id: it.master_card_id,
      title: it.title || it.sku || "—",
      sku: it.sku || "",
      stock: it.stock_present,
      unit_cost: 0,
      selected: true,
    }));
    $("ibSubtitle").textContent = `Найдено ${_ibItems.length} товаров с остатками. Укажите себестоимость за единицу.`;
    renderIBItems();
    $("ibContent").classList.remove("hidden");
  } catch (err) {
    $("ibSubtitle").textContent = `Ошибка: ${err.message}`;
  }
}

function renderIBItems() {
  const tbody = $("ibBody");
  tbody.innerHTML = "";
  let grandTotal = 0;
  for (let i = 0; i < _ibItems.length; i++) {
    const it = _ibItems[i];
    const lineTotal = it.selected ? it.unit_cost * it.stock : 0;
    grandTotal += lineTotal;
    const tr = document.createElement("tr");
    tr.className = it.selected ? "" : "opacity-40";
    tr.innerHTML = `
      <td class="px-4 py-2"><input type="checkbox" data-idx="${i}" class="ib-select" ${it.selected ? "checked" : ""} /></td>
      <td class="px-4 py-2 text-sm">${it.title}<br><span class="text-xs text-slate-400">${it.sku}</span></td>
      <td class="px-4 py-2 text-right text-sm tabular-nums">${it.stock}</td>
      <td class="px-4 py-2 text-right"><input type="number" min="0" step="0.01" value="${it.unit_cost || ""}" placeholder="0" data-idx="${i}" class="ib-cost-input form-input w-24 text-right text-sm py-1" /></td>
      <td class="px-4 py-2 text-right text-sm tabular-nums">${formatMoney(lineTotal)}</td>
    `;
    tbody.appendChild(tr);
  }
  $("ibTotal").textContent = `Итого: ${formatMoney(grandTotal)}`;
}

$("openInitialBalanceBtn").addEventListener("click", openInitialBalanceModal);
$("closeInitialBalanceBtn").addEventListener("click", () => { closeModal($("initialBalanceModal")); _ibItems = []; });
$("ibCancelBtn").addEventListener("click", () => { closeModal($("initialBalanceModal")); _ibItems = []; });
$("initialBalanceModal").addEventListener("click", (e) => { if (e.target === $("initialBalanceModal")) { closeModal($("initialBalanceModal")); _ibItems = []; } });

$("ibBody").addEventListener("change", (e) => {
  const chk = e.target.closest(".ib-select");
  if (chk) { _ibItems[Number(chk.dataset.idx)].selected = chk.checked; renderIBItems(); }
});

$("ibBody").addEventListener("input", (e) => {
  const inp = e.target.closest(".ib-cost-input");
  if (!inp) return;
  const idx = Number(inp.dataset.idx);
  _ibItems[idx].unit_cost = Math.max(0, Number(inp.value) || 0);
  renderIBItems();
  const inputs = $("ibBody").querySelectorAll(".ib-cost-input");
  if (inputs[idx]) { inputs[idx].focus(); inputs[idx].setSelectionRange(String(inp.value).length, String(inp.value).length); }
});

$("ibSelectAll").addEventListener("change", (e) => {
  _ibItems.forEach((it) => (it.selected = e.target.checked));
  renderIBItems();
});

$("ibConfirmBtn").addEventListener("click", async () => {
  const selected = _ibItems.filter((it) => it.selected && it.stock > 0);
  if (selected.length === 0) { showToast("Выберите хотя бы один товар", "error"); return; }
  const withoutCost = selected.filter((it) => !it.unit_cost || it.unit_cost <= 0);
  if (withoutCost.length > 0 && !confirm(`У ${withoutCost.length} товаров не указана себестоимость. Продолжить с нулевой себестоимостью?`)) return;
  $("ibConfirmBtn").disabled = true;
  try {
    const items = selected.map((it) => ({ master_card_id: it.master_card_id, quantity: it.stock, unit_cost_rub: it.unit_cost || 0 }));
    const result = await apiRequest("/inventory/initial-balance", { method: "POST", body: { items } });
    closeModal($("initialBalanceModal"));
    _ibItems = [];
    showToast(`Остатки оприходованы: ${result.items_count} позиций на ${formatMoney(result.purchase_amount_rub)}`, "success");
    await loadOrders();
  } catch (err) {
    showToast(`Ошибка: ${err.message}`, "error");
  } finally {
    $("ibConfirmBtn").disabled = false;
  }
});

// Unit Economics + P&L — auto-reload on date change
$("ueDateFrom").addEventListener("change", reloadAnalytics);
$("ueDateTo").addEventListener("change", reloadAnalytics);
// USN settings
$("usnRateInput").addEventListener("input", () => { $("saveUsnBtn").classList.remove("hidden"); });
$("saveUsnBtn").addEventListener("click", saveUsnRate);

// Ozon
$("ozonCredsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const c = ozonClientIdInput.value.trim();
  const a = ozonApiKeyInput.value.trim();
  if (!c || !a) { showMessage(ozonCredsStatus, "Введите Client-Id и Api-Key", true); return; }
  showMessage(ozonCredsStatus, "Сохранение...");
  try {
    await apiRequest("/integrations/ozon", { method: "PUT", body: { client_id: c, api_key: a } });
    ozonApiKeyInput.value = "";
    await loadOzonIntegration();
  } catch (err) { showMessage(ozonCredsStatus, `Ошибка: ${err.message}`, true); }
});

$("clearOzonCredsBtn").addEventListener("click", async () => {
  showMessage(ozonCredsStatus, "Очистка...");
  try {
    await apiRequest("/integrations/ozon", { method: "DELETE" });
    ozonClientIdInput.value = "";
    ozonApiKeyInput.value = "";
    await loadOzonIntegration();
  } catch (err) { showMessage(ozonCredsStatus, `Ошибка: ${err.message}`, true); }
});

// ---- New UI: Drawers / Modals / Theme / Mobile ----
$("openCreateCardDrawerBtn").addEventListener("click", () => openDrawer(createCardDrawerBackdrop, createCardDrawerPanel));
$("closeCreateCardDrawerBtn").addEventListener("click", () => closeDrawer(createCardDrawerBackdrop, createCardDrawerPanel));
createCardDrawerBackdrop.addEventListener("click", () => closeDrawer(createCardDrawerBackdrop, createCardDrawerPanel));

$("openOrderDrawerBtn").addEventListener("click", () => {
  resetOrderForm();
  orderDrawerTitle.textContent = "Новый заказ";
  openDrawer(orderDrawerBackdrop, orderDrawerPanel);
});
$("closeOrderDrawerBtn").addEventListener("click", () => {
  if (state.editingOrderId) state.editingOrderId = null;
  closeDrawer(orderDrawerBackdrop, orderDrawerPanel);
});
orderDrawerBackdrop.addEventListener("click", () => {
  if (state.editingOrderId) state.editingOrderId = null;
  closeDrawer(orderDrawerBackdrop, orderDrawerPanel);
});

$("openOzonModalBtn").addEventListener("click", () => openModal(ozonModal));
$("closeOzonModalBtn").addEventListener("click", () => closeModal(ozonModal));
ozonModal.addEventListener("click", (e) => { if (e.target === ozonModal) closeModal(ozonModal); });

$("openFinanceModalBtn").addEventListener("click", openFinanceCreateModal);
$("closeFinanceModalBtn").addEventListener("click", () => closeModal(financeModal));
financeModal.addEventListener("click", (e) => { if (e.target === financeModal) closeModal(financeModal); });

$("themeToggleBtn").addEventListener("click", toggleTheme);
$("mobileMenuBtn").addEventListener("click", openMobileSidebar);
sidebarOverlay.addEventListener("click", closeMobileSidebar);

// Sync dashboard — per-row sync button (event delegation)
$("syncDashboardRows").addEventListener("click", async (e) => {
  const btn = e.target.closest(".sync-row-btn");
  if (!btn) return;
  const key = btn.dataset.syncKey;
  const sync = SYNC_REGISTRY.find((s) => s.key === key);
  if (!sync) return;
  btn.disabled = true;
  btn.innerHTML = _spinSvg;
  try {
    await apiRequest(sync.endpoint, { method: "POST", body: sync.body });
    showToast(`${sync.label} — готово`, "success");
  } catch (err) {
    showToast(`${sync.label} — ошибка: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Синк`;
    await loadSyncDashboard();
  }
});

// Sync All button
$("syncAllBtn").addEventListener("click", async () => {
  if (state.syncRunning) return;
  state.syncRunning = true;
  const btn = $("syncAllBtn");
  const progress = $("syncGlobalProgress");
  btn.disabled = true;
  const total = SYNC_REGISTRY.length;
  let ok = 0, fail = 0;
  for (let i = 0; i < total; i++) {
    const sync = SYNC_REGISTRY[i];
    progress.textContent = `[${i + 1}/${total}] ${sync.label}…`;
    try {
      await apiRequest(sync.endpoint, { method: "POST", body: sync.body });
      ok++;
    } catch {
      fail++;
    }
    await loadSyncFreshness();
    renderSyncDashboard();
    updateAllFreshnessLabels();
  }
  progress.textContent = "";
  state.syncRunning = false;
  btn.disabled = false;
  showToast(`Синхронизация завершена: ${ok} ок, ${fail} ошибок`, fail ? "error" : "success");
});

// Freshness labels — click navigates to sync section
document.addEventListener("click", (e) => {
  const label = e.target.closest(".freshness-label");
  if (!label) return;
  setActiveSection("syncSection");
});

/* ============================================================ */
/* Logistics: Matrix + SKU Detail                               */
/* ============================================================ */

function renderMatrix() {
  const thead = $("matrixTableHead");
  const tbody = $("matrixTableBody");
  const tfoot = $("matrixTableFoot");
  const banner = $("logisticsNeedBalance");
  const summaryBar = $("matrixSummaryBar");
  if (thead) thead.innerHTML = "";
  tbody.innerHTML = "";
  tfoot.innerHTML = "";
  if (summaryBar) summaryBar.innerHTML = "";

  if (banner) banner.classList.toggle("hidden", !state.matrixNeedsBalance);

  const thCls = "text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500";
  const grpCls = "text-center px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700";
  const grpBorder = "border-l border-slate-200 dark:border-slate-700";

  const colCount = 10;

  // Two-level header
  if (thead) {
    thead.innerHTML = `
    <tr class="bg-slate-50 dark:bg-slate-800/50">
      <th rowspan="2" class="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 sticky left-0 bg-slate-50 dark:bg-slate-800/50 z-10 border-b border-slate-200 dark:border-slate-700">SKU / Товар</th>
      <th colspan="2" class="${grpCls} ${grpBorder}">Поставщик</th>
      <th colspan="2" class="${grpCls} ${grpBorder}">Склад</th>
      <th colspan="4" class="${grpCls} ${grpBorder}">Озон</th>
      <th rowspan="2" class="${thCls} ${grpBorder} cursor-help" title="Отгружено − (На складе + В пути + Выкуплено + Едет на склад). Показывает неучтённые единицы.">Расхожд.</th>
    </tr>
    <tr class="bg-slate-50 dark:bg-slate-800/50">
      <th class="${thCls} ${grpBorder} cursor-help" title="Заказано у поставщика (из закупок)">Заказ</th>
      <th class="${thCls} cursor-help" title="Получено от поставщика на ваш склад">Получ.</th>
      <th class="${thCls} ${grpBorder} cursor-help" title="Текущий остаток на вашем складе">В наличии</th>
      <th class="${thCls} cursor-help" title="Отгружено на склады Ozon (все поставки кроме отменённых)">Отгружено</th>
      <th class="${thCls} ${grpBorder} cursor-help" title="Остаток на складах Ozon (FBO + FBS)">На складе</th>
      <th class="${thCls} cursor-help" title="В доставке покупателям (ещё не доставлено и не отменено)">В пути</th>
      <th class="${thCls} cursor-help" title="Доставлено покупателям минус возвраты (чистые выкупы)">Выкуплено</th>
      <th class="${thCls} cursor-help" title="Товар в пути обратно на склад (отмены + возвраты, ещё не финализированы)">Едет на склад</th>
    </tr>`;
  }

  if (!state.matrixData.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="px-4 py-8 text-center text-sm text-slate-400">${
      state.matrixNeedsBalance
        ? "Оприходуйте остатки, чтобы увидеть матрицу"
        : "Нет данных. Нажмите «Синхронизировать» для загрузки."
    }</td></tr>`;
    return;
  }

  let tOrd = 0, tRcv = 0, tWh = 0, tShipped = 0, tOzon = 0, tDlvr = 0, tDlvd = 0, tRet = 0, tDisc = 0;
  const fq = (v) => v > 0 ? Number(v).toLocaleString("ru-RU") : "—";
  const fd = (v) => v !== 0 ? Number(v).toLocaleString("ru-RU") : "—";
  const cc = (v) => v > 0 ? "" : "text-slate-400";
  const cd = (v) => v > 0 ? "text-amber-500 dark:text-amber-400" : v < 0 ? "text-red-500" : "text-slate-400";

  for (const r of state.matrixData) {
    const tr = document.createElement("tr");
    tr.className = "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors";
    tr.dataset.masterCardId = r.master_card_id;

    const disc = Number(r.shipped_to_ozon || 0) - (Number(r.ozon_stock || 0) + Number(r.delivering_qty || 0) + Number(r.purchased_qty || 0) + Number(r.returns_in_transit || 0));

    tr.innerHTML = `
      <td class="px-4 py-2.5 sticky left-0 bg-white dark:bg-slate-900 z-10"><div class="font-medium text-sm">${r.sku || "—"}</div><div class="text-xs text-slate-500 truncate max-w-[220px]">${r.title || ""}</div></td>
      <td class="text-right px-3 py-2.5 text-sm ${grpBorder} ${cc(r.ordered_qty)}">${fq(r.ordered_qty)}</td>
      <td class="text-right px-3 py-2.5 text-sm ${cc(r.received_qty)}">${fq(r.received_qty)}</td>
      <td class="text-right px-3 py-2.5 text-sm ${grpBorder} ${cc(r.warehouse_stock)}">${fq(r.warehouse_stock)}</td>
      <td class="text-right px-3 py-2.5 text-sm ${cc(r.shipped_to_ozon)}">${fq(r.shipped_to_ozon)}</td>
      <td class="text-right px-3 py-2.5 text-sm font-semibold ${grpBorder} ${cc(r.ozon_stock)}">${fq(r.ozon_stock)}</td>
      <td class="text-right px-3 py-2.5 text-sm ${cc(r.delivering_qty)}">${fq(r.delivering_qty)}</td>
      <td class="text-right px-3 py-2.5 text-sm ${cc(r.purchased_qty)}">${fq(r.purchased_qty)}</td>
      <td class="text-right px-3 py-2.5 text-sm ${cc(r.returns_in_transit)}">${fq(r.returns_in_transit)}</td>
      <td class="text-right px-3 py-2.5 text-sm font-medium ${grpBorder} ${cd(disc)}">
        ${fd(disc)}${disc > 0 ? ` <button class="writeoff-disc-btn ml-1 text-xs text-red-400 hover:text-red-300 underline" data-card-id="${r.master_card_id}" data-disc="${disc}" data-title="${(r.title || '').replace(/"/g, '&quot;')}" onclick="event.stopPropagation()">Списать</button>` : ""}
      </td>`;
    tbody.appendChild(tr);

    tOrd += Number(r.ordered_qty || 0);
    tRcv += Number(r.received_qty || 0);
    tWh += Number(r.warehouse_stock || 0);
    tShipped += Number(r.shipped_to_ozon || 0);
    tOzon += Number(r.ozon_stock || 0);
    tDlvr += Number(r.delivering_qty || 0);
    tDlvd += Number(r.purchased_qty || 0);
    tRet += Number(r.returns_in_transit || 0);
    tDisc += disc;
  }

  const fl = (v) => v > 0 ? v.toLocaleString("ru-RU") : "—";
  tfoot.innerHTML = `<tr class="font-bold text-sm">
    <td class="px-4 py-2.5 sticky left-0 bg-white dark:bg-slate-900 z-10">Итого (${state.matrixData.length} SKU)</td>
    <td class="text-right px-3 py-2.5 ${grpBorder}">${fl(tOrd)}</td>
    <td class="text-right px-3 py-2.5">${fl(tRcv)}</td>
    <td class="text-right px-3 py-2.5 ${grpBorder}">${fl(tWh)}</td>
    <td class="text-right px-3 py-2.5">${fl(tShipped)}</td>
    <td class="text-right px-3 py-2.5 ${grpBorder}">${fl(tOzon)}</td>
    <td class="text-right px-3 py-2.5">${fl(tDlvr)}</td>
    <td class="text-right px-3 py-2.5">${fl(tDlvd)}</td>
    <td class="text-right px-3 py-2.5">${fl(tRet)}</td>
    <td class="text-right px-3 py-2.5 ${grpBorder} ${cd(tDisc)}">${fd(tDisc)}</td>
  </tr>`;

  // Summary stats bar
  if (summaryBar) {
    summaryBar.innerHTML = `
      <span>Отгружено: <b>${fl(tShipped)}</b></span>
      <span>На Ozon: <b>${fl(tOzon)}</b></span>
      <span>В пути: <b>${fl(tDlvr)}</b></span>
      <span>Выкуплено: <b>${fl(tDlvd)}</b></span>
      <span class="${cd(tDisc)}">Расхожд.: <b>${fd(tDisc)}</b></span>`;
  }
}

async function loadMatrix() {
  try {
    const data = await apiRequest("/logistics/matrix");
    state.matrixData = data.items || [];
    state.matrixNeedsBalance = !!data.needs_initial_balance;
    renderMatrix();
  } catch (err) {
    console.error("loadMatrix error:", err);
  }
}

/* ---- Logistics tabs ---- */
function switchLogisticsTab(tabName) {
  const tabs = document.querySelectorAll(".logistic-tab");
  tabs.forEach(t => {
    const active = t.dataset.tab === tabName;
    t.classList.toggle("border-blue-600", active);
    t.classList.toggle("text-blue-600", active);
    t.classList.toggle("dark:text-blue-400", active);
    t.classList.toggle("dark:border-blue-400", active);
    t.classList.toggle("border-transparent", !active);
    t.classList.toggle("text-slate-500", !active);
  });
  const matrixView = $("matrixView");
  const suppliesView = $("suppliesView");
  if (matrixView) matrixView.classList.toggle("hidden", tabName !== "matrixView");
  if (suppliesView) suppliesView.classList.toggle("hidden", tabName !== "suppliesView");
  if (tabName === "suppliesView" && !state.suppliesData) loadSupplies();
}

/* ---- Supplies list ---- */
const SUPPLY_STATUS_MAP = {
  "DRAFT": { label: "Черновик", cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  "CREATED": { label: "Создана", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  "IN_TRANSIT": { label: "В пути", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
  "ACCEPTANCE": { label: "Приёмка", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  "ACCEPTED": { label: "Принята", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  "ACCEPTED_WITH_DISCREPANCY": { label: "С расхождением", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  "CANCELLED": { label: "Отменена", cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
};

function renderSupplies() {
  const container = $("suppliesListContainer");
  const empty = $("suppliesEmpty");
  if (!container) return;
  container.innerHTML = "";

  const supplies = state.suppliesData || [];
  if (!supplies.length) {
    if (empty) { empty.classList.remove("hidden"); }
    return;
  }
  if (empty) empty.classList.add("hidden");

  for (const s of supplies) {
    const st = SUPPLY_STATUS_MAP[s.status] || { label: s.status, cls: "bg-slate-100 text-slate-600" };
    const discBadge = s.has_discrepancy
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">Расхождение</span>`
      : "";
    const date = s.created_at ? new Date(s.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : "—";

    const card = document.createElement("div");
    card.className = "bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm";

    // Header
    let headerHTML = `
      <div class="flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800/50 cursor-pointer select-none" data-supply-toggle="${s.id}">
        <svg class="w-4 h-4 text-slate-400 transition-transform supply-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-sm text-slate-900 dark:text-white">${s.supply_number || `#${s.supply_order_id}`}</span>
            <span class="inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}">${st.label}</span>
            ${discBadge}
          </div>
          <div class="text-xs text-slate-500 mt-0.5">${s.warehouse_name || "Склад не указан"} &middot; ${date}</div>
        </div>
        <div class="text-right flex-shrink-0">
          <div class="text-sm font-semibold text-slate-900 dark:text-white">${s.total_planned} шт.</div>
          <div class="text-xs ${s.total_accepted > 0 ? (s.has_discrepancy ? "text-red-600 dark:text-red-400 font-semibold" : "text-green-600 dark:text-green-400") : "text-slate-400"}">
            ${s.total_accepted > 0 ? `Принято: ${s.total_accepted}` : "Ожидает"}${s.total_rejected > 0 ? ` / Брак: ${s.total_rejected}` : ""}
          </div>
        </div>
      </div>`;

    // Items table (collapsed by default)
    let itemsHTML = `<div class="supply-items hidden border-t border-slate-200 dark:border-slate-700" data-supply-items="${s.id}">
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50/50 dark:bg-slate-800/30">
          <th class="text-left px-4 py-2 text-xs font-semibold text-slate-500">Товар</th>
          <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">План</th>
          <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Принято</th>
          <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Брак</th>
          <th class="text-right px-3 py-2 text-xs font-semibold text-slate-500">Расхождение</th>
        </tr></thead><tbody class="divide-y divide-slate-100 dark:divide-slate-800">`;

    for (const item of s.items) {
      const diff = item.accepted > 0 ? item.planned - item.accepted : 0;
      const diffClass = diff > 0 ? "text-red-600 dark:text-red-400 font-semibold" : (diff < 0 ? "text-blue-600" : "text-slate-400");
      const diffText = diff > 0 ? `−${diff}` : (diff < 0 ? `+${Math.abs(diff)}` : "—");
      const name = item.product_name || item.offer_id || "—";
      const sku = item.card_sku ? `<span class="text-xs text-slate-400 ml-1">(${item.card_sku})</span>` : "";
      itemsHTML += `<tr>
        <td class="px-4 py-2"><span class="text-slate-900 dark:text-white">${name}</span>${sku}</td>
        <td class="text-right px-3 py-2">${item.planned}</td>
        <td class="text-right px-3 py-2 ${item.accepted > 0 ? "" : "text-slate-400"}">${item.accepted || "—"}</td>
        <td class="text-right px-3 py-2 ${item.rejected > 0 ? "text-red-600 dark:text-red-400 font-semibold" : "text-slate-400"}">${item.rejected || "—"}</td>
        <td class="text-right px-3 py-2 ${diffClass}">${diffText}</td>
      </tr>`;
    }
    if (!s.items.length) {
      itemsHTML += `<tr><td colspan="5" class="px-4 py-3 text-center text-slate-400">Нет товаров в поставке</td></tr>`;
    }
    itemsHTML += `</tbody></table></div>`;

    card.innerHTML = headerHTML + itemsHTML;
    container.appendChild(card);
  }
}

async function loadSupplies() {
  try {
    const data = await apiRequest("/logistics/supplies");
    state.suppliesData = data.supplies || [];
    renderSupplies();
  } catch (err) {
    console.error("loadSupplies error:", err);
  }
}

function fillSubtable(tbodyId, rows, emptyText) {
  const el = $(tbodyId);
  if (!el) return;
  el.innerHTML = "";
  if (!rows || !rows.length) {
    el.innerHTML = `<tr><td colspan="10" class="px-3 py-2 text-slate-400 text-sm">${emptyText}</td></tr>`;
    return;
  }
  for (const html of rows) el.innerHTML += html;
}

function renderSkuDetail(data) {
  $("skuLogisticsTitle").textContent = `${data.card?.sku || "—"} — ${data.card?.title || ""}`;

  // Supplier orders
  fillSubtable("skuSupplierOrdersBody", (data.supplier_orders || []).map((o) => `<tr>
    <td class="px-3 py-2">${o.order_number || "—"}</td>
    <td class="px-3 py-2">${o.order_date || "—"}</td>
    <td class="text-right px-3 py-2">${Number(o.quantity || 0)}</td>
    <td class="text-right px-3 py-2">${o.received_qty != null ? Number(o.received_qty) : "—"}</td>
    <td class="text-right px-3 py-2">${formatMoney(o.unit_cost_rub || 0)}</td>
    <td class="px-3 py-2">${o.status || "—"}</td>
  </tr>`), "Нет закупок");

  // Ozon supplies — with editable acceptance
  fillSubtable("skuOzonSuppliesBody", (data.ozon_supplies || []).map((s) => {
    const rc = s.quantity_rejected > 0 ? "text-red-600 dark:text-red-400 font-semibold" : "";
    const isCancelled = (s.status || "").includes("CANCEL");
    const acceptedCell = isCancelled
      ? `<td class="text-right px-3 py-2 text-slate-400">—</td>`
      : `<td class="text-right px-3 py-2">
          <span class="acceptance-val cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 px-1.5 py-0.5 rounded -mx-1.5"
                data-item-id="${s.item_id}" data-planned="${s.quantity_planned}"
                data-accepted="${s.quantity_accepted}" title="Нажмите для редактирования"
          >${s.quantity_accepted || '<span class=&quot;text-slate-400&quot;>?</span>'}</span>
        </td>`;
    const rejectedCell = isCancelled
      ? `<td class="text-right px-3 py-2 text-slate-400">—</td>`
      : `<td class="text-right px-3 py-2 ${rc}">${s.quantity_rejected || "—"}</td>`;
    return `<tr>
      <td class="px-3 py-2">${s.supply_number || "—"}</td>
      <td class="px-3 py-2">${s.warehouse_name || "—"}</td>
      <td class="text-right px-3 py-2">${s.quantity_planned}</td>
      ${acceptedCell}
      ${rejectedCell}
      <td class="px-3 py-2">${s.status || "—"}</td>
    </tr>`;
  }), "Нет поставок на Ozon");

  // Stock
  fillSubtable("skuStockBody", (data.stock_snapshots || []).map((st) => `<tr>
    <td class="px-3 py-2">${st.warehouse_name || "—"}</td>
    <td class="px-3 py-2">${st.stock_type}</td>
    <td class="text-right px-3 py-2">${st.present}</td>
    <td class="text-right px-3 py-2">${st.reserved}</td>
    <td class="text-right px-3 py-2 font-semibold">${st.free_to_sell}</td>
  </tr>`), "Нет данных об остатках");

  // FIFO lots
  fillSubtable("skuLotsBody", (data.inventory_lots || []).map((l) => `<tr>
    <td class="px-3 py-2">${formatDateTime(l.received_at)}</td>
    <td class="text-right px-3 py-2">${Number(l.initial_qty)}</td>
    <td class="text-right px-3 py-2 font-semibold">${Number(l.remaining_qty)}</td>
    <td class="text-right px-3 py-2">${formatMoney(l.unit_cost_rub)}</td>
  </tr>`), "Нет лотов");

  // Losses
  const ls = $("skuLossesSection");
  const lc = $("skuLossesContent");
  if (data.losses && data.losses.total_qty > 0) {
    ls.classList.remove("hidden");
    let html = `<p class="font-semibold">Всего потерь: ${data.losses.total_qty} шт. на ${formatMoney(data.losses.total_cost_rub)}</p>`;
    for (const d of data.losses.details || []) {
      html += `<p class="text-slate-500">- ${d.source}: ${d.qty} шт. (${formatMoney(d.cost_rub)})</p>`;
    }
    lc.innerHTML = html;
  } else {
    ls.classList.add("hidden");
  }
}

async function openSkuDetail(masterCardId) {
  const data = await apiRequest(`/logistics/sku/${masterCardId}`);
  state.selectedSkuDetail = data;
  renderSkuDetail(data);
  openDrawer($("skuLogisticsBackdrop"), $("skuLogisticsPanel"));
}

// Loss detail popover
function showLossPopover(anchor, lossDetail) {
  document.querySelectorAll(".loss-popover").forEach(el => el.remove());
  const pop = document.createElement("div");
  pop.className = "loss-popover";
  const isDark = document.documentElement.classList.contains("dark");
  pop.style.cssText = `position:fixed;z-index:9999;background:${isDark ? "#1e293b" : "#fff"};border:1px solid ${isDark ? "#334155" : "#e2e8f0"};border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.15);padding:8px 0;min-width:320px;font-size:12px;max-width:420px`;

  let html = '<div style="padding:4px 12px 6px;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8">Потери при поставке на Ozon</div>';
  for (const d of lossDetail) {
    const borderColor = isDark ? "#334155" : "#f1f5f9";
    const statusIcon = d.loss_written_off
      ? '<span style="color:#22c55e" title="Списано">✓</span>'
      : '<span style="color:#ef4444" title="Не списано">●</span>';
    html += `<div style="padding:6px 12px;border-top:1px solid ${borderColor}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:600">${d.supply_number || "—"} → ${d.warehouse_name || "—"}</span>
        ${statusIcon}
      </div>
      <div style="color:#94a3b8;margin-top:2px">Отпр: ${d.planned} | Принято: ${d.accepted} | <span style="color:#ef4444;font-weight:600">Потеряно: ${d.rejected}</span></div>
      <div style="color:#64748b;font-size:11px;margin-top:1px">ID заявки: ${d.supply_order_id || "—"}</div>
    </div>`;
  }
  pop.innerHTML = html;
  document.body.appendChild(pop);

  const rect = anchor.getBoundingClientRect();
  let top = rect.bottom + 4;
  let left = rect.right - pop.offsetWidth;
  if (left < 8) left = 8;
  if (top + pop.offsetHeight > window.innerHeight - 8) top = rect.top - pop.offsetHeight - 4;
  pop.style.top = top + "px";
  pop.style.left = left + "px";

  const closeHandler = (ev) => {
    if (!pop.contains(ev.target) && ev.target !== anchor) {
      pop.remove();
      document.removeEventListener("click", closeHandler, true);
    }
  };
  setTimeout(() => document.addEventListener("click", closeHandler, true), 0);
}

// Matrix row clicks — navigate to card page OR open discrepancy modal
$("matrixTableBody").addEventListener("click", (e) => {
  const woBtn = e.target.closest(".writeoff-disc-btn");
  if (woBtn) {
    e.stopPropagation();
    const cardId = woBtn.dataset.cardId;
    const disc = woBtn.dataset.disc;
    const title = woBtn.dataset.title;
    $("discrepancyCardId").value = cardId;
    $("discrepancyQty").value = disc;
    $("discrepancyProductName").textContent = title || "—";
    $("discrepancyNotes").value = "";
    openModal($("discrepancyModal"));
    return;
  }
  const row = e.target.closest("tr[data-master-card-id]");
  if (!row) return;
  navigateToCard(row.dataset.masterCardId);
});

// Discrepancy write-off modal
$("closeDiscrepancyModalBtn").addEventListener("click", () => closeModal($("discrepancyModal")));
$("discrepancyModal").addEventListener("click", (e) => { if (e.target === $("discrepancyModal")) closeModal($("discrepancyModal")); });
$("discrepancyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("discrepancySubmitBtn");
  btn.disabled = true;
  btn.textContent = "Списание...";
  try {
    const result = await apiRequest("/logistics/write-off-discrepancy", {
      method: "POST",
      body: {
        master_card_id: $("discrepancyCardId").value,
        quantity: Number($("discrepancyQty").value),
        notes: $("discrepancyNotes").value || null,
      },
    });
    closeModal($("discrepancyModal"));
    showToast(`Списано ${result.written_off_qty} шт, потери ${formatMoney(result.loss_cost_rub)}`);
    await loadMatrix();
  } catch (err) {
    showToast(`Ошибка: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Списать";
  }
});

// UE table row clicks — navigate to card page
$("ueTableBody").addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-card-id]");
  if (!row) return;
  navigateToCard(row.dataset.cardId);
});

// Tab switching
document.querySelectorAll(".logistic-tab").forEach(btn => {
  btn.addEventListener("click", () => switchLogisticsTab(btn.dataset.tab));
});

// Supply card expand/collapse
document.addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-supply-toggle]");
  if (!toggle) return;
  const id = toggle.dataset.supplyToggle;
  const items = document.querySelector(`[data-supply-items="${id}"]`);
  if (!items) return;
  items.classList.toggle("hidden");
  const chevron = toggle.querySelector(".supply-chevron");
  if (chevron) chevron.classList.toggle("rotate-90");
});

// SKU detail drawer close
$("closeSkuLogisticsBtn").addEventListener("click", () => closeDrawer($("skuLogisticsBackdrop"), $("skuLogisticsPanel")));
$("skuLogisticsBackdrop").addEventListener("click", () => closeDrawer($("skuLogisticsBackdrop"), $("skuLogisticsPanel")));

// Inline editing for acceptance data in SKU detail drawer
$("skuLogisticsPanel").addEventListener("click", (e) => {
  const span = e.target.closest(".acceptance-val");
  if (!span || span.querySelector("input")) return; // already editing
  e.stopPropagation();
  const itemId = span.dataset.itemId;
  const planned = parseInt(span.dataset.planned, 10);
  const currentVal = parseInt(span.dataset.accepted, 10) || "";
  const origHTML = span.innerHTML;
  span.innerHTML = `<input type="number" min="0" max="${planned}" value="${currentVal}"
    class="w-16 text-right text-sm bg-white dark:bg-slate-800 border border-blue-400 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
    autofocus />`;
  const inp = span.querySelector("input");
  inp.focus();
  inp.select();
  const finish = async (save) => {
    if (!save) { span.innerHTML = origHTML; return; }
    const val = parseInt(inp.value, 10);
    if (isNaN(val) || val < 0 || val > planned) { span.innerHTML = origHTML; showToast("Некорректное значение", "error"); return; }
    try {
      await apiRequest("/logistics/update-acceptance", {
        method: "POST", body: { item_id: itemId, quantity_accepted: val },
      });
      const rejected = planned - val;
      span.dataset.accepted = val;
      span.innerHTML = val > 0 ? String(val) : '<span class="text-slate-400">?</span>';
      // Update rejected cell in same row
      const row = span.closest("tr");
      if (row) {
        const cells = row.querySelectorAll("td");
        const rejCell = cells[4]; // 5th cell = rejected
        if (rejCell) {
          rejCell.textContent = rejected > 0 ? String(rejected) : "—";
          rejCell.className = rejected > 0
            ? "text-right px-3 py-2 text-red-600 dark:text-red-400 font-semibold"
            : "text-right px-3 py-2";
        }
      }
      showToast(`Принято: ${val}, отклонено: ${rejected}`);
    } catch (err) {
      span.innerHTML = origHTML;
      showToast(`Ошибка: ${err.message}`, "error");
    }
  };
  inp.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") finish(true);
    if (ev.key === "Escape") finish(false);
  });
  inp.addEventListener("blur", () => finish(true));
});

/* ============================================================ */
/* Demand Planning — Two-Horizon Algorithm                      */
/* ============================================================ */

const TURNOVER_BADGE = {
  DEFICIT: { cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", label: "Дефицит" },
  POPULAR: { cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", label: "Популярный" },
  ACTUAL: { cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", label: "В норме" },
  SURPLUS: { cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", label: "Излишек" },
  NO_SALES: { cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500", label: "Нет продаж" },
  DEAD_STOCK: { cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500", label: "Мёртвый сток" },
  COLLECTING_DATA: { cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500", label: "Сбор данных" },
  WAS_DEFICIT: { cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", label: "Был дефицит" },
};

function idcColor(idc, target) {
  if (idc == null) return "text-slate-400";
  if (idc < target * 0.44) return "text-red-600 dark:text-red-400";
  if (idc < target) return "text-amber-600 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
}

function idcBar(idc, target) {
  if (idc == null) return '<span class="text-xs text-slate-400">—</span>';
  const pct = Math.min(100, Math.round((idc / target) * 100));
  const color = idc < target * 0.44 ? "bg-red-500" : idc < target ? "bg-amber-500" : "bg-green-500";
  return `<div class="flex items-center gap-1.5" title="${idc} дн. из ${target}">
    <div class="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
      <div class="${color} h-full rounded-full" style="width:${pct}%"></div>
    </div>
    <span class="text-xs font-medium ${idcColor(idc, target)}">${idc}д</span>
  </div>`;
}

function turnoverBadge(grade) {
  const b = TURNOVER_BADGE[grade] || TURNOVER_BADGE.COLLECTING_DATA;
  return `<span class="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded ${b.cls}">${b.label}</span>`;
}

function sourceBadge(source) {
  if (source === "ozon") return '<span class="text-[10px] text-blue-500 font-medium align-super">oz</span>';
  if (source === "manual") return '<span class="text-[10px] text-orange-500 font-medium align-super">&#9881;</span>';
  return '';
}

function getDemandLeadTime() { return parseInt($("demandLeadTime").value) || 45; }
function getDemandBuffer() { return parseInt($("demandBufferDays").value) || 60; }

function updateDemandTimeline() {
  const lt = getDemandLeadTime();
  const buf = getDemandBuffer();
  const total = lt + buf;
  $("demandHorizonLabel").textContent = total;
  const ltPct = ((lt / total) * 100).toFixed(1);
  const bufPct = ((buf / total) * 100).toFixed(1);
  $("tlLeadBar").style.width = ltPct + "%";
  $("tlBufferBar").style.left = ltPct + "%";
  $("tlBufferBar").style.width = bufPct + "%";
  $("tlArrivalLabel").style.left = ltPct + "%";
  $("tlArrivalLabel").textContent = `Приход (д.${lt})`;
}

$("demandLeadTime").addEventListener("input", updateDemandTimeline);
$("demandBufferDays").addEventListener("input", updateDemandTimeline);

async function loadDemandClusterStock() {
  try {
    const data = await apiRequest("/demand/cluster-stock");
    state.demandSyncedAt = data.synced_at;
    renderDemandFreshness();
  } catch { /* ignore */ }
}

function renderDemandFreshness() {
  const banner = $("demandFreshnessBanner");
  if (!state.demandSyncedAt) {
    banner.classList.add("hidden");
    return;
  }
  const syncDate = new Date(state.demandSyncedAt);
  const hoursAgo = Math.round((Date.now() - syncDate.getTime()) / 3600000);
  const dateStr = syncDate.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  if (hoursAgo > 24) {
    banner.className = "p-3 rounded-lg text-sm flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300";
    banner.innerHTML = `<svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>
      Данные устарели (${dateStr}, ${hoursAgo}ч назад). Рекомендуем обновить.`;
  } else {
    banner.className = "p-3 rounded-lg text-sm flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300";
    banner.innerHTML = `<svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      Данные Ozon: ${dateStr} (${hoursAgo}ч назад)`;
  }
}

function renderDemandPlan(plan) {
  state.demandPlan = plan;
  const items = plan.items || [];
  const container = $("demandTableContainer");
  const footer = $("demandPlanFooter");
  const summary = $("demandSummaryCards");
  const empty = $("demandEmpty");
  const tbody = $("demandTableBody");
  const tfoot = $("demandTableFoot");

  const leadTime = plan.lead_time_days || 45;
  const bufferDays = plan.buffer_days || 60;

  if (!items.length) {
    container.classList.add("hidden");
    footer.classList.add("hidden");
    summary.classList.add("hidden");
    empty.classList.remove("hidden");
    empty.textContent = "Нет данных для генерации плана. Сначала обновите данные Ozon.";
    return;
  }
  empty.classList.add("hidden");
  container.classList.remove("hidden");

  // Summary cards
  const urgent = items.filter(i => i.idc_global != null && i.idc_global < 20 && i.recommended_qty > 0);
  const soon = items.filter(i => i.idc_global != null && i.idc_global >= 20 && i.idc_global < leadTime && i.recommended_qty > 0);
  const normal = items.filter(i => i.recommended_qty <= 0 || i.idc_global == null || i.idc_global >= leadTime);
  const urgentQty = urgent.reduce((s, i) => s + i.recommended_qty, 0);
  const soonQty = soon.reduce((s, i) => s + i.recommended_qty, 0);

  summary.classList.remove("hidden");
  summary.innerHTML = `
    <div class="p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
      <div class="text-2xl font-bold text-red-600 dark:text-red-400">${urgent.length}</div>
      <div class="text-xs text-red-600 dark:text-red-400 mt-1">Срочно &mdash; IDC &lt; 20д (${urgentQty.toLocaleString()} шт)</div>
    </div>
    <div class="p-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
      <div class="text-2xl font-bold text-amber-600 dark:text-amber-400">${soon.length}</div>
      <div class="text-xs text-amber-600 dark:text-amber-400 mt-1">Скоро &mdash; IDC &lt; ${leadTime}д (${soonQty.toLocaleString()} шт)</div>
    </div>
    <div class="p-4 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
      <div class="text-2xl font-bold text-green-600 dark:text-green-400">${normal.length}</div>
      <div class="text-xs text-green-600 dark:text-green-400 mt-1">В норме</div>
    </div>`;

  // Table rows
  let html = "";
  for (const item of items) {
    const idc = item.idc_global;
    const ads = item.ads_global;
    const gap = item.total_gap;
    const rec = item.recommended_qty;
    const rowId = item.master_card_id;
    const isExpanded = state.demandExpandedRows.has(rowId);

    html += `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer demand-row" data-card-id="${rowId}">
      <td class="px-3 py-3 text-slate-400">${item.cluster_breakdown?.length ? `<svg class="w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>` : ""}</td>
      <td class="px-4 py-3">
        <div class="text-sm font-medium text-slate-900 dark:text-white truncate max-w-[220px]">${esc(item.title || item.sku || "—")}</div>
        <div class="text-xs text-slate-400">${esc(item.sku || "")}</div>
      </td>
      <td class="px-3 py-3 text-right text-sm tabular-nums">${ads != null ? ads.toFixed(1) : "—"}</td>
      <td class="px-3 py-3 text-center">${idcBar(idc, leadTime)}</td>
      <td class="px-3 py-3 text-right text-sm tabular-nums">${item.stock_on_ozon ?? "—"}</td>
      <td class="px-3 py-3 text-right text-sm tabular-nums">${item.stock_at_home ?? 0}</td>
      <td class="px-3 py-3 text-right text-sm tabular-nums font-medium ${gap > 0 ? "text-red-600 dark:text-red-400" : "text-slate-500"}">${gap > 0 ? gap.toLocaleString() : "—"}</td>
      <td class="px-3 py-3 text-right"><span class="inline-block px-2 py-1 text-sm font-bold rounded ${rec > 0 ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "text-slate-400"}">${rec > 0 ? rec.toLocaleString() : "0"}</span></td>
    </tr>`;

    // Cluster breakdown (expandable) — with "К приходу" column
    if (isExpanded && item.cluster_breakdown?.length) {
      html += `<tr class="demand-cluster-rows"><td colspan="8" class="p-0"><div class="px-8 py-2 bg-slate-50 dark:bg-slate-800/30">
        <table class="w-full text-xs">
          <thead><tr class="text-slate-400">
            <th class="text-left py-1 px-2 font-medium">Кластер</th>
            <th class="text-right py-1 px-2 font-medium">Прод/д</th>
            <th class="text-center py-1 px-2 font-medium">IDC</th>
            <th class="text-center py-1 px-2 font-medium">Статус</th>
            <th class="text-right py-1 px-2 font-medium">Сейчас</th>
            <th class="text-right py-1 px-2 font-medium" title="Прогноз остатка к моменту прихода заказа (через ${leadTime} дн.)">К приходу</th>
            <th class="text-right py-1 px-2 font-medium" title="Нужно на ${bufferDays} дн. после прихода">Нужно (${bufferDays}д)</th>
            <th class="text-right py-1 px-2 font-medium">Gap</th>
          </tr></thead>
          <tbody>`;
      for (const c of item.cluster_breakdown) {
        const cIdc = c.idc;
        const currentStock = c.available + (c.in_transit || 0);
        const stockAtArrival = c.stock_at_arrival ?? Math.max(0, currentStock - Math.ceil(leadTime * (c.ads || 0)));
        const arrColor = stockAtArrival <= 0 ? "text-red-600 dark:text-red-400 font-bold" : "text-slate-700 dark:text-slate-300";
        html += `<tr class="border-t border-slate-200 dark:border-slate-700">
          <td class="py-1.5 px-2 font-medium text-slate-700 dark:text-slate-300">${esc(c.cluster_name || `#${c.cluster_id}`)} ${sourceBadge(c.source)}</td>
          <td class="py-1.5 px-2 text-right tabular-nums">${c.ads ? c.ads.toFixed(1) : "—"}</td>
          <td class="py-1.5 px-2 text-center">${cIdc != null ? `<span class="${idcColor(cIdc, leadTime)}">${cIdc}д</span>` : "—"}</td>
          <td class="py-1.5 px-2 text-center">${c.turnover ? turnoverBadge(c.turnover) : "—"}</td>
          <td class="py-1.5 px-2 text-right tabular-nums">${currentStock}</td>
          <td class="py-1.5 px-2 text-right tabular-nums ${arrColor}">${stockAtArrival}</td>
          <td class="py-1.5 px-2 text-right tabular-nums">${c.need || 0}</td>
          <td class="py-1.5 px-2 text-right tabular-nums font-medium ${c.gap > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}">${c.gap > 0 ? c.gap : "0"}</td>
        </tr>`;
      }

      // Calculation summary — two-horizon explanation
      const totalClusterGap = item.cluster_breakdown.reduce((s, c) => s + (c.gap || 0), 0);
      html += `</tbody></table>
        <div class="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 space-y-0.5">
          <div class="font-medium text-slate-600 dark:text-slate-400 mb-1">Расчёт заказа (горизонт: ${leadTime} + ${bufferDays} = ${leadTime + bufferDays} дн.)</div>
          <div>1. Остаток на Ozon к приходу (через ${leadTime}д): <b>Сейчас − ${leadTime}д &times; продажи/д</b></div>
          <div>2. Нужно после прихода на ${bufferDays}д: <b>${bufferDays}д &times; продажи/д</b></div>
          <div>3. Gap = Нужно − К приходу (если &gt; 0)</div>
          <div class="pt-1 border-t border-slate-200 dark:border-slate-700"></div>
          <div>Сумма gap по кластерам: <b>${totalClusterGap.toLocaleString()}</b></div>
          <div>&minus; На нашем складе: <b>${item.stock_at_home || 0}</b></div>
          <div>&minus; Заказано поставщику: <b>${item.pipeline_supplier || 0}</b></div>
          <div class="text-sm font-semibold text-slate-700 dark:text-slate-300">= К заказу: <b class="text-indigo-600 dark:text-indigo-400">${rec.toLocaleString()}</b></div>
        </div>
      </div></td></tr>`;
    }
  }
  tbody.innerHTML = html;

  // Footer totals
  const totalItems = items.filter(i => i.recommended_qty > 0).length;
  const totalQty = items.reduce((s, i) => s + (i.recommended_qty || 0), 0);
  tfoot.innerHTML = `<tr class="bg-slate-50 dark:bg-slate-800/50">
    <td colspan="7" class="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Итого: ${totalItems} товаров к заказу</td>
    <td class="px-3 py-3 text-right text-sm font-bold text-indigo-600 dark:text-indigo-400">${totalQty.toLocaleString()} шт</td>
  </tr>`;

  // Plan footer
  if (totalItems > 0) {
    footer.classList.remove("hidden");
    $("demandPlanSummary").innerHTML = `План #${plan.plan_id} &middot; ${totalItems} товаров &middot; ${totalQty.toLocaleString()} шт &middot; Горизонт ${leadTime}+${bufferDays}=${leadTime + bufferDays}д`;
  } else {
    footer.classList.add("hidden");
  }

  state.demandSyncedAt = plan.data_synced_at;
  renderDemandFreshness();
}

// Toggle cluster breakdown rows
$("demandTableBody").addEventListener("click", (e) => {
  const row = e.target.closest(".demand-row");
  if (!row) return;
  const cardId = row.dataset.cardId;
  if (state.demandExpandedRows.has(cardId)) {
    state.demandExpandedRows.delete(cardId);
  } else {
    state.demandExpandedRows.add(cardId);
  }
  if (state.demandPlan) renderDemandPlan(state.demandPlan);
});

$("generatePlanBtn").addEventListener("click", async () => {
  const btn = $("generatePlanBtn");
  btn.disabled = true;
  btn.textContent = "Генерация...";
  try {
    const leadTime = getDemandLeadTime();
    const bufferDays = getDemandBuffer();
    const plan = await apiRequest("/demand/generate", {
      method: "POST",
      body: { lead_time_days: leadTime, buffer_days: bufferDays },
    });
    renderDemandPlan(plan);
    showToast(`План сгенерирован: ${plan.total_items} товаров, ${plan.total_qty} шт`, "success");
  } catch (err) {
    showToast("Ошибка генерации: " + (err.message || ""), "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg> Сгенерировать план`;
  }
});

$("confirmPlanBtn").addEventListener("click", async () => {
  if (!state.demandPlan) return;
  const btn = $("confirmPlanBtn");
  btn.disabled = true;
  try {
    await apiRequest(`/demand/plans/${state.demandPlan.plan_id}/confirm`, { method: "POST" });
    showToast("План подтверждён", "success");
    state.demandPlan.status = "confirmed";
    btn.textContent = "Подтверждён";
    btn.classList.replace("bg-green-600", "bg-slate-400");
    btn.classList.replace("hover:bg-green-700", "hover:bg-slate-400");
  } catch (err) {
    showToast("Ошибка: " + (err.message || ""), "error");
    btn.disabled = false;
  }
});

/* ============================================================ */
/* Prices Section — Products & Calculator                       */
/* ============================================================ */

function switchPricesTab(tabName) {
  document.querySelectorAll(".price-tab").forEach((t) => {
    const active = t.dataset.tab === tabName;
    t.classList.toggle("border-indigo-600", active);
    t.classList.toggle("text-indigo-600", active);
    t.classList.toggle("dark:text-indigo-400", active);
    t.classList.toggle("dark:border-indigo-400", active);
    t.classList.toggle("border-transparent", !active);
    t.classList.toggle("text-slate-500", !active);
  });
  const views = ["priceProductsView", "priceCalcView"];
  views.forEach((v) => {
    const el = $(v);
    if (el) el.classList.toggle("hidden", v !== tabName);
  });
  if (tabName === "priceCalcView" && state.calcCategories.length === 0) loadCalcCategories();
}

document.querySelectorAll(".price-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchPricesTab(tab.dataset.tab));
});

// --- Sort / Search utilities (reusable across sections) ---

function toggleSort(sortState, field) {
  if (sortState.field === field) {
    sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
  } else {
    sortState.field = field;
    sortState.dir = "asc";
  }
}

function updateSortArrows(theadId, sortState) {
  const thead = $(theadId);
  if (!thead) return;
  thead.querySelectorAll("th[data-sort]").forEach((th) => {
    const arrow = th.querySelector(".sort-arrow");
    if (!arrow) return;
    if (th.dataset.sort === sortState.field) {
      arrow.textContent = sortState.dir === "asc" ? " \u25B2" : " \u25BC";
      arrow.classList.add("active");
    } else {
      arrow.textContent = "";
      arrow.classList.remove("active");
    }
  });
}

// --- My Products tab: ROI-based pricing manager ---

let priceSearchTimer = null;

// Search input — 300ms debounce
$("priceSearchInput").addEventListener("input", (e) => {
  state.priceSearchQuery = e.target.value.trim();
  clearTimeout(priceSearchTimer);
  priceSearchTimer = setTimeout(() => loadPriceProducts(), 300);
});

// Sortable column headers
$("priceProductsHead").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-sort]");
  if (!th) return;
  toggleSort(state.priceSort, th.dataset.sort);
  loadPriceProducts();
});

async function loadPriceProducts() {
  state.pricesLoaded = true;
  $("priceProductsLoading").classList.remove("hidden");
  try {
    const params = new URLSearchParams();
    if (state.priceSearchQuery) params.set("q", state.priceSearchQuery);
    if (state.priceSort.field) params.set("sort", state.priceSort.field + ":" + state.priceSort.dir);
    const qs = params.toString();
    const data = await apiRequest("/pricing/products" + (qs ? "?" + qs : ""));
    state.priceProducts = data.items || [];
    state.priceDefaults = data.defaults || {};
  } catch (e) {
    showToast("Ошибка загрузки: " + (e.message || ""), "error");
    state.priceProducts = [];
  }
  $("priceProductsLoading").classList.add("hidden");
  renderPriceProducts();
}

// --- ROI → Price client-side calculation ---

function findCommRate(price, tiers) {
  if (!tiers || !tiers.length) return 0;
  for (const t of tiers) {
    if (price >= t.price_min && (t.price_max == null || price < t.price_max)) return t.rate;
  }
  return tiers[tiers.length - 1].rate;
}

function pricingParams(product) {
  const t = product?.tariffs || {};
  return {
    acquiring_rub: t.acquiring_rub || 0,
    pipelineMin: t.pipeline_min_rub || 0,
    pipelineMax: t.pipeline_max_rub || 0,
  };
}

// Returns { price, commRate, profit, netRevenue, fixed, target } or null
// Tries all commission tiers and picks the LOWEST valid price
function calcPriceFromROI(cogs, roi, tiers, product) {
  if (!cogs || cogs <= 0 || !tiers || !tiers.length) return null;
  const pp = pricingParams(product);
  const target = cogs * (1 + roi / 100);
  const fixed = target + pp.pipelineMin;

  let best = null;
  for (const tier of tiers) {
    const denom = 1 - tier.rate;
    if (denom <= 0.01) continue;
    const rawPrice = (fixed + pp.acquiring_rub) / denom;
    const price = Math.ceil(rawPrice);
    const inRange = price >= tier.price_min && (tier.price_max == null || price < tier.price_max);
    if (inRange && (!best || price < best.price)) {
      const commAmt = price * tier.rate;
      const netRevenue = price - commAmt - pp.acquiring_rub;
      const profit = netRevenue - cogs - pp.pipelineMin;
      best = { price, commRate: tier.rate, profit, netRevenue, fixed, target };
    }
  }
  return best;
}

// Reverse: price → ROI breakdown
function calcROIFromPrice(cogs, price, tiers, product) {
  if (!cogs || cogs <= 0 || !price || price <= 0) return null;
  const pp = pricingParams(product);
  const commRate = findCommRate(price, tiers);
  const commAmt = price * commRate;
  const netRevenue = price - commAmt - pp.acquiring_rub;
  const profit = netRevenue - cogs - pp.pipelineMin;
  const roi = (profit / cogs) * 100;
  return { roi: Math.round(roi * 10) / 10, commRate, profit, netRevenue };
}

function getRowRoi(cardId) {
  return state.priceRowRoi[cardId] != null ? state.priceRowRoi[cardId] : state.priceGlobalRoi;
}

function getRowPrice(cardId) {
  const p = state.priceProducts.find((x) => x.id === cardId);
  if (!p) return null;
  if (state.priceRowPrice[cardId] != null) return state.priceRowPrice[cardId];
  const hasTiers = p.commission_tiers && p.commission_tiers.length > 0;
  if (p.cogs > 0 && hasTiers) {
    const result = calcPriceFromROI(p.cogs, getRowRoi(cardId), p.commission_tiers, p);
    return result ? result.price : null;
  }
  return null;
}

// --- Tooltip builders ---

function fmtRub(v) { return v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " \u20BD"; }
function fmtPct(v) { return (v * 100).toFixed(1) + "%"; }

function buildPriceTooltipHTML(cogs, roi, price, tiers, product) {
  if (!price || !cogs) return "";
  const pp = pricingParams(product);
  const commRate = findCommRate(price, tiers);
  const profit = cogs * roi / 100;
  const fixed = cogs + profit + pp.pipelineMin;
  const commAmt = price * commRate;
  const netRevenue = price - commAmt - pp.acquiring_rub;
  const actualProfit = netRevenue - cogs - pp.pipelineMin;
  const actualRoi = (actualProfit / cogs * 100);

  const line = (label, val, cls) =>
    `<div class="flex justify-between gap-6"><span class="text-slate-400">${label}</span><span class="${cls || ""}">${val}</span></div>`;
  const sep = '<div class="border-t border-slate-600 my-1"></div>';

  let h = `<div class="text-indigo-300 text-[11px] font-semibold mb-1.5">Расчёт цены при ROI ${Math.round(roi)}%</div>`;
  h += line("Себестоимость", fmtRub(cogs));
  h += line("+ Целевая прибыль (" + Math.round(roi) + "%)", fmtRub(profit));
  h += line("+ Магистраль", fmtRub(pp.pipelineMin));
  h += sep;
  h += line("= Нужно покрыть", fmtRub(fixed), "font-medium text-white");
  h += `<div class="text-slate-500 text-[10px] mt-1.5 mb-0.5">Удержания Ozon:</div>`;
  h += line("Комиссия " + fmtPct(commRate), fmtRub(commAmt));
  h += line("Эквайринг", fmtRub(pp.acquiring_rub));
  h += sep;
  h += line("Расч. цена", fmtRub(price), "font-bold text-indigo-300");
  h += `<div class="mt-1.5"></div>`;
  h += line("Чист. выручка", fmtRub(netRevenue));
  h += line("Прибыль", fmtRub(actualProfit), actualProfit >= 0 ? "text-emerald-400 font-medium" : "text-red-400 font-medium");
  h += line("ROI", actualRoi.toFixed(1) + "%", "text-slate-300");
  if (!pp.acquiring_rub && !pp.pipelineMin) {
    h += `<div class="text-amber-400 text-[10px] mt-1.5">⚠ Тарифы не синхронизированы</div>`;
  }
  return h;
}

function buildROITooltipHTML(cogs, price, tiers, product) {
  if (!price || !cogs) return "";
  const pp = pricingParams(product);
  const commRate = findCommRate(price, tiers);
  const commAmt = price * commRate;
  const netRevenue = price - commAmt - pp.acquiring_rub;
  const profit = netRevenue - cogs - pp.pipelineMin;
  const roi = (profit / cogs) * 100;

  const line = (label, val, cls) =>
    `<div class="flex justify-between gap-6"><span class="text-slate-400">${label}</span><span class="${cls || ""}">${val}</span></div>`;
  const sep = '<div class="border-t border-slate-600 my-1"></div>';

  let h = `<div class="text-indigo-300 text-[11px] font-semibold mb-1.5">ROI = Прибыль / С\u002Fс \u00D7 100</div>`;
  h += line("Цена продажи", fmtRub(price));
  h += line("\u2212 Комиссия (" + fmtPct(commRate) + ")", "\u2212" + fmtRub(commAmt));
  h += line("\u2212 Эквайринг", "\u2212" + fmtRub(pp.acquiring_rub));
  h += sep;
  h += line("= Чист. выручка", fmtRub(netRevenue), "text-white");
  h += line("\u2212 Себестоимость", "\u2212" + fmtRub(cogs));
  h += line("\u2212 Магистраль", "\u2212" + fmtRub(pp.pipelineMin));
  h += sep;
  h += line("= Прибыль", fmtRub(profit), profit >= 0 ? "text-emerald-400 font-medium" : "text-red-400 font-medium");
  h += line("ROI = " + fmtRub(profit) + " / " + fmtRub(cogs), roi.toFixed(1) + "%", "font-bold text-indigo-300");
  return h;
}

function showPriceTooltip(anchor, html) {
  if (!html) return;
  let tip = document.getElementById("pricingTip");
  if (!tip) { tip = document.createElement("div"); tip.id = "pricingTip"; document.body.appendChild(tip); }
  tip.className = "price-tooltip";
  tip.innerHTML = html;
  tip.style.display = "block";
  const rect = anchor.getBoundingClientRect();
  tip.style.left = Math.max(4, rect.left - 280) + "px";
  const tipH = tip.offsetHeight || 260;
  const top = rect.top + tipH > window.innerHeight ? rect.bottom - tipH : rect.top;
  tip.style.top = Math.max(4, top) + "px";
}

function hidePriceTooltip() {
  const tip = document.getElementById("pricingTip");
  if (tip) tip.style.display = "none";
}

// --- Render ---

function renderPriceProducts() {
  const body = $("priceProductsBody");
  const empty = $("priceProductsEmpty");
  const items = state.priceProducts;

  // Update sort arrows
  updateSortArrows("priceProductsHead", state.priceSort);

  // Update bulk button labels with count when filtered
  const filteredCount = items.filter(
    (p) => p.ozon_offer_id && p.cogs > 0 && p.commission_tiers?.length
  ).length;
  const suffix = state.priceSearchQuery ? ` (${filteredCount})` : "";
  $("priceApplyAllMin").textContent = "Уст. мин. цену" + suffix;
  $("priceApplyAllSale").textContent = "Уст. цену продажи" + suffix;

  if (!items.length) {
    body.innerHTML = "";
    empty.textContent = state.priceSearchQuery
      ? "Ничего не найдено"
      : 'Нет товаров. Нажмите "Синхронизировать" для загрузки данных с Ozon.';
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  const fmt = (v) => v ? Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) : "\u2014";

  body.innerHTML = items.map((p) => {
    const hasCogs = p.cogs && p.cogs > 0;
    const hasTiers = p.commission_tiers && p.commission_tiers.length > 0;
    const rowRoi = getRowRoi(p.id);
    const hasPriceOverride = state.priceRowPrice[p.id] != null;
    const calcResult = hasCogs && hasTiers ? calcPriceFromROI(p.cogs, rowRoi, p.commission_tiers, p) : null;
    const effectivePrice = hasPriceOverride ? state.priceRowPrice[p.id] : (calcResult ? calcResult.price : null);
    const commPct = effectivePrice && hasTiers ? (findCommRate(effectivePrice, p.commission_tiers) * 100).toFixed(1) : null;
    const isRoiOverridden = state.priceRowRoi[p.id] != null;
    const rowCls = hasCogs ? "" : "price-row-disabled";
    const catLabel = p.ozon_category_name && p.ozon_product_type_name
      ? `${p.ozon_category_name} / ${p.ozon_product_type_name}` : "";

    return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${rowCls}" data-id="${p.id}">
      <td class="px-3 py-2.5">
        <div class="text-sm font-medium text-slate-800 dark:text-slate-200 truncate max-w-[220px]" title="${esc(p.title)}">${esc(p.title)}</div>
        <div class="text-xs text-slate-400 font-mono">${esc(p.sku || p.ozon_offer_id || "\u2014")}</div>
        ${catLabel ? `<div class="text-[10px] text-slate-400 truncate max-w-[220px]" title="${esc(catLabel)}">${esc(catLabel)}</div>` : ""}
      </td>
      <td class="px-3 py-2.5 text-right text-sm text-slate-600 dark:text-slate-400">${fmt(p.cogs)}</td>
      <td class="px-3 py-2.5 text-right text-sm text-slate-600 dark:text-slate-400">${commPct ? commPct + "%" : "\u2014"}</td>
      <td class="px-3 py-2.5 text-center">
        <div class="price-roi-wrap" data-id="${p.id}">
          <input type="number" min="0" max="500" step="5" value="${rowRoi}"
            class="price-roi-input w-16 text-sm text-center border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 py-0.5 ${isRoiOverridden ? "roi-input-overridden" : ""}"
            data-id="${p.id}" ${hasCogs ? "" : "disabled"} />
        </div>
      </td>
      <td class="px-3 py-2.5 text-right">
        <div class="price-calc-wrap" data-id="${p.id}">
          ${effectivePrice ? `<input type="number" min="1" step="1" value="${effectivePrice}"
            class="price-calc-input ${hasPriceOverride ? "price-input-overridden" : ""}"
            data-id="${p.id}" />` : `<span class="text-sm text-slate-400">\u2014</span>`}
        </div>
      </td>
      <td class="px-3 py-2.5 text-right">
        <div class="flex items-center justify-end gap-1.5">
          <span class="text-sm text-slate-600 dark:text-slate-400">${fmt(p.ozon_min_price)}</span>
          ${effectivePrice && p.ozon_offer_id ? `<button class="price-apply-btn" data-action="min" data-offer="${esc(p.ozon_offer_id)}" data-price="${effectivePrice}" title="Установить расч. цену как мин.">\u2190</button>` : ""}
        </div>
      </td>
      <td class="px-3 py-2.5 text-right">
        <div class="flex items-center justify-end gap-1.5">
          <span class="text-sm font-medium text-slate-800 dark:text-slate-200">${fmt(p.ozon_price)}</span>
          ${effectivePrice && p.ozon_offer_id ? `<button class="price-apply-btn" data-action="sale" data-offer="${esc(p.ozon_offer_id)}" data-price="${effectivePrice}" title="Установить расч. цену как продажную">\u2190</button>` : ""}
        </div>
      </td>
    </tr>`;
  }).join("");
}

// --- Recalculate single row (DOM update without full re-render) ---

// Recalc from ROI change → updates price + commission
function recalcPriceRow(cardId) {
  const p = state.priceProducts.find((x) => x.id === cardId);
  if (!p) return;
  const tr = document.querySelector(`tr[data-id="${cardId}"]`);
  if (!tr) return;
  // Clear price override when ROI drives the calc
  delete state.priceRowPrice[cardId];

  const roi = getRowRoi(cardId);
  const hasTiers = p.commission_tiers && p.commission_tiers.length > 0;
  const result = p.cogs > 0 && hasTiers ? calcPriceFromROI(p.cogs, roi, p.commission_tiers, p) : null;
  const effectivePrice = result ? result.price : null;
  const commPct = effectivePrice && hasTiers ? (findCommRate(effectivePrice, p.commission_tiers) * 100).toFixed(1) : null;

  const cells = tr.querySelectorAll("td");

  // Commission (index 2)
  cells[2].textContent = commPct ? commPct + "%" : "\u2014";

  // Price input (index 4)
  const priceInput = cells[4].querySelector(".price-calc-input");
  if (priceInput) {
    priceInput.value = effectivePrice || "";
    priceInput.classList.remove("price-input-overridden");
  }

  // Apply buttons data-price
  const minBtn = cells[5].querySelector(".price-apply-btn");
  if (minBtn && effectivePrice) minBtn.dataset.price = effectivePrice;
  const saleBtn = cells[6].querySelector(".price-apply-btn");
  if (saleBtn && effectivePrice) saleBtn.dataset.price = effectivePrice;
}

// Recalc from price change → updates ROI + commission
function recalcRowFromPrice(cardId) {
  const p = state.priceProducts.find((x) => x.id === cardId);
  if (!p) return;
  const tr = document.querySelector(`tr[data-id="${cardId}"]`);
  if (!tr) return;
  const price = state.priceRowPrice[cardId];
  if (!price || !p.cogs || p.cogs <= 0) return;
  const hasTiers = p.commission_tiers && p.commission_tiers.length > 0;
  const result = hasTiers ? calcROIFromPrice(p.cogs, price, p.commission_tiers, p) : null;
  const commPct = result ? (result.commRate * 100).toFixed(1) : null;
  const newRoi = result ? result.roi : 0;

  const cells = tr.querySelectorAll("td");

  // Commission (index 2)
  cells[2].textContent = commPct ? commPct + "%" : "\u2014";

  // ROI input (index 3)
  const roiInput = cells[3].querySelector(".price-roi-input");
  if (roiInput) {
    roiInput.value = Math.round(newRoi);
    roiInput.classList.add("roi-input-overridden");
  }
  // Store computed ROI as override so tooltip uses it
  state.priceRowRoi[cardId] = Math.round(newRoi);

  // Apply buttons data-price
  const minBtn = cells[5].querySelector(".price-apply-btn");
  if (minBtn) minBtn.dataset.price = price;
  const saleBtn = cells[6].querySelector(".price-apply-btn");
  if (saleBtn) saleBtn.dataset.price = price;
}

function recalcAllPriceRows() {
  // Reset price overrides when global ROI changes
  state.priceRowPrice = {};
  state.priceProducts.forEach((p) => recalcPriceRow(p.id));
}

// --- Apply prices to Ozon ---

async function applyPriceToOzon(updates) {
  if (!updates.length) return;
  try {
    const result = await apiRequest("/pricing/set-prices", { method: "POST", body: { updates } });
    const ok = new Set(result.succeeded || []);
    if (result.errors && result.errors.length) {
      const msgs = result.errors.map(e => `${e.offer_id}: ${(e.errors || []).join(", ")}`).join("\n");
      showToast(`Установлено ${result.updated}, ошибок: ${result.errors.length}\n${msgs}`, "error");
    } else {
      showToast(`Цены установлены: ${result.updated} товаров`);
    }
    // Update local state only for succeeded items
    for (const u of updates) {
      if (!ok.has(u.offer_id)) continue;
      const p = state.priceProducts.find((x) => x.ozon_offer_id === u.offer_id);
      if (p) {
        if (u.price != null) p.ozon_price = u.price;
        if (u.min_price != null) p.ozon_min_price = u.min_price;
      }
    }
    renderPriceProducts();
  } catch (e) {
    showToast("Ошибка установки цен: " + (e.message || ""), "error");
  }
}

// --- Event listeners ---

// Global ROI slider + input sync
$("priceRoiSlider").addEventListener("input", (e) => {
  const val = Number(e.target.value);
  state.priceGlobalRoi = val;
  state.priceRowRoi = {};
  $("priceRoiInput").value = val;
  recalcAllPriceRows();
  // Remove all ROI override highlights
  document.querySelectorAll(".price-roi-input").forEach((i) => i.classList.remove("roi-input-overridden"));
});
$("priceRoiInput").addEventListener("change", (e) => {
  const val = Math.max(0, Math.min(500, Number(e.target.value) || 0));
  state.priceGlobalRoi = val;
  state.priceRowRoi = {};
  $("priceRoiSlider").value = Math.min(200, val);
  $("priceRoiInput").value = val;
  recalcAllPriceRows();
  document.querySelectorAll(".price-roi-input").forEach((i) => i.classList.remove("roi-input-overridden"));
});

// Per-row ROI input (event delegation)
$("priceProductsBody").addEventListener("input", (e) => {
  const roiInp = e.target.closest(".price-roi-input");
  if (roiInp) {
    const cardId = roiInp.dataset.id;
    const val = Number(roiInp.value);
    if (val === state.priceGlobalRoi) {
      delete state.priceRowRoi[cardId];
      roiInp.classList.remove("roi-input-overridden");
    } else {
      state.priceRowRoi[cardId] = val;
      roiInp.classList.add("roi-input-overridden");
    }
    recalcPriceRow(cardId);
    return;
  }

  // Per-row price input
  const priceInp = e.target.closest(".price-calc-input");
  if (priceInp) {
    const cardId = priceInp.dataset.id;
    const val = Number(priceInp.value);
    if (val > 0) {
      state.priceRowPrice[cardId] = val;
      priceInp.classList.add("price-input-overridden");
      recalcRowFromPrice(cardId);
    } else {
      delete state.priceRowPrice[cardId];
      priceInp.classList.remove("price-input-overridden");
      recalcPriceRow(cardId);
    }
    return;
  }
});

// Tooltip hover for price cells and ROI cells (event delegation)
$("priceProductsBody").addEventListener("mouseenter", (e) => {
  const priceWrap = e.target.closest(".price-calc-wrap");
  if (priceWrap) {
    const cardId = priceWrap.dataset.id;
    const p = state.priceProducts.find((x) => x.id === cardId);
    if (!p || !p.cogs) return;
    const price = getRowPrice(cardId);
    const roi = getRowRoi(cardId);
    if (!price) return;
    const html = buildPriceTooltipHTML(p.cogs, roi, price, p.commission_tiers || [], p);
    showPriceTooltip(priceWrap, html);
    return;
  }
  const roiWrap = e.target.closest(".price-roi-wrap");
  if (roiWrap) {
    const cardId = roiWrap.dataset.id;
    const p = state.priceProducts.find((x) => x.id === cardId);
    if (!p || !p.cogs) return;
    const price = getRowPrice(cardId);
    if (!price) return;
    const html = buildROITooltipHTML(p.cogs, price, p.commission_tiers || [], p);
    showPriceTooltip(roiWrap, html);
    return;
  }
}, true);
$("priceProductsBody").addEventListener("mouseleave", (e) => {
  if (e.target.closest(".price-calc-wrap") || e.target.closest(".price-roi-wrap")) {
    hidePriceTooltip();
  }
}, true);

// Per-row apply button (event delegation)
$("priceProductsBody").addEventListener("click", (e) => {
  const btn = e.target.closest(".price-apply-btn");
  if (!btn) return;
  const action = btn.dataset.action;
  const offerId = btn.dataset.offer;
  const price = Number(btn.dataset.price);
  if (!offerId || !price) return;
  const update = { offer_id: offerId };
  if (action === "min") update.min_price = price;
  else update.price = price;
  applyPriceToOzon([update]);
});

// Bulk apply buttons
$("priceApplyAllMin").addEventListener("click", () => {
  const updates = [];
  for (const p of state.priceProducts) {
    if (!p.ozon_offer_id || !p.cogs || p.cogs <= 0 || !p.commission_tiers?.length) continue;
    const price = getRowPrice(p.id);
    if (price) updates.push({ offer_id: p.ozon_offer_id, min_price: price });
  }
  if (!updates.length) { showToast("Нет товаров с расчётной ценой", "error"); return; }
  applyPriceToOzon(updates);
});

$("priceApplyAllSale").addEventListener("click", () => {
  const updates = [];
  for (const p of state.priceProducts) {
    if (!p.ozon_offer_id || !p.cogs || p.cogs <= 0 || !p.commission_tiers?.length) continue;
    const price = getRowPrice(p.id);
    if (price) updates.push({ offer_id: p.ozon_offer_id, price });
  }
  if (!updates.length) { showToast("Нет товаров с расчётной ценой", "error"); return; }
  applyPriceToOzon(updates);
});

// --- Calculator tab ---

async function loadCalcCategories() {
  try {
    const data = await apiRequest("/pricing/categories");
    state.calcCategories = data.categories || [];
  } catch (e) {
    showToast("Ошибка загрузки категорий", "error");
  }
}

function showCategoryDropdown(filter) {
  const dd = $("calcCategoryDropdown");
  const lower = (filter || "").toLowerCase();
  const matches = state.calcCategories.filter((c) => c.toLowerCase().includes(lower)).slice(0, 50);
  if (!matches.length || !lower) { dd.classList.add("hidden"); return; }
  dd.innerHTML = matches.map((c) =>
    `<div class="px-3 py-2 cursor-pointer hover:bg-indigo-50 dark:hover:bg-slate-700 text-sm text-slate-700 dark:text-slate-200 calc-cat-option">${esc(c)}</div>`
  ).join("");
  dd.classList.remove("hidden");
  dd.querySelectorAll(".calc-cat-option").forEach((opt) => {
    opt.addEventListener("click", () => selectCategory(opt.textContent));
  });
}

async function selectCategory(cat) {
  $("calcCategoryInput").value = cat;
  $("calcCategoryDropdown").classList.add("hidden");
  const sel = $("calcTypeSelect");
  sel.innerHTML = '<option value="">Загрузка...</option>';
  sel.disabled = true;
  try {
    const data = await apiRequest(`/pricing/categories/${encodeURIComponent(cat)}/types`);
    state.calcTypes = data.types || [];
    sel.innerHTML = '<option value="">Выберите тип</option>' +
      state.calcTypes.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    sel.disabled = false;
  } catch (e) {
    sel.innerHTML = '<option value="">Ошибка загрузки</option>';
    showToast("Ошибка загрузки типов", "error");
  }
}

$("calcCategoryInput").addEventListener("input", (e) => {
  showCategoryDropdown(e.target.value);
});

// Close dropdown on outside click
document.addEventListener("click", (e) => {
  const dd = $("calcCategoryDropdown");
  if (dd && !dd.contains(e.target) && e.target.id !== "calcCategoryInput") {
    dd.classList.add("hidden");
  }
});

$("calcRunBtn").addEventListener("click", async () => {
  const category = $("calcCategoryInput").value.trim();
  const product_type = $("calcTypeSelect").value;
  const cogs = parseFloat($("calcCogsInput").value);
  const last_mile = parseFloat($("calcLastMile").value) || 63;
  const target_margin = parseFloat($("calcTargetMargin").value);
  const sale_price = parseFloat($("calcSalePrice").value);
  const usn_rate = parseFloat($("calcUsnRate").value) || 7;
  const return_rate = parseFloat($("calcReturnRate").value) || 5;
  const return_logistics = parseFloat($("calcReturnLogistics").value) || 50;

  if (!category || !product_type) { showToast("Выберите категорию и тип товара", "error"); return; }
  if (!cogs || cogs <= 0) { showToast("Введите себестоимость", "error"); return; }

  const btn = $("calcRunBtn");
  btn.disabled = true;
  btn.textContent = "Считаем...";

  try {
    const payload = {
      cogs_rub: cogs,
      category,
      product_type,
      scheme: "FBO",
      last_mile_rub: last_mile,
      usn_rate_pct: usn_rate,
      return_rate_pct: return_rate,
      return_logistics_rub: return_logistics,
      margin_targets: [0, 10, 15, 20, 25, 30],
    };
    if (sale_price > 0) {
      payload.sale_price_rub = sale_price;
      delete payload.margin_targets;
    } else if (!isNaN(target_margin)) {
      payload.target_margin_pct = target_margin;
    }
    const result = await apiRequest("/pricing/breakeven", { method: "POST", body: payload });
    renderCalcResult(result);
  } catch (e) {
    $("calcResultContent").innerHTML = `<div class="text-red-500">Ошибка: ${esc(e.message || "Неизвестная ошибка")}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Рассчитать";
  }
});

function renderCalcResult(data) {
  const el = $("calcResultContent");
  if (data.error) { el.innerHTML = `<div class="text-red-500">${esc(data.error)}</div>`; return; }

  // Multi-margin mode
  if (data.margin_results) {
    const rows = data.margin_results.map((r) => {
      if (r.error) return `<tr><td class="px-3 py-2 text-sm">${r.target_margin_pct}%</td><td colspan="2" class="px-3 py-2 text-sm text-red-500">${esc(r.error)}</td></tr>`;
      return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
        <td class="px-3 py-2 text-sm font-medium">${r.target_margin_pct}%</td>
        <td class="px-3 py-2 text-sm text-right font-semibold">${Number(r.sale_price_rub).toLocaleString("ru-RU", {maximumFractionDigits: 0})} ₽</td>
        <td class="px-3 py-2 text-sm text-right ${r.profit_rub >= 0 ? "text-emerald-600" : "text-red-500"}">${Number(r.profit_rub).toLocaleString("ru-RU", {maximumFractionDigits: 0})} ₽</td>
      </tr>`;
    }).join("");
    el.innerHTML = `
      <table class="w-full"><thead><tr class="border-b border-slate-200 dark:border-slate-700">
        <th class="px-3 py-2 text-left text-xs uppercase text-slate-500">Маржа</th>
        <th class="px-3 py-2 text-right text-xs uppercase text-slate-500">Цена продажи</th>
        <th class="px-3 py-2 text-right text-xs uppercase text-slate-500">Прибыль</th>
      </tr></thead><tbody class="divide-y divide-slate-100 dark:divide-slate-800">${rows}</tbody></table>
      ${data.margin_results[0] && data.margin_results[0].breakdown ? renderBreakdown(data.margin_results[0].breakdown) : ""}`;
    return;
  }

  // Single result (forward or single-margin)
  const r = data;
  const sp = r.sale_price_rub || r.breakeven_price_rub || 0;
  const margin = r.actual_margin_pct != null ? r.actual_margin_pct : (r.target_margin_pct || 0);
  const profit = r.profit_rub || 0;
  const marginCls = margin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400";

  el.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-baseline gap-3">
        <span class="text-2xl font-bold text-slate-800 dark:text-white">${Number(sp).toLocaleString("ru-RU", {maximumFractionDigits: 0})} ₽</span>
        <span class="text-sm ${marginCls} font-semibold">маржа ${margin.toFixed(1)}%</span>
        <span class="text-sm text-slate-500">прибыль ${Number(profit).toLocaleString("ru-RU", {maximumFractionDigits: 0})} ₽</span>
      </div>
      ${r.breakdown ? renderBreakdown(r.breakdown) : ""}
      ${r.breakeven_price_rub ? `<div class="text-xs text-slate-400 mt-2">Цена безубытка: ${Number(r.breakeven_price_rub).toLocaleString("ru-RU", {maximumFractionDigits: 0})} ₽</div>` : ""}
    </div>`;
}

function renderBreakdown(b) {
  const line = (label, val, suffix) => val != null ?
    `<div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">${label}</span><span class="text-slate-800 dark:text-slate-200">${Number(val).toLocaleString("ru-RU", {maximumFractionDigits: 2})}${suffix || " ₽"}</span></div>` : "";
  return `<div class="mt-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg space-y-1 text-sm">
    <div class="text-xs uppercase font-semibold text-slate-400 mb-2">Раскладка затрат на единицу</div>
    ${line("Себестоимость", b.cogs_rub)}
    ${b.commission_rub != null ? `<div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Комиссия Ozon${b.commission_pct != null ? ` (${b.commission_pct.toFixed(1)}%)` : ""}</span><span class="text-slate-800 dark:text-slate-200">${Number(b.commission_rub).toLocaleString("ru-RU", {maximumFractionDigits: 2})} ₽</span></div>` : ""}
    ${line("Эквайринг", b.acquiring_rub)}
    ${line("Последняя миля", b.last_mile_rub)}
    ${line("Хранение", b.storage_rub)}
    ${line("Возвраты", b.return_cost_rub)}
    ${line("Налог (УСН)", b.tax_rub)}
    <div class="border-t border-slate-200 dark:border-slate-700 pt-1 mt-1 flex justify-between font-semibold">
      <span>Итого затрат</span><span>${Number(b.total_costs).toLocaleString("ru-RU", {maximumFractionDigits: 2})} ₽</span>
    </div>
  </div>`;
}

/* ============================================================ */
/* Promotions Section                                           */
/* ============================================================ */

async function loadPromoData() {
  const loading = $("promoLoading");
  const empty = $("promoEmpty");
  const tbody = $("promoTableBody");
  if (loading) loading.classList.remove("hidden");
  if (empty) empty.classList.add("hidden");
  if (tbody) tbody.innerHTML = "";

  try {
    const data = await apiRequest("/promotions/price-index");
    state.promoItems = data.items || [];
    state.promoLoaded = true;
    renderPromoTable();
  } catch (e) {
    showToast("Ошибка загрузки: " + (e.message || e), "error");
  } finally {
    if (loading) loading.classList.add("hidden");
  }
}

function promoIndexBadge(color) {
  const map = {
    SUPER: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400", label: "Super" },
    GREEN: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-400", label: "Выгодная" },
    RED: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-400", label: "Завышена" },
    WITHOUT_INDEX: { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-500", label: "—" },
  };
  const s = map[color] || map.WITHOUT_INDEX;
  return `<span class="inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${s.bg} ${s.text}">${s.label}</span>`;
}

function promoTimerDisplay(item) {
  if (!item.timer_enabled || !item.timer_expires_at) {
    return `<span class="text-xs text-slate-400">—</span>`;
  }
  const expires = new Date(item.timer_expires_at);
  const now = new Date();
  const days = Math.max(0, Math.ceil((expires - now) / (1000 * 60 * 60 * 24)));
  let color = "text-emerald-600 dark:text-emerald-400";
  if (days <= 7) color = "text-red-600 dark:text-red-400";
  else if (days <= 14) color = "text-amber-600 dark:text-amber-400";
  return `<span class="text-xs font-medium ${color}">${days}д</span>
    <button onclick="refreshTimer(${item.product_id})" class="ml-1 text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300" title="Обновить таймер (сброс на 30 дней)">
      <svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
    </button>`;
}

function promoToggle(offerId, field, currentValue, price) {
  const checked = currentValue ? "checked" : "";
  return `<label class="relative inline-flex items-center cursor-pointer">
    <input type="checkbox" ${checked} class="sr-only peer"
      onchange="togglePromoFlag('${esc(offerId)}','${field}',this.checked,${price})">
    <div class="w-9 h-5 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
  </label>`;
}

function renderPromoTable() {
  const tbody = $("promoTableBody");
  const empty = $("promoEmpty");
  if (!tbody) return;

  const items = [...state.promoItems];
  // Sort
  const { field, dir } = state.promoSort;
  items.sort((a, b) => {
    let va = a[field], vb = b[field];
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return dir === "asc" ? -1 : 1;
    if (va > vb) return dir === "asc" ? 1 : -1;
    return 0;
  });

  if (!items.length) {
    tbody.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");

  tbody.innerHTML = items
    .map(
      (it) => `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <td class="px-3 py-2.5">
        <div class="text-sm font-medium text-slate-900 dark:text-white">${esc(it.title)}</div>
        ${it.sku ? `<div class="text-xs text-slate-400">${esc(it.sku)}</div>` : ""}
      </td>
      <td class="px-3 py-2.5 text-right text-sm text-slate-700 dark:text-slate-300 font-mono">${it.price ? it.price.toLocaleString("ru-RU") : "—"}</td>
      <td class="px-3 py-2.5 text-right">
        <div class="flex items-center justify-end gap-1">
          <input type="number" value="${it.min_price || ""}" min="0" step="1"
            class="w-20 text-sm text-right font-mono border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
            data-offer="${esc(it.offer_id)}" data-price="${it.price}" data-orig="${it.min_price || 0}"
            onchange="onMinPriceChange(this)">
          <button class="promo-save-min hidden px-1.5 py-0.5 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 transition-colors"
            data-offer="${esc(it.offer_id)}" data-price="${it.price}"
            onclick="saveMinPrice(this)">OK</button>
        </div>
      </td>
      <td class="px-3 py-2.5 text-center">${promoTimerDisplay(it)}</td>
      <td class="px-3 py-2.5 text-center">${promoIndexBadge(it.color_index)}</td>
      <td class="px-3 py-2.5 text-center">${promoToggle(it.offer_id, "auto_action_enabled", it.auto_action_enabled, it.price)}</td>
      <td class="px-3 py-2.5 text-center">${promoToggle(it.offer_id, "auto_add_to_ozon_actions_list_enabled", it.auto_add_to_ozon_actions_list_enabled, it.price)}</td>
      <td class="px-3 py-2.5 text-center">
        ${it.actions_count > 0 ? `<span class="inline-flex items-center justify-center w-6 h-6 text-xs font-bold rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400" title="${it.actions.map((a) => a.title).join('\n')}">${it.actions_count}</span>` : `<span class="text-xs text-slate-400">—</span>`}
      </td>
    </tr>`,
    )
    .join("");
}

function onMinPriceChange(input) {
  const orig = parseFloat(input.dataset.orig) || 0;
  const cur = parseFloat(input.value) || 0;
  const btn = input.nextElementSibling;
  if (btn) btn.classList.toggle("hidden", cur === orig);
}

async function saveMinPrice(btn) {
  const offerId = btn.dataset.offer;
  const price = parseFloat(btn.dataset.price);
  const input = btn.previousElementSibling;
  const minPrice = parseFloat(input.value) || 0;

  btn.disabled = true;
  btn.textContent = "...";
  try {
    const res = await apiRequest("/promotions/update-actions", {
      method: "POST",
      body: { updates: [{ offer_id: offerId, price, min_price: minPrice }] },
    });
    if (res.errors && res.errors.length) {
      showToast("Ошибка: " + JSON.stringify(res.errors[0].errors), "error");
    } else {
      showToast("Мин. цена обновлена", "success");
      input.dataset.orig = String(minPrice);
      btn.classList.add("hidden");
      // Update local state
      const item = state.promoItems.find((i) => i.offer_id === offerId);
      if (item) item.min_price = minPrice;
    }
  } catch (e) {
    showToast("Ошибка: " + (e.message || e), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "OK";
  }
}

async function togglePromoFlag(offerId, field, enabled, price) {
  const value = enabled ? "ENABLED" : "DISABLED";
  try {
    const res = await apiRequest("/promotions/update-actions", {
      method: "POST",
      body: { updates: [{ offer_id: offerId, price, [field]: value }] },
    });
    if (res.errors && res.errors.length) {
      showToast("Ошибка: " + JSON.stringify(res.errors[0].errors), "error");
      // Revert toggle visually
      renderPromoTable();
    } else {
      // Update local state
      const item = state.promoItems.find((i) => i.offer_id === offerId);
      if (item) {
        if (field === "auto_action_enabled") item.auto_action_enabled = enabled;
        else if (field === "auto_add_to_ozon_actions_list_enabled") item.auto_add_to_ozon_actions_list_enabled = enabled;
      }
      showToast(enabled ? "Включено" : "Выключено", "success");
    }
  } catch (e) {
    showToast("Ошибка: " + (e.message || e), "error");
    renderPromoTable();
  }
}

async function refreshTimer(productId) {
  try {
    await apiRequest("/promotions/refresh-timers", {
      method: "POST",
      body: { product_ids: [productId] },
    });
    showToast("Таймер обновлён на 30 дней", "success");
    // Update local state
    const item = state.promoItems.find((i) => i.product_id === productId);
    if (item) {
      item.timer_enabled = true;
      item.timer_expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      renderPromoTable();
    }
  } catch (e) {
    showToast("Ошибка: " + (e.message || e), "error");
  }
}

async function bulkTogglePromo(field, value) {
  if (!state.promoItems.length) return;
  const updates = state.promoItems.map((it) => ({
    offer_id: it.offer_id,
    price: it.price,
    [field]: value,
  }));
  try {
    const res = await apiRequest("/promotions/update-actions", {
      method: "POST",
      body: { updates },
    });
    const errCount = (res.errors || []).length;
    if (errCount) showToast(`Обновлено ${res.updated}, ошибок: ${errCount}`, "warning");
    else showToast(`Обновлено: ${res.updated}`, "success");
    // Reload to get fresh state
    state.promoLoaded = false;
    loadPromoData();
  } catch (e) {
    showToast("Ошибка: " + (e.message || e), "error");
  }
}

async function bulkRefreshTimers() {
  if (!state.promoItems.length) return;
  const productIds = state.promoItems.map((it) => it.product_id).filter(Boolean);
  try {
    await apiRequest("/promotions/refresh-timers", {
      method: "POST",
      body: { product_ids: productIds },
    });
    showToast("Все таймеры обновлены на 30 дней", "success");
    state.promoLoaded = false;
    loadPromoData();
  } catch (e) {
    showToast("Ошибка: " + (e.message || e), "error");
  }
}

// Promo load button
document.addEventListener("DOMContentLoaded", () => {
  const promoLoadBtn = $("promoLoadBtn");
  if (promoLoadBtn) {
    promoLoadBtn.addEventListener("click", () => {
      state.promoLoaded = false;
      loadPromoData();
    });
  }
});

/* ============================================================ */
/* MCP Section                                                  */
/* ============================================================ */
const MCP_SERVER_URL = window.location.origin + "/mcp/";

async function loadMcpSection() {
  state.mcpLoaded = true;
  await loadApiKeys();
  renderMcpSnippets();
}

function renderMcpSnippets(apiKey) {
  const key = apiKey || "<YOUR_API_KEY>";
  $("mcpSnippetClaude").textContent =
    `claude mcp add \\\n  --transport http \\\n  --header "Authorization: Bearer ${key}" \\\n  -s user \\\n  openmpflow-erp \\\n  "${MCP_SERVER_URL}"`;
  $("mcpSnippetCursor").textContent = JSON.stringify({
    mcpServers: {
      "openmpflow-erp": {
        type: "http",
        url: MCP_SERVER_URL,
        headers: { Authorization: `Bearer ${key}` },
      },
    },
  }, null, 2);
  $("mcpSnippetCurl").textContent =
    `curl -X POST ${MCP_SERVER_URL} \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;
}

// MCP tab switching
document.querySelectorAll(".mcp-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".mcp-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".mcp-tab-content").forEach((c) => c.classList.add("hidden"));
    tab.classList.add("active");
    const target = tab.dataset.mcpTab;
    const pane = $("mcpTab" + target.charAt(0).toUpperCase() + target.slice(1));
    if (pane) pane.classList.remove("hidden");
  });
});

// Copy MCP URL
$("copyMcpUrlBtn").addEventListener("click", () => {
  navigator.clipboard.writeText(MCP_SERVER_URL).then(
    () => showToast("URL скопирован"),
    () => showToast("Не удалось скопировать", "error")
  );
});

// Copy snippet buttons
document.querySelectorAll(".mcp-copy-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const pre = $(btn.dataset.snippet);
    if (!pre) return;
    navigator.clipboard.writeText(pre.textContent).then(
      () => showToast("Скопировано"),
      () => showToast("Не удалось скопировать", "error")
    );
  });
});

/* ============================================================ */
/* Settings                                                     */
/* ============================================================ */

async function loadSettings() {
  state.settingsLoaded = true;
  try {
    const data = await apiRequest("/settings");
    $("settingsUsnRate").value = data.usn_rate ?? 7;
  } catch (e) {
    console.warn("Failed to load settings", e);
  }
}

$("saveUsnRateBtn").addEventListener("click", async () => {
  const rate = parseFloat($("settingsUsnRate").value);
  if (isNaN(rate) || rate < 0 || rate > 100) {
    showToast("Укажите ставку от 0 до 100", "error");
    return;
  }
  try {
    await apiRequest("/settings", { method: "PUT", body: { usn_rate: rate } });
    showToast("Ставка сохранена");
  } catch (e) {
    showToast("Ошибка: " + (e.message || ""), "error");
  }
});

async function loadApiKeys() {
  const tbody = $("apiKeysTableBody");
  const empty = $("apiKeysEmpty");
  try {
    const data = await apiRequest("/api-keys");
    const keys = (data.items || []).filter((k) => !k.revoked_at);
    if (keys.length === 0) {
      tbody.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    tbody.innerHTML = keys
      .map(
        (k) => `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
        <td class="px-4 py-3 text-sm text-slate-800 dark:text-slate-200 font-medium">${esc(k.name)}</td>
        <td class="px-4 py-3 text-sm text-slate-500 font-mono">${esc(k.key_prefix)}...</td>
        <td class="px-4 py-3 text-sm text-slate-500">${fmtDate(k.created_at)}</td>
        <td class="px-4 py-3 text-sm text-slate-500">${k.last_used_at ? fmtDate(k.last_used_at) : '<span class="text-slate-400">—</span>'}</td>
        <td class="px-4 py-3 text-right">
          <button class="revoke-key-btn text-xs text-red-500 hover:text-red-700 font-medium transition-colors" data-id="${esc(k.id)}">Отозвать</button>
        </td>
      </tr>`
      )
      .join("");
    tbody.querySelectorAll(".revoke-key-btn").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Отозвать этот ключ? Он перестанет работать.")) return;
        try {
          await apiRequest(`/api-keys/${btn.dataset.id}`, { method: "DELETE" });
          showToast("Ключ отозван");
          await loadApiKeys();
        } catch (e) {
          showToast("Ошибка: " + (e.message || ""), "error");
        }
      })
    );
  } catch (e) {
    tbody.innerHTML = "";
    empty.classList.remove("hidden");
  }
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Create API Key modal
$("createApiKeyBtn").addEventListener("click", () => {
  $("apiKeyNameInput").value = "";
  $("createApiKeyModal").classList.remove("hidden");
  $("apiKeyNameInput").focus();
});
$("closeCreateApiKeyBtn").addEventListener("click", () => $("createApiKeyModal").classList.add("hidden"));
$("createApiKeyModal").addEventListener("click", (e) => {
  if (e.target === $("createApiKeyModal")) $("createApiKeyModal").classList.add("hidden");
});

$("createApiKeyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("apiKeyNameInput").value.trim();
  if (!name) return;
  const btn = $("createApiKeySubmitBtn");
  btn.disabled = true;
  btn.textContent = "Создание...";
  try {
    const data = await apiRequest("/api-keys", {
      method: "POST",
      body: { name },
    });
    $("createApiKeyModal").classList.add("hidden");
    // Show the key
    $("apiKeyValue").textContent = data.raw_key;
    $("showApiKeyModal").classList.remove("hidden");
    renderMcpSnippets(data.raw_key);
    await loadApiKeys();
  } catch (e) {
    showToast("Ошибка: " + (e.message || ""), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Создать";
  }
});

// Show API Key modal
$("closeShowApiKeyBtn").addEventListener("click", () => $("showApiKeyModal").classList.add("hidden"));
$("doneShowApiKeyBtn").addEventListener("click", () => $("showApiKeyModal").classList.add("hidden"));
$("showApiKeyModal").addEventListener("click", (e) => {
  if (e.target === $("showApiKeyModal")) $("showApiKeyModal").classList.add("hidden");
});
$("copyApiKeyBtn").addEventListener("click", () => {
  const key = $("apiKeyValue").textContent;
  navigator.clipboard.writeText(key).then(
    () => showToast("Скопировано"),
    () => showToast("Не удалось скопировать", "error")
  );
});

/* ============================================================ */
/* Boot                                                         */
/* ============================================================ */
window.addEventListener("hashchange", () => {
  if (state.user) setActiveSection(sectionFromHash());
});

function showLoginUI() {
  $("passwordLoginForm").classList.remove("hidden");
}

async function bootApp() {
  console.log("[auth] bootApp at:", window.location.pathname);

  // Check stored token
  if (_hmacToken) {
    try {
      const resp = await fetch(`${API_BASE}/auth/me`, {
        headers: { "Authorization": `Bearer ${_hmacToken}` },
      });
      if (resp.ok) {
        setLoginMode(false);
        setActiveSection(sectionFromHash());
        await bootstrapApp();
        return;
      }
    } catch (_) { /* token invalid or expired */ }
    _hmacToken = null;
    localStorage.removeItem("_mpflow_token");
  }
  setLoginMode(true);
  showLoginUI();
}

(async () => {
  initTheme();
  try {
    await bootApp();
  } catch (err) {
    console.error("[auth] Init error:", err);
    setLoginMode(true);
    showLoginUI();
  }
})();
