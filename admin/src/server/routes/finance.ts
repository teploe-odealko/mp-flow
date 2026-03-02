import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import type { FinanceService } from "../modules/finance/service.js"

const finance = new Hono<{ Variables: Record<string, any> }>()

// GET /api/finance — summary P&L
finance.get("/", async (c) => {
  const service: FinanceService = c.get("container").resolve("financeService")
  const userId = getUserId(c)
  const { from, to } = c.req.query()

  const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const toDate = to ? new Date(to) : new Date()

  const filters: Record<string, any> = {}
  if (userId) filters.user_id = userId

  const pnl = await service.calculatePnl(fromDate, toDate, filters)
  return c.json({ period: { from: fromDate.toISOString(), to: toDate.toISOString() }, ...pnl })
})

// GET /api/finance/transactions — list with pagination
finance.get("/transactions", async (c) => {
  const service: FinanceService = c.get("container").resolve("financeService")
  const userId = getUserId(c)
  const { from, to, type, direction, source, search, limit, offset } = c.req.query()

  const filters: Record<string, any> = {}
  if (userId) filters.user_id = userId
  if (type) filters.type = type
  if (direction) filters.direction = direction
  if (source) filters.source = source
  if (search) filters.search = search

  if (from || to) {
    const dateFilter: Record<string, any> = {}
    if (from) dateFilter.$gte = new Date(from)
    if (to) dateFilter.$lte = new Date(to)
    filters.transaction_date = dateFilter
  }

  const result = await service.listFinanceTransactionsPaginated(
    filters,
    limit ? Number(limit) : 50,
    offset ? Number(offset) : 0,
  )

  return c.json({ transactions: result.items, total_count: result.total })
})

// POST /api/finance — create transaction
finance.post("/", async (c) => {
  const service: FinanceService = c.get("container").resolve("financeService")
  const userId = getUserId(c)
  const body = await c.req.json()

  const transaction = await service.createFinanceTransactions({
    ...body,
    transaction_date: body.transaction_date ? new Date(body.transaction_date) : new Date(),
    user_id: userId || null,
    source: body.source || "manual",
  })
  return c.json({ transaction }, 201)
})

// PUT /api/finance/:id — update transaction
finance.put("/:id", async (c) => {
  const service: FinanceService = c.get("container").resolve("financeService")
  const id = c.req.param("id")
  const body = await c.req.json()

  const transaction = await service.updateFinanceTransaction(id, body)
  return c.json({ transaction })
})

// DELETE /api/finance/:id — soft delete transaction
finance.delete("/:id", async (c) => {
  const service: FinanceService = c.get("container").resolve("financeService")
  const id = c.req.param("id")

  await service.deleteFinanceTransactions(id)
  return c.json({ ok: true })
})

export default finance
