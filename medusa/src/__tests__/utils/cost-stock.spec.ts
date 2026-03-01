import { calculateAvgCost, getAvailableStock } from "../../utils/cost-stock"

// ── Helpers ─────────────────────────────────────────────

function mockSupplierService(items: Array<{ received_qty: number; unit_cost: number }>) {
  return {
    listSupplierOrderItems: jest.fn().mockResolvedValue(items),
  }
}

function mockSaleService(sales: Array<{ quantity: number }>) {
  return {
    listSales: jest.fn().mockResolvedValue(sales),
  }
}

// ── calculateAvgCost ────────────────────────────────────

describe("calculateAvgCost", () => {
  test("single item → returns its unit cost", async () => {
    const svc = mockSupplierService([{ received_qty: 10, unit_cost: 500 }])
    expect(await calculateAvgCost(svc, "card1")).toBe(500)
  })

  test("two items → weighted average", async () => {
    const svc = mockSupplierService([
      { received_qty: 10, unit_cost: 500 },
      { received_qty: 5, unit_cost: 800 },
    ])
    // (10*500 + 5*800) / 15 = 9000/15 = 600
    expect(await calculateAvgCost(svc, "card1")).toBe(600)
  })

  test("three items with different costs", async () => {
    const svc = mockSupplierService([
      { received_qty: 100, unit_cost: 200 },
      { received_qty: 50, unit_cost: 400 },
      { received_qty: 50, unit_cost: 600 },
    ])
    // (100*200 + 50*400 + 50*600) / 200 = (20000+20000+30000)/200 = 350
    expect(await calculateAvgCost(svc, "card1")).toBe(350)
  })

  test("no items → returns 0", async () => {
    const svc = mockSupplierService([])
    expect(await calculateAvgCost(svc, "card1")).toBe(0)
  })

  test("handles null/undefined values gracefully", async () => {
    const svc = {
      listSupplierOrderItems: jest.fn().mockResolvedValue([
        { received_qty: null, unit_cost: 500 },
        { received_qty: 10, unit_cost: undefined },
        { received_qty: 5, unit_cost: 300 },
      ]),
    }
    // null qty → 0 (via || 0), undefined cost → 0 (via || 0)
    // item1: 0×500=0, item2: 10×0=0, item3: 5×300=1500 → 1500/15 = 100
    expect(await calculateAvgCost(svc, "card1")).toBe(100)
  })

  test("passes correct filter to service", async () => {
    const svc = mockSupplierService([])
    await calculateAvgCost(svc, "card-abc")
    expect(svc.listSupplierOrderItems).toHaveBeenCalledWith({
      master_card_id: "card-abc",
      received_qty: { $gt: 0 },
    })
  })
})

// ── getAvailableStock ───────────────────────────────────

describe("getAvailableStock", () => {
  test("received minus sold", async () => {
    const supplierSvc = mockSupplierService([
      { received_qty: 20, unit_cost: 0 },
      { received_qty: 10, unit_cost: 0 },
    ])
    const saleSvc = mockSaleService([{ quantity: 5 }, { quantity: 3 }])
    // 30 received - 8 sold = 22
    expect(await getAvailableStock(supplierSvc, saleSvc, "card1")).toBe(22)
  })

  test("no supplier items → 0", async () => {
    const supplierSvc = mockSupplierService([])
    const saleSvc = mockSaleService([{ quantity: 5 }])
    // 0 - 5 = -5 (negative stock possible — oversold)
    expect(await getAvailableStock(supplierSvc, saleSvc, "card1")).toBe(-5)
  })

  test("no sales → all in stock", async () => {
    const supplierSvc = mockSupplierService([
      { received_qty: 15, unit_cost: 0 },
    ])
    const saleSvc = mockSaleService([])
    expect(await getAvailableStock(supplierSvc, saleSvc, "card1")).toBe(15)
  })

  test("filters sales by active and delivered statuses", async () => {
    const supplierSvc = mockSupplierService([])
    const saleSvc = mockSaleService([])
    await getAvailableStock(supplierSvc, saleSvc, "card-xyz")

    expect(saleSvc.listSales).toHaveBeenCalledWith({
      master_card_id: "card-xyz",
      status: { $in: ["active", "delivered"] },
    })
  })
})
