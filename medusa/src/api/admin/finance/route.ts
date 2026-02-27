import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { FINANCE_MODULE } from "../../../modules/finance";

// GET /admin/finance — get P&L summary
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve(FINANCE_MODULE);
  const userId = (req as any).auth_context?.actor_id;

  const { from, to } = req.query as { from?: string; to?: string };

  const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const toDate = to ? new Date(to) : new Date();

  const filters: Record<string, any> = {};
  if (userId) filters.user_id = userId;

  const pnl = await service.calculatePnl(fromDate, toDate, filters);

  res.json({
    period: { from: fromDate.toISOString(), to: toDate.toISOString() },
    ...pnl,
  });
}

// POST /admin/finance — create transaction
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve(FINANCE_MODULE);

  const userId = (req as any).auth_context?.actor_id;

  const body = req.body as Record<string, any>;
  const transaction = await service.createFinanceTransactions({
    ...body,
    transaction_date: body.transaction_date || new Date(),
    user_id: userId || null,
  });

  res.status(201).json({ transaction });
}
