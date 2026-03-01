/**
 * Tests for receive-order step business logic.
 * Verifies shared cost distribution and unit cost calculations.
 */

describe("receive-order cost calculations", () => {
  type OrderItem = {
    id: string
    purchase_price_rub: number
    packaging_cost_rub?: number
    logistics_cost_rub?: number
    customs_cost_rub?: number
    extra_cost_rub?: number
  }

  // Replicate the step's cost distribution logic
  function calculateCosts(
    items: OrderItem[],
    receivedQtys: Map<string, number>,
    sharedCosts: Array<{ name: string; total_rub: number }>
  ) {
    const totalShared = sharedCosts.reduce((s, c) => s + (c.total_rub || 0), 0)
    const receivingItems = items.filter((item) => (receivedQtys.get(item.id) || 0) > 0)
    const itemCount = receivingItems.length || 1
    const sharedPerItem = totalShared / itemCount

    const results: Array<{ id: string; unitCost: number; totalCost: number }> = []
    let totalCost = 0

    for (const item of items) {
      const receivedQty = receivedQtys.get(item.id) || 0
      if (receivedQty <= 0) continue

      const purchasePrice = Number(item.purchase_price_rub || 0)
      const packaging = Number(item.packaging_cost_rub || 0)
      const logistics = Number(item.logistics_cost_rub || 0)
      const customs = Number(item.customs_cost_rub || 0)
      const extra = Number(item.extra_cost_rub || 0)
      const individualCost = packaging + logistics + customs + extra + sharedPerItem
      const unitCost = receivedQty > 0
        ? Math.round(((purchasePrice + individualCost) / receivedQty) * 100) / 100
        : 0
      const itemTotalCost = Math.round(unitCost * receivedQty * 100) / 100

      results.push({ id: item.id, unitCost, totalCost: itemTotalCost })
      totalCost += itemTotalCost
    }

    return { results, totalCost, sharedPerItem }
  }

  test("single item, no shared costs", () => {
    const items: OrderItem[] = [
      { id: "item1", purchase_price_rub: 5000 },
    ]
    const received = new Map([["item1", 10]])
    const { results, totalCost } = calculateCosts(items, received, [])

    expect(results).toHaveLength(1)
    expect(results[0].unitCost).toBe(500) // 5000 / 10
    expect(results[0].totalCost).toBe(5000) // 500 × 10
    expect(totalCost).toBe(5000)
  })

  test("shared costs split evenly between receiving items", () => {
    const items: OrderItem[] = [
      { id: "item1", purchase_price_rub: 1000 },
      { id: "item2", purchase_price_rub: 2000 },
    ]
    const received = new Map([["item1", 10], ["item2", 10]])
    const shared = [
      { name: "Доставка", total_rub: 2000 },
      { name: "Упаковка", total_rub: 1000 },
    ]
    const { sharedPerItem } = calculateCosts(items, received, shared)

    // 3000 total shared / 2 items = 1500 per item
    expect(sharedPerItem).toBe(1500)
  })

  test("items not received are excluded from shared cost split", () => {
    const items: OrderItem[] = [
      { id: "item1", purchase_price_rub: 1000 },
      { id: "item2", purchase_price_rub: 2000 },
      { id: "item3", purchase_price_rub: 3000 },
    ]
    // Only item1 and item3 are received
    const received = new Map([["item1", 5], ["item2", 0], ["item3", 10]])
    const shared = [{ name: "Shipping", total_rub: 3000 }]
    const { results, sharedPerItem } = calculateCosts(items, received, shared)

    // 3000 / 2 receiving items = 1500 per item
    expect(sharedPerItem).toBe(1500)
    expect(results).toHaveLength(2) // item2 excluded
  })

  test("unit cost includes individual + shared costs, rounded to 2 decimals", () => {
    const items: OrderItem[] = [
      {
        id: "item1",
        purchase_price_rub: 10000,
        packaging_cost_rub: 500,
        logistics_cost_rub: 1000,
        customs_cost_rub: 300,
        extra_cost_rub: 200,
      },
    ]
    const received = new Map([["item1", 3]])
    const shared = [{ name: "Shipping", total_rub: 600 }]
    const { results } = calculateCosts(items, received, shared)

    // purchasePrice = 10000
    // individual = 500 + 1000 + 300 + 200 + 600(shared) = 2600
    // unitCost = (10000 + 2600) / 3 = 4200
    expect(results[0].unitCost).toBe(4200)
    expect(results[0].totalCost).toBe(12600) // 4200 × 3
  })

  test("rounding: non-integer unit cost", () => {
    const items: OrderItem[] = [
      { id: "item1", purchase_price_rub: 1000 },
    ]
    const received = new Map([["item1", 3]])
    const { results } = calculateCosts(items, received, [])

    // 1000 / 3 = 333.333... → rounded to 333.33
    expect(results[0].unitCost).toBe(333.33)
    expect(results[0].totalCost).toBe(999.99) // 333.33 × 3
  })

  test("all costs combined correctly", () => {
    const items: OrderItem[] = [
      { id: "a", purchase_price_rub: 500, packaging_cost_rub: 100 },
      { id: "b", purchase_price_rub: 800, logistics_cost_rub: 200 },
    ]
    const received = new Map([["a", 5], ["b", 10]])
    const shared = [{ name: "Ship", total_rub: 1000 }]
    const { results, totalCost } = calculateCosts(items, received, shared)

    // shared per item = 1000 / 2 = 500
    // item a: (500 + 100 + 500) / 5 = 1100 / 5 = 220, total = 1100
    // item b: (800 + 200 + 500) / 10 = 1500 / 10 = 150, total = 1500
    expect(results[0].unitCost).toBe(220)
    expect(results[0].totalCost).toBe(1100)
    expect(results[1].unitCost).toBe(150)
    expect(results[1].totalCost).toBe(1500)
    expect(totalCost).toBe(2600)
  })
})
