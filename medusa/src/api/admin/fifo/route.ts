import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { FIFO_LOT_MODULE } from "../../../modules/fifo-lot";

// GET /admin/fifo — list FIFO lots
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve(FIFO_LOT_MODULE);

  const { master_card_id, has_remaining } = req.query as {
    master_card_id?: string;
    has_remaining?: string;
  };

  const userId = (req as any).auth_context?.actor_id;

  const filters: any = {};
  if (userId) filters.user_id = userId;
  if (master_card_id) filters.master_card_id = master_card_id;
  if (has_remaining === "true") filters.remaining_qty = { $gt: 0 };

  const lots = await service.listFifoLots(filters, {
    order: { received_at: "ASC" },
  });

  const totalRemaining = lots.reduce(
    (sum: number, lot: any) => sum + lot.remaining_qty,
    0
  );
  const totalValue = lots.reduce(
    (sum: number, lot: any) => sum + lot.remaining_qty * Number(lot.cost_per_unit),
    0
  );

  res.json({
    lots,
    count: lots.length,
    total_remaining_qty: totalRemaining,
    total_value: totalValue,
  });
}

// POST /admin/fifo — create a new FIFO lot (usually from supplier order receipt)
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve(FIFO_LOT_MODULE);

  const userId = (req as any).auth_context?.actor_id;

  const body = req.body as Record<string, any>;
  const lot = await service.createFifoLots({
    ...body,
    remaining_qty: body.initial_qty,
    received_at: body.received_at || new Date(),
    user_id: userId || null,
  });

  res.status(201).json({ lot });
}
