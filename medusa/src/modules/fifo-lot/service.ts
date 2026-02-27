import { MedusaService } from "@medusajs/framework/utils"
import FifoLot from "./models/fifo-lot"
import FifoAllocation from "./models/fifo-allocation"

// Precision constants (ported from old system)
const MONEY_QUANT = 0.01
const QTY_QUANT = 0.001
const EPSILON = 0.000001

function roundMoney(v: number): number {
  return Math.round(v / MONEY_QUANT) * MONEY_QUANT
}

function roundQty(v: number): number {
  return Math.round(v / QTY_QUANT) * QTY_QUANT
}

class FifoLotModuleService extends MedusaService({
  FifoLot,
  FifoAllocation,
}) {
  /**
   * Allocate inventory from FIFO lots for a given master card.
   * Oldest lots are consumed first (FIFO).
   * Returns array of allocations with cost info.
   */
  async allocateFifo(
    masterCardId: string,
    quantity: number,
    saleOrderId?: string,
    saleItemId?: string
  ) {
    const lots = await this.listFifoLots(
      {
        master_card_id: masterCardId,
        remaining_qty: { $gt: 0 },
      },
      {
        order: { received_at: "ASC" },
      }
    )

    let remainingToAllocate = roundQty(quantity)
    const allocations: any[] = []

    for (const lot of lots) {
      if (remainingToAllocate <= EPSILON) break

      const allocQty = roundQty(Math.min(remainingToAllocate, lot.remaining_qty))
      const totalCost = roundMoney(allocQty * Number(lot.cost_per_unit))

      const allocation = await this.createFifoAllocations({
        lot_id: lot.id,
        sale_order_id: saleOrderId ?? null,
        sale_item_id: saleItemId ?? null,
        quantity: allocQty,
        cost_per_unit: lot.cost_per_unit,
        total_cost: totalCost,
        currency_code: lot.currency_code,
        allocated_at: new Date(),
      })

      await this.updateFifoLots({
        id: lot.id,
        remaining_qty: roundQty(lot.remaining_qty - allocQty),
      })

      allocations.push(allocation)
      remainingToAllocate = roundQty(remainingToAllocate - allocQty)
    }

    if (remainingToAllocate > EPSILON) {
      throw new Error(
        `Insufficient FIFO lots for card ${masterCardId}. ` +
        `Needed: ${quantity}, available: ${roundQty(quantity - remainingToAllocate)}`
      )
    }

    return allocations
  }

  /**
   * Partial FIFO allocation — allocate as much as possible, don't throw on insufficient.
   */
  async allocateFifoPartial(
    masterCardId: string,
    quantity: number,
    saleOrderId?: string,
    saleItemId?: string
  ) {
    const lots = await this.listFifoLots(
      {
        master_card_id: masterCardId,
        remaining_qty: { $gt: 0 },
      },
      {
        order: { received_at: "ASC" },
      }
    )

    let remainingToAllocate = roundQty(quantity)
    const allocations: any[] = []

    for (const lot of lots) {
      if (remainingToAllocate <= EPSILON) break

      const allocQty = roundQty(Math.min(remainingToAllocate, lot.remaining_qty))
      const totalCost = roundMoney(allocQty * Number(lot.cost_per_unit))

      const allocation = await this.createFifoAllocations({
        lot_id: lot.id,
        sale_order_id: saleOrderId ?? null,
        sale_item_id: saleItemId ?? null,
        quantity: allocQty,
        cost_per_unit: lot.cost_per_unit,
        total_cost: totalCost,
        currency_code: lot.currency_code,
        allocated_at: new Date(),
      })

      await this.updateFifoLots({
        id: lot.id,
        remaining_qty: roundQty(lot.remaining_qty - allocQty),
      })

      allocations.push(allocation)
      remainingToAllocate = roundQty(remainingToAllocate - allocQty)
    }

    return { allocations, unallocated: remainingToAllocate }
  }

  /**
   * Reverse FIFO allocations for a sale order item.
   * Restores remaining_qty on consumed lots.
   */
  async reverseFifo(saleItemId: string) {
    const allocations = await this.listFifoAllocations({
      sale_item_id: saleItemId,
    })

    for (const alloc of allocations) {
      const lot = await this.retrieveFifoLot(alloc.lot_id)
      await this.updateFifoLots({
        id: lot.id,
        remaining_qty: roundQty(lot.remaining_qty + alloc.quantity),
      })
      await this.deleteFifoAllocations(alloc.id)
    }

    return allocations.length
  }

  /**
   * Consume FIFO lots for write-off/loss (no allocation record).
   * Returns total cost of consumed inventory.
   */
  async consumeForWriteOff(masterCardId: string, quantity: number): Promise<number> {
    const lots = await this.listFifoLots(
      {
        master_card_id: masterCardId,
        remaining_qty: { $gt: 0 },
      },
      {
        order: { received_at: "ASC" },
      }
    )

    let remaining = roundQty(quantity)
    let totalCost = 0

    for (const lot of lots) {
      if (remaining <= EPSILON) break

      const consumeQty = roundQty(Math.min(remaining, lot.remaining_qty))
      totalCost += roundMoney(consumeQty * Number(lot.cost_per_unit))

      await this.updateFifoLots({
        id: lot.id,
        remaining_qty: roundQty(lot.remaining_qty - consumeQty),
      })

      remaining = roundQty(remaining - consumeQty)
    }

    if (remaining > EPSILON) {
      throw new Error(
        `Insufficient inventory for write-off. Card: ${masterCardId}, needed: ${quantity}, short: ${remaining}`
      )
    }

    return roundMoney(totalCost)
  }

  /**
   * Get total available quantity for a variant across all lots.
   */
  async getAvailableQuantity(masterCardId: string): Promise<number> {
    const lots = await this.listFifoLots({
      master_card_id: masterCardId,
      remaining_qty: { $gt: 0 },
    })
    return roundQty(lots.reduce((sum, lot) => sum + lot.remaining_qty, 0))
  }

  /**
   * Get weighted average cost for a variant.
   */
  async getWeightedAverageCost(masterCardId: string): Promise<number> {
    const lots = await this.listFifoLots({
      master_card_id: masterCardId,
      remaining_qty: { $gt: 0 },
    })

    const totalQty = lots.reduce((sum, lot) => sum + lot.remaining_qty, 0)
    if (totalQty <= EPSILON) return 0

    const totalCost = lots.reduce(
      (sum, lot) => sum + lot.remaining_qty * Number(lot.cost_per_unit),
      0
    )

    return roundMoney(totalCost / totalQty)
  }
}

export default FifoLotModuleService
