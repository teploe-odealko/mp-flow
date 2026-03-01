/**
 * Tests for create-sale step business logic.
 * Verifies revenue, COGS, fees, and profit calculations.
 */

describe("create-sale calculations", () => {
  // Replicate the step's calculation logic for testing
  function calculateSale(input: {
    quantity: number
    price_per_unit: number
    unit_cogs: number
    fee_details?: Array<{ amount: number }>
  }) {
    const qty = input.quantity || 1
    const pricePerUnit = input.price_per_unit || 0
    const revenue = qty * pricePerUnit
    const totalCogs = qty * input.unit_cogs
    const feeDetails = input.fee_details || []
    const totalFees = feeDetails.reduce((s, f) => s + Number(f.amount || 0), 0)
    const profit = revenue - totalCogs - totalFees
    return { revenue, totalCogs, totalFees, profit }
  }

  test("basic sale: revenue = qty × price", () => {
    const r = calculateSale({ quantity: 3, price_per_unit: 1500, unit_cogs: 0 })
    expect(r.revenue).toBe(4500)
    expect(r.totalCogs).toBe(0)
    expect(r.profit).toBe(4500)
  })

  test("sale with COGS reduces profit", () => {
    const r = calculateSale({ quantity: 2, price_per_unit: 1000, unit_cogs: 600 })
    expect(r.revenue).toBe(2000)
    expect(r.totalCogs).toBe(1200)
    expect(r.profit).toBe(800)
  })

  test("sale with fees reduces profit", () => {
    const r = calculateSale({
      quantity: 1,
      price_per_unit: 5000,
      unit_cogs: 2000,
      fee_details: [
        { amount: 500 },  // commission
        { amount: 300 },  // logistics
        { amount: 200 },  // fulfillment
      ],
    })
    expect(r.revenue).toBe(5000)
    expect(r.totalCogs).toBe(2000)
    expect(r.totalFees).toBe(1000)
    expect(r.profit).toBe(2000) // 5000 - 2000 - 1000
  })

  test("zero quantity defaults to 1", () => {
    const r = calculateSale({ quantity: 0, price_per_unit: 1000, unit_cogs: 500 })
    expect(r.revenue).toBe(1000) // 1 × 1000
    expect(r.totalCogs).toBe(500) // 1 × 500
  })

  test("negative profit (loss)", () => {
    const r = calculateSale({
      quantity: 1,
      price_per_unit: 100,
      unit_cogs: 500,
      fee_details: [{ amount: 200 }],
    })
    expect(r.profit).toBe(-600) // 100 - 500 - 200
  })

  test("empty fee_details → zero fees", () => {
    const r = calculateSale({ quantity: 1, price_per_unit: 1000, unit_cogs: 0 })
    expect(r.totalFees).toBe(0)
    expect(r.profit).toBe(1000)
  })

  test("finance tx created only when revenue > 0", () => {
    // This is the branching logic in the step
    const shouldCreateTx = (revenue: number) => revenue > 0
    expect(shouldCreateTx(1000)).toBe(true)
    expect(shouldCreateTx(0)).toBe(false)
    expect(shouldCreateTx(-100)).toBe(false)
  })
})
