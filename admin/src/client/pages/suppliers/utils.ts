export interface AllocationRow {
  master_card_id: string
  title: string
  ordered_qty: number
  individual_cost: number
  shared_allocation: number
  unit_cost: number
  total_cost: number
}

export interface SharedCostEntry {
  name: string
  total_rub: number
  method: "equal" | "by_cny_price" | "by_weight" | "by_volume"
}

export interface OrderItem {
  master_card_id: string
  title?: string
  ordered_qty: number
  cny_price_per_unit: number
  purchase_price_rub: number
  packaging_cost_rub: number
  logistics_cost_rub: number
  customs_cost_rub: number
  extra_cost_rub: number
  weight?: number
  volume?: number
}

export function computeAllocations(items: OrderItem[], sharedCosts: SharedCostEntry[]): AllocationRow[] {
  if (!items.length) return []

  const totalShared = sharedCosts.reduce((s, c) => s + (Number(c.total_rub) || 0), 0)

  // Pre-compute totals for proportional methods
  const totalCnyValue = items.reduce((s, i) => s + (Number(i.cny_price_per_unit) || 0) * (i.ordered_qty || 0), 0)
  const totalWeight = items.reduce((s, i) => s + (Number(i.weight) || 0) * (i.ordered_qty || 0), 0)
  const totalVolume = items.reduce((s, i) => s + (Number(i.volume) || 0) * (i.ordered_qty || 0), 0)

  return items.map((item) => {
    const qty = item.ordered_qty || 0

    // Individual costs per item line (total for all qty)
    const individual =
      (Number(item.purchase_price_rub) || 0) +
      (Number(item.packaging_cost_rub) || 0) +
      (Number(item.logistics_cost_rub) || 0) +
      (Number(item.customs_cost_rub) || 0) +
      (Number(item.extra_cost_rub) || 0)

    // Shared cost allocation for this item
    let sharedAlloc = 0
    for (const cost of sharedCosts) {
      const amount = Number(cost.total_rub) || 0
      if (amount === 0) continue

      let share = 0
      switch (cost.method) {
        case "by_cny_price": {
          const itemValue = (Number(item.cny_price_per_unit) || 0) * qty
          share = totalCnyValue > 0 ? (itemValue / totalCnyValue) * amount : amount / items.length
          break
        }
        case "by_weight": {
          const itemWeight = (Number(item.weight) || 0) * qty
          share = totalWeight > 0 ? (itemWeight / totalWeight) * amount : amount / items.length
          break
        }
        case "by_volume": {
          const itemVolume = (Number(item.volume) || 0) * qty
          share = totalVolume > 0 ? (itemVolume / totalVolume) * amount : amount / items.length
          break
        }
        case "equal":
        default:
          share = amount / items.length
          break
      }
      sharedAlloc += share
    }

    const totalCost = individual + sharedAlloc
    const unitCost = qty > 0 ? Math.round((totalCost / qty) * 100) / 100 : 0

    return {
      master_card_id: item.master_card_id,
      title: item.title || "",
      ordered_qty: qty,
      individual_cost: Math.round(individual * 100) / 100,
      shared_allocation: Math.round(sharedAlloc * 100) / 100,
      unit_cost: unitCost,
      total_cost: Math.round(totalCost * 100) / 100,
    }
  })
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  ordered: "Заказано",
  shipped: "В пути",
  received: "Принято",
  cancelled: "Отменено",
}

export const STATUS_COLORS: Record<string, string> = {
  draft: "bg-text-muted/20 text-text-muted",
  ordered: "bg-accent/20 text-accent",
  shipped: "bg-yellow-500/20 text-yellow-500",
  received: "bg-inflow/20 text-inflow",
  cancelled: "bg-outflow/20 text-outflow",
}
