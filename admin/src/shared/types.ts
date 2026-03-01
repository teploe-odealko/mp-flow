export interface PageInfo {
  offset: number
  limit: number
  count: number
}

export interface ListResponse<T> {
  items: T[]
  page: PageInfo
}

export interface ListQuery {
  offset?: number
  limit?: number
  search?: string
  order?: string
  direction?: "asc" | "desc"
}

export type Channel = "ozon" | "wb" | "yandex" | "manual"

export type SaleStatus = "active" | "delivered" | "returned"

export type OrderStatus = "draft" | "ordered" | "in_transit" | "delivered" | "cancelled"

export type TransactionType = "income" | "expense"

export type TransactionCategory =
  | "sale"
  | "purchase"
  | "logistics"
  | "commission"
  | "advertising"
  | "salary"
  | "other"

export interface SessionData {
  userId: string
  email: string
  name?: string
}
