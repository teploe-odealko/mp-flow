import { Hono } from "hono";
import { getUserId } from "../core/auth.js";
const finance = new Hono();
// GET /api/finance
finance.get("/", async (c) => {
    const service = c.get("container").resolve("financeService");
    const userId = getUserId(c);
    const { from, to } = c.req.query();
    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const toDate = to ? new Date(to) : new Date();
    const filters = {};
    if (userId)
        filters.user_id = userId;
    const pnl = await service.calculatePnl(fromDate, toDate, filters);
    return c.json({ period: { from: fromDate.toISOString(), to: toDate.toISOString() }, ...pnl });
});
// POST /api/finance
finance.post("/", async (c) => {
    const service = c.get("container").resolve("financeService");
    const userId = getUserId(c);
    const body = await c.req.json();
    const transaction = await service.createFinanceTransactions({
        ...body, transaction_date: body.transaction_date || new Date(), user_id: userId || null,
    });
    return c.json({ transaction }, 201);
});
export default finance;
//# sourceMappingURL=finance.js.map