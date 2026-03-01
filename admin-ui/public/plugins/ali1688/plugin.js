/**
 * ali1688 plugin — Card tab "1688 Supplier"
 * Shows supplier data from 1688.com or a form to enrich the card.
 */

export function activate(host) {
  host.registerCardTabRenderer("cardTabSupplier", async (container, cardDetail) => {
    const item = cardDetail?.item;
    if (!item) {
      container.innerHTML = '<p class="text-sm text-slate-400">No card data</p>';
      return;
    }

    const sources = item.attributes?.sources || {};
    const supplierEntry = Object.values(sources).find(s => s.kind === "supplier");

    if (supplierEntry) {
      container.innerHTML = renderSupplierInfo(supplierEntry);
    } else {
      container.innerHTML = renderEnrichForm(host, item.id);
      setupFormHandler(container, host, item.id);
    }
  });
}

function renderSupplierInfo(entry) {
  const data = entry.data || {};
  const images = data.images || [];
  const skus = data.skus || [];

  return `
    <div class="space-y-4">
      <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
        <h3 class="text-base font-semibold text-slate-900 dark:text-white mb-3">
          ${esc(data.title || "Supplier Data")}
        </h3>
        ${data.url ? `<a href="${esc(data.url)}" target="_blank" class="text-xs text-sky-500 hover:underline">${esc(data.url)}</a>` : ""}
        ${data.supplier_name ? `<p class="text-sm text-slate-500 mt-1">Supplier: ${esc(data.supplier_name)}</p>` : ""}
        ${data.price_min || data.price_max ? `<p class="text-sm text-slate-600 dark:text-slate-400 mt-1">Price: ${esc(data.price_min || "?")} — ${esc(data.price_max || "?")} CNY</p>` : ""}
        <p class="text-xs text-slate-400 mt-2">Updated: ${esc(entry.updated_at || "")}</p>
      </div>

      ${images.length ? `
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
          <h4 class="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Photos (${images.length})</h4>
          <div class="grid grid-cols-4 gap-2">
            ${images.slice(0, 8).map(url => `<img src="${esc(url)}" class="rounded-lg w-full aspect-square object-cover border border-slate-200 dark:border-slate-700" />`).join("")}
          </div>
        </div>
      ` : ""}

      ${skus.length ? `
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
          <h4 class="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">SKU Variants (${skus.length})</h4>
          <div class="space-y-1 max-h-60 overflow-y-auto">
            ${skus.map(s => `
              <div class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 py-1">
                ${s.image ? `<img src="${esc(s.image)}" class="w-8 h-8 rounded object-cover" />` : ""}
                <span class="flex-1">${esc(s.name)}</span>
                ${s.price != null ? `<span class="font-mono">${s.price} CNY</span>` : ""}
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function renderEnrichForm(host, cardId) {
  return `
    <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
      <h3 class="text-base font-semibold text-slate-900 dark:text-white mb-3">Link 1688 Supplier</h3>
      <p class="text-sm text-slate-500 mb-4">Paste a 1688.com product URL to import supplier data (photos, prices, SKU variants).</p>
      <div class="flex gap-2">
        <input id="ali1688UrlInput" type="url" placeholder="https://detail.1688.com/offer/..."
          class="flex-1 px-3 py-2 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500" />
        <button id="ali1688EnrichBtn" class="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg transition-colors">
          Import
        </button>
      </div>
      <p id="ali1688Status" class="mt-2 text-xs text-slate-400 min-h-[16px]"></p>
    </div>
  `;
}

function setupFormHandler(container, host, cardId) {
  const btn = container.querySelector("#ali1688EnrichBtn");
  const input = container.querySelector("#ali1688UrlInput");
  const status = container.querySelector("#ali1688Status");
  if (!btn || !input) return;

  btn.addEventListener("click", async () => {
    const url = input.value.trim();
    if (!url) { status.textContent = "Please enter a URL"; return; }

    btn.disabled = true;
    btn.textContent = "Importing...";
    status.textContent = "Fetching data from 1688.com...";
    status.className = "mt-2 text-xs text-slate-400";

    try {
      await host.apiRequest(`/plugins/ali1688/enrich/${cardId}`, {
        method: "POST",
        body: { url },
      });
      status.textContent = "Done! Reloading card...";
      status.className = "mt-2 text-xs text-green-500";
      // Reload the card page to show enrichment
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      status.textContent = "Error: " + (e.message || String(e));
      status.className = "mt-2 text-xs text-red-500";
      btn.disabled = false;
      btn.textContent = "Import";
    }
  });
}

function esc(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
