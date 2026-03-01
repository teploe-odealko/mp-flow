import type { CardLot, CardSale } from '@/stores/card-detail'

/**
 * Client-side FIFO fallback: enrich lots and sales with computed COGS
 * when backend data has cogs_rub=0 (old data before FIFO fix).
 *
 * Mutates the passed arrays in-place, tagging:
 *   sale._computed_cogs  — total cost consumed by this sale
 *   lot._computed_remaining — remaining qty after all sales consumed
 */
export function computeFifoFallback(lots: CardLot[], sales: CardSale[]): void {
  // Clone lot quantities for simulation
  const lotSim = lots.map((l) => ({
    ...l,
    _simRemaining: Number(l.initial_qty || 0),
  }))
  // Sort lots by received_at ASC (FIFO)
  lotSim.sort((a, b) => (a.received_at || '').localeCompare(b.received_at || ''))
  // Sort sales by sold_at ASC (chronological)
  const sortedSales = [...sales].sort((a, b) =>
    (a.sold_at || '').localeCompare(b.sold_at || ''),
  )

  for (const sale of sortedSales) {
    let need = Number(sale.quantity || 0)
    if (need <= 0) continue
    let totalCost = 0
    for (const lot of lotSim) {
      if (need <= 0) break
      const avail = lot._simRemaining
      if (avail <= 0) continue
      const take = Math.min(need, avail)
      const unitCost = Number(lot.unit_cost_rub || 0)
      totalCost += take * unitCost
      lot._simRemaining -= take
      need -= take
    }
    // Tag sale with computed cost if original is zero
    if (Number(sale.cogs_rub || 0) === 0) {
      sale._computed_cogs = totalCost
    }
  }
  // Tag lots with computed remaining
  for (let i = 0; i < lots.length; i++) {
    lots[i]._computed_remaining = lotSim[i]._simRemaining
  }
}
