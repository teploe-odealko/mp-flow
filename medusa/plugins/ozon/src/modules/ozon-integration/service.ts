import { MedusaService } from "@medusajs/framework/utils"
import OzonAccount from "./models/ozon-account"
import OzonProductLink from "./models/ozon-product-link"
import OzonStockSnapshot from "./models/ozon-stock-snapshot"

class OzonIntegrationModuleService extends MedusaService({
  OzonAccount,
  OzonProductLink,
  OzonStockSnapshot,
}) {
  /**
   * Call Ozon Seller API.
   */
  async ozonApiCall(
    account: { client_id: string; api_key: string },
    endpoint: string,
    body: Record<string, unknown> = {}
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

  /**
   * Fetch product list from Ozon.
   */
  async fetchOzonProducts(account: { client_id: string; api_key: string }) {
    const result: any = await this.ozonApiCall(account, "/v3/product/list", {
      filter: { visibility: "ALL" },
      limit: 1000,
    })
    return result.result?.items || []
  }

  /**
   * Fetch product details from Ozon.
   */
  async fetchOzonProductInfo(
    account: { client_id: string; api_key: string },
    productIds: number[]
  ) {
    const result: any = await this.ozonApiCall(account, "/v3/product/info/list", {
      product_id: productIds,
    })
    return result.items || result.result?.items || []
  }

  /**
   * Fetch FBO stock levels from Ozon.
   */
  async fetchOzonStocks(account: { client_id: string; api_key: string }) {
    const result: any = await this.ozonApiCall(
      account,
      "/v2/analytics/stock_on_warehouses",
      { limit: 1000, offset: 0 }
    )
    return result.result?.rows || []
  }

  /**
   * Fetch FBO postings (sales) from Ozon.
   */
  async fetchOzonPostings(
    account: { client_id: string; api_key: string },
    since: Date,
    to: Date
  ) {
    const result: any = await this.ozonApiCall(account, "/v2/posting/fbo/list", {
      dir: "DESC",
      filter: {
        since: since.toISOString(),
        to: to.toISOString(),
      },
      limit: 1000,
      offset: 0,
      with: { analytics_data: true, financial_data: true },
    })
    const data = result.result
    return Array.isArray(data) ? data : data?.postings || []
  }

  /**
   * Fetch finance transactions from Ozon for unit economics.
   */
  async fetchOzonFinanceTransactions(
    account: { client_id: string; api_key: string },
    from: Date,
    to: Date
  ) {
    const result: any = await this.ozonApiCall(
      account,
      "/v3/finance/transaction/list",
      {
        filter: {
          date: {
            from: from.toISOString(),
            to: to.toISOString(),
          },
          transaction_type: "all",
        },
        page: 1,
        page_size: 1000,
      }
    )
    return result.result?.operations || []
  }

  /**
   * Map Ozon service category to standard fee keys.
   */
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

export default OzonIntegrationModuleService
