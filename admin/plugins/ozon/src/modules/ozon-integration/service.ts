import type { EntityManager } from "@mikro-orm/postgresql"
import { OzonAccount, OzonProductLink, OzonStockSnapshot } from "./entities.js"

export class OzonIntegrationService {
  constructor(private em: EntityManager) {}

  // ── Ozon Account CRUD ──
  async listOzonAccounts(filters: Record<string, any> = {}) {
    return this.em.find(OzonAccount, { ...filters, deleted_at: null })
  }

  async retrieveOzonAccount(id: string) {
    return this.em.findOneOrFail(OzonAccount, { id, deleted_at: null })
  }

  async createOzonAccount(data: Partial<OzonAccount>) {
    const account = this.em.create(OzonAccount, data as any)
    await this.em.persistAndFlush(account)
    return account
  }

  async updateOzonAccount(id: string, data: Partial<OzonAccount>) {
    const account = await this.retrieveOzonAccount(id)
    this.em.assign(account, data)
    await this.em.flush()
    return account
  }

  async deleteOzonAccount(id: string) {
    const account = await this.retrieveOzonAccount(id)
    account.deleted_at = new Date()
    await this.em.flush()
    return account
  }

  // ── Ozon Product Link CRUD ──
  async listOzonProductLinks(filters: Record<string, any> = {}) {
    return this.em.find(OzonProductLink, { ...filters, deleted_at: null })
  }

  async createOzonProductLink(data: Partial<OzonProductLink>) {
    const link = this.em.create(OzonProductLink, data as any)
    await this.em.persistAndFlush(link)
    return link
  }

  async updateOzonProductLink(id: string, data: Partial<OzonProductLink>) {
    const link = await this.em.findOneOrFail(OzonProductLink, { id, deleted_at: null })
    this.em.assign(link, data)
    await this.em.flush()
    return link
  }

  // ── Ozon Stock Snapshot ──
  async listOzonStockSnapshots(filters: Record<string, any> = {}) {
    return this.em.find(OzonStockSnapshot, filters)
  }

  async createOzonStockSnapshot(data: Partial<OzonStockSnapshot>) {
    const snapshot = this.em.create(OzonStockSnapshot, data as any)
    await this.em.persistAndFlush(snapshot)
    return snapshot
  }

  // ── Ozon API client ──
  async ozonApiCall(
    account: { client_id: string; api_key: string },
    endpoint: string,
    body: Record<string, unknown> = {},
  ) {
    const response = await fetch(`https://api-seller.ozon.ru${endpoint}`, {
      method: "POST",
      headers: {
        "Client-Id": account.client_id,
        "Api-Key": account.api_key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Ozon API error ${response.status}: ${text}`)
    }

    return response.json() as Promise<any>
  }

  async fetchOzonProducts(account: { client_id: string; api_key: string }) {
    const items: any[] = []
    let lastId = ""
    while (true) {
      const body: Record<string, any> = {
        filter: { visibility: "ALL" },
        limit: 1000,
      }
      if (lastId) body.last_id = lastId
      const result: any = await this.ozonApiCall(account, "/v3/product/list", body)
      const batch = result.result?.items || []
      items.push(...batch)
      lastId = result.result?.last_id || ""
      if (batch.length < 1000 || !lastId) break
    }
    return items
  }

  async fetchOzonProductInfo(
    account: { client_id: string; api_key: string },
    productIds: number[],
  ) {
    const result: any = await this.ozonApiCall(account, "/v3/product/info/list", {
      product_id: productIds,
    })
    return result.items || result.result?.items || []
  }

  async fetchOzonStocks(account: { client_id: string; api_key: string }) {
    const rows: any[] = []
    let offset = 0
    while (true) {
      const result: any = await this.ozonApiCall(
        account,
        "/v2/analytics/stock_on_warehouses",
        { limit: 1000, offset },
      )
      const batch = result.result?.rows || []
      rows.push(...batch)
      if (batch.length < 1000) break
      offset += batch.length
    }
    return rows
  }

  async fetchOzonPostings(
    account: { client_id: string; api_key: string },
    since: Date,
    to: Date,
  ) {
    const all: any[] = []
    let offset = 0
    while (true) {
      const result: any = await this.ozonApiCall(account, "/v2/posting/fbo/list", {
        dir: "DESC",
        filter: {
          since: since.toISOString(),
          to: to.toISOString(),
        },
        limit: 1000,
        offset,
        with: { analytics_data: true, financial_data: true },
      })
      const data = result.result
      const batch = Array.isArray(data) ? data : data?.postings || []
      all.push(...batch)
      if (batch.length < 1000) break
      offset += batch.length
    }
    return all
  }

  async fetchOzonFinanceTransactions(
    account: { client_id: string; api_key: string },
    from: Date,
    to: Date,
  ) {
    const result: any = await this.ozonApiCall(
      account,
      "/v3/finance/transaction/list",
      {
        filter: {
          date: { from: from.toISOString(), to: to.toISOString() },
          transaction_type: "all",
        },
        page: 1,
        page_size: 1000,
      },
    )
    return result.result?.operations || []
  }

  classifyOzonService(serviceName: string): { key: string; label: string } {
    const lower = serviceName.toLowerCase()
    if (lower.includes("lastmile") || lower.includes("last_mile") || lower.includes("flexibleshipment"))
      return { key: "last_mile", label: "Последняя миля" }
    if (lower.includes("pipeline") || lower.includes("deliverytocustomer"))
      return { key: "pipeline", label: "Доставка до покупателя" }
    if (lower.includes("fulfillment") || lower.includes("processing"))
      return { key: "fulfillment", label: "Обработка отправления" }
    if (lower.includes("dropoff") || lower.includes("drop_off"))
      return { key: "direct_flow", label: "Приёмка на складе" }
    if (lower.includes("acquiring"))
      return { key: "acquiring", label: "Эквайринг" }
    if (lower.includes("returnafterdelivery") || lower.includes("reverse"))
      return { key: "reverse_logistics", label: "Обратная логистика" }
    if (lower.includes("returnprocessing"))
      return { key: "return_processing", label: "Обработка возврата" }
    if (lower.includes("marketing") || lower.includes("promotion"))
      return { key: "marketplace_service", label: "Услуги маркетплейса" }
    return { key: "other_fees", label: "Прочие расходы" }
  }
}
