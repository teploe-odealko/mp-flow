import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import type { FinanceService } from "../modules/finance/service.js"

const finance = new Hono<{ Variables: Record<string, any> }>()

// GET /api/finance
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

// POST /api/finance
finance.post("/", async (c) => {
  const service: FinanceService = c.get("container").resolve("financeService")
  const userId = getUserId(c)
  const body = await c.req.json()

  const transaction = await service.createFinanceTransactions({
    ...body, transaction_date: body.transaction_date || new Date(), user_id: userId || null,
  })
  return c.json({ transaction }, 201)
})

export default finance
