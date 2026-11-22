import { describe, expect, it } from "vitest"
import {
  type AllocationChannel,
  allocateInventory,
  evaluateAllocation,
  normalCdf,
  proportionalAllocation,
} from "@/lib/inventory/allocation"

const channel = (overrides: Partial<AllocationChannel>): AllocationChannel => ({
  code: "x",
  name: "X",
  expectedDemand: 100,
  contributionPerUnit: 10,
  demandCvPct: 0,
  unsoldCostPerUnit: 0,
  ...overrides,
})

describe("normalCdf", () => {
  it("matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3)
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3)
  })
})

describe("allocateInventory with certain demand", () => {
  it("fills the most profitable channel first, up to its demand", () => {
    const result = allocateInventory(150, [
      channel({ code: "a", name: "A", expectedDemand: 100, contributionPerUnit: 20 }),
      channel({ code: "b", name: "B", expectedDemand: 100, contributionPerUnit: 50 }),
    ])
    expect(result.channels.map((row) => row.allocated)).toEqual([50, 100])
    expect(result.expectedContribution).toBeCloseTo(100 * 50 + 50 * 20)
    expect(result.reserve).toBe(0)
  })

  it("keeps stock in reserve when demand is lower than supply", () => {
    const result = allocateInventory(500, [channel({ expectedDemand: 120 })])
    expect(result.totalAllocated).toBe(120)
    expect(result.reserve).toBe(380)
  })

  it("never sends stock to a channel that loses money", () => {
    const result = allocateInventory(100, [channel({ contributionPerUnit: -5 })])
    expect(result.totalAllocated).toBe(0)
  })

  it("handles zero stock", () => {
    expect(allocateInventory(0, [channel({})]).totalAllocated).toBe(0)
  })
})

describe("allocateInventory with uncertain demand", () => {
  const channels = [
    channel({
      code: "amz",
      name: "Amazon",
      expectedDemand: 40,
      contributionPerUnit: 30,
      demandCvPct: 40,
      unsoldCostPerUnit: 8,
    }),
    channel({
      code: "fk",
      name: "Flipkart",
      expectedDemand: 25,
      contributionPerUnit: 45,
      demandCvPct: 30,
      unsoldCostPerUnit: 8,
    }),
    channel({
      code: "blk",
      name: "Blinkit",
      expectedDemand: 30,
      contributionPerUnit: 20,
      demandCvPct: 50,
      unsoldCostPerUnit: 15,
    }),
  ]

  it("never allocates more than the stock", () => {
    for (const stock of [0, 1, 10, 60, 95, 300]) {
      const result = allocateInventory(stock, channels)
      expect(result.totalAllocated).toBeLessThanOrEqual(stock)
      expect(result.totalAllocated + result.reserve).toBe(stock)
    }
  })

  it("is optimal: no other integer split of a small stock does better", () => {
    const stock = 30
    const best = allocateInventory(stock, channels).expectedContribution
    let bruteForceBest = -Infinity
    for (let a = 0; a <= stock; a++) {
      for (let b = 0; a + b <= stock; b++) {
        for (let c = 0; a + b + c <= stock; c++) {
          const value = evaluateAllocation(channels, [a, b, c], stock).expectedContribution
          if (value > bruteForceBest) bruteForceBest = value
        }
      }
    }
    expect(best).toBeCloseTo(bruteForceBest, 6)
  })

  it("beats or matches the proportional rule of thumb", () => {
    for (const stock of [20, 60, 95, 150]) {
      const optimal = allocateInventory(stock, channels).expectedContribution
      const naive = proportionalAllocation(stock, channels).expectedContribution
      expect(optimal).toBeGreaterThanOrEqual(naive - 1e-9)
    }
  })

  it("expected sales never exceed allocation or demand", () => {
    const result = allocateInventory(200, channels)
    for (const row of result.channels) {
      expect(row.expectedSales).toBeLessThanOrEqual(row.allocated + 1e-9)
      expect(row.expectedUnsold).toBeGreaterThanOrEqual(-1e-9)
    }
  })
})

describe("proportionalAllocation", () => {
  it("splits all stock in proportion to demand", () => {
    const result = proportionalAllocation(10, [
      channel({ code: "a", expectedDemand: 1 }),
      channel({ code: "b", expectedDemand: 2 }),
    ])
    expect(result.channels.map((row) => row.allocated)).toEqual([3, 7])
  })
})

describe("validation", () => {
  it("rejects invalid stock", () => {
    expect(() => allocateInventory(-1, [channel({})])).toThrow()
    expect(() => allocateInventory(1.5, [channel({})])).toThrow()
  })
})
