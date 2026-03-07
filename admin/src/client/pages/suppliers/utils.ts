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
  method: "equal" | "by_price" | "by_weight" | "by_volume"
}

export interface OrderItem {
  master_card_id: string
  title?: string
  ordered_qty: number
  purchase_price: number
  purchase_currency?: string
  weight?: number
  volume?: number
}

export function computeAllocations(items: OrderItem[], sharedCosts: SharedCostEntry[]): AllocationRow[] {
  if (!items.length) return []

  // Pre-compute totals for proportional methods
  const totalPriceValue = items.reduce((s, i) => s + (Number(i.purchase_price) || 0) * (i.ordered_qty || 0), 0)
  const totalWeight = items.reduce((s, i) => s + (Number(i.weight) || 0) * (i.ordered_qty || 0), 0)
  const totalVolume = items.reduce((s, i) => s + (Number(i.volume) || 0) * (i.ordered_qty || 0), 0)
  const totalUnits = items.reduce((s, i) => s + (i.ordered_qty || 0), 0)

  return items.map((item) => {
    const qty = item.ordered_qty || 0
    const purchasePrice = Number(item.purchase_price) || 0

    // Individual cost from purchase_price is NOT included in cost basis (price is in foreign currency)
    // Cost = shared expenses (in RUB) only; purchase_price used only for proportional ratios
    const individual = 0

    // Shared cost allocation for this item
    let sharedAlloc = 0
    for (const cost of sharedCosts) {
      const amount = Number(cost.total_rub) || 0
      if (amount === 0) continue

      let share = 0
      switch (cost.method) {
        case "by_price": {
          const itemValue = purchasePrice * qty
          share = totalPriceValue > 0 ? (itemValue / totalPriceValue) * amount : amount / items.length
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
          // Поровну между всеми единицами: сумма / всего единиц * кол-во данного товара
          share = totalUnits > 0 ? (qty / totalUnits) * amount : amount / items.length
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

/** Per-category overhead allocation for one item (per unit) */
export function computePerCategoryOverhead(
  item: OrderItem,
  sharedCosts: SharedCostEntry[],
  allItems: OrderItem[],
): Array<{ name: string; per_unit: number }> {
  const qty = item.ordered_qty || 0
  if (qty === 0) return []

  const totalPriceValue = allItems.reduce((s, i) => s + (Number(i.purchase_price) || 0) * (i.ordered_qty || 0), 0)
  const totalWeight = allItems.reduce((s, i) => s + (Number(i.weight) || 0) * (i.ordered_qty || 0), 0)
  const totalVolume = allItems.reduce((s, i) => s + (Number(i.volume) || 0) * (i.ordered_qty || 0), 0)
  const totalUnits = allItems.reduce((s, i) => s + (i.ordered_qty || 0), 0)
  const purchasePrice = Number(item.purchase_price) || 0

  return sharedCosts
    .map((cost) => {
      const amount = Number(cost.total_rub) || 0
      if (amount === 0) return null

      let share = 0
      switch (cost.method) {
        case "by_price": {
          const itemValue = purchasePrice * qty
          share = totalPriceValue > 0 ? (itemValue / totalPriceValue) * amount : amount / allItems.length
          break
        }
        case "by_weight": {
          const itemWeight = (Number(item.weight) || 0) * qty
          share = totalWeight > 0 ? (itemWeight / totalWeight) * amount : amount / allItems.length
          break
        }
        case "by_volume": {
          const itemVolume = (Number(item.volume) || 0) * qty
          share = totalVolume > 0 ? (itemVolume / totalVolume) * amount : amount / allItems.length
          break
        }
        case "equal":
        default:
          share = totalUnits > 0 ? (qty / totalUnits) * amount : amount / allItems.length
      }

      return { name: cost.name, per_unit: qty > 0 ? share / qty : 0 }
    })
    .filter(Boolean) as Array<{ name: string; per_unit: number }>
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
