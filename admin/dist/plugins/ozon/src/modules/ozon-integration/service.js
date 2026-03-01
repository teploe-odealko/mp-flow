import { OzonAccount, OzonProductLink, OzonStockSnapshot } from "./entities.js";
export class OzonIntegrationService {
    em;
    constructor(em) {
        this.em = em;
    }
    // ── Ozon Account CRUD ──
    async listOzonAccounts(filters = {}) {
        return this.em.find(OzonAccount, { ...filters, deleted_at: null });
    }
    async retrieveOzonAccount(id) {
        return this.em.findOneOrFail(OzonAccount, { id, deleted_at: null });
    }
    async createOzonAccount(data) {
        const account = this.em.create(OzonAccount, data);
        await this.em.persistAndFlush(account);
        return account;
    }
    async updateOzonAccount(id, data) {
        const account = await this.retrieveOzonAccount(id);
        this.em.assign(account, data);
        await this.em.flush();
        return account;
    }
    async deleteOzonAccount(id) {
        const account = await this.retrieveOzonAccount(id);
        account.deleted_at = new Date();
        await this.em.flush();
        return account;
    }
    // ── Ozon Product Link CRUD ──
    async listOzonProductLinks(filters = {}) {
        return this.em.find(OzonProductLink, { ...filters, deleted_at: null });
    }
    async createOzonProductLink(data) {
        const link = this.em.create(OzonProductLink, data);
        await this.em.persistAndFlush(link);
        return link;
    }
    async updateOzonProductLink(id, data) {
        const link = await this.em.findOneOrFail(OzonProductLink, { id, deleted_at: null });
        this.em.assign(link, data);
        await this.em.flush();
        return link;
    }
    // ── Ozon Stock Snapshot ──
    async listOzonStockSnapshots(filters = {}) {
        return this.em.find(OzonStockSnapshot, filters);
    }
    async createOzonStockSnapshot(data) {
        const snapshot = this.em.create(OzonStockSnapshot, data);
        await this.em.persistAndFlush(snapshot);
        return snapshot;
    }
    // ── Ozon API client ──
    async ozonApiCall(account, endpoint, body = {}) {
        const response = await fetch(`https://api-seller.ozon.ru${endpoint}`, {
            method: "POST",
            headers: {
                "Client-Id": account.client_id,
                "Api-Key": account.api_key,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Ozon API error ${response.status}: ${text}`);
        }
        return response.json();
    }
    async fetchOzonProducts(account) {
        const result = await this.ozonApiCall(account, "/v3/product/list", {
            filter: { visibility: "ALL" },
            limit: 1000,
        });
        return result.result?.items || [];
    }
    async fetchOzonProductInfo(account, productIds) {
        const result = await this.ozonApiCall(account, "/v3/product/info/list", {
            product_id: productIds,
        });
        return result.items || result.result?.items || [];
    }
    async fetchOzonStocks(account) {
        const result = await this.ozonApiCall(account, "/v2/analytics/stock_on_warehouses", { limit: 1000, offset: 0 });
        return result.result?.rows || [];
    }
    async fetchOzonPostings(account, since, to) {
        const result = await this.ozonApiCall(account, "/v2/posting/fbo/list", {
            dir: "DESC",
            filter: {
                since: since.toISOString(),
                to: to.toISOString(),
            },
            limit: 1000,
            offset: 0,
            with: { analytics_data: true, financial_data: true },
        });
        const data = result.result;
        return Array.isArray(data) ? data : data?.postings || [];
    }
    async fetchOzonFinanceTransactions(account, from, to) {
        const result = await this.ozonApiCall(account, "/v3/finance/transaction/list", {
            filter: {
                date: { from: from.toISOString(), to: to.toISOString() },
                transaction_type: "all",
            },
            page: 1,
            page_size: 1000,
        });
        return result.result?.operations || [];
    }
    classifyOzonService(serviceName) {
        const lower = serviceName.toLowerCase();
        if (lower.includes("lastmile") || lower.includes("last_mile") || lower.includes("flexibleshipment"))
            return { key: "last_mile", label: "Последняя миля" };
        if (lower.includes("pipeline") || lower.includes("deliverytocustomer"))
            return { key: "pipeline", label: "Доставка до покупателя" };
        if (lower.includes("fulfillment") || lower.includes("processing"))
            return { key: "fulfillment", label: "Обработка отправления" };
        if (lower.includes("dropoff") || lower.includes("drop_off"))
            return { key: "direct_flow", label: "Приёмка на складе" };
        if (lower.includes("acquiring"))
            return { key: "acquiring", label: "Эквайринг" };
        if (lower.includes("returnafterdelivery") || lower.includes("reverse"))
            return { key: "reverse_logistics", label: "Обратная логистика" };
        if (lower.includes("returnprocessing"))
            return { key: "return_processing", label: "Обработка возврата" };
        if (lower.includes("marketing") || lower.includes("promotion"))
            return { key: "marketplace_service", label: "Услуги маркетплейса" };
        return { key: "other_fees", label: "Прочие расходы" };
    }
}
//# sourceMappingURL=service.js.map