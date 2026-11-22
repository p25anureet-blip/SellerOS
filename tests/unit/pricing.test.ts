import { describe, expect, it } from "vitest"
import { calculatePrice, priceForChannel } from "@/lib/pricing/calculator"

const base = {
  manufacturingCost: 100,
  packagingCost: 10,
  fulfilmentCost: 40,
  commissionPct: 15,
  mrp: 500,
  desiredMarginPct: 20,
}

describe("calculatePrice", () => {
  it("hits the desired margin when MRP allows", () => {
    // C = 150; P* = 150 / (1 − 0.15 − 0.20) = 230.77 → rounded up to 231
    const result = calculatePrice(base)
    expect(result.totalCost).toBe(150)
    expect(result.targetPrice).toBeCloseTo(230.77, 2)
    expect(result.recommendedPrice).toBe(231)
    expect(result.status).toBe("on_target")
    expect(result.commissionAmount).toBeCloseTo(34.65, 2)
    expect(result.contribution).toBeCloseTo(231 - 34.65 - 150, 2)
    expect(result.contributionMarginPct).toBeGreaterThanOrEqual(20)
    expect(result.breakEvenPrice).toBeCloseTo(176.47, 2)
  })

  it("caps at MRP when the target price is too high", () => {
    const result = calculatePrice({ ...base, mrp: 200 })
    expect(result.recommendedPrice).toBe(200)
    expect(result.status).toBe("capped_by_mrp")
    expect(result.contributionMarginPct).toBeLessThan(20)
    expect(result.contribution).toBeGreaterThan(0)
  })

  it("flags products that lose money even at MRP", () => {
    const result = calculatePrice({ ...base, mrp: 160 })
    expect(result.status).toBe("loss_at_mrp")
    expect(result.contribution).toBeLessThan(0)
  })

  it("flags impossible targets (commission + margin ≥ 100%)", () => {
    const result = calculatePrice({ ...base, commissionPct: 50, desiredMarginPct: 50 })
    expect(result.status).toBe("infeasible")
    expect(result.targetPrice).toBeNull()
  })

  it("reports discount from MRP", () => {
    expect(calculatePrice(base).discountFromMrpPct).toBeCloseTo(53.8, 1)
  })

  it("rejects invalid input", () => {
    expect(() => calculatePrice({ ...base, mrp: 0 })).toThrow(/MRP/)
    expect(() => calculatePrice({ ...base, commissionPct: -1 })).toThrow()
  })

  it("prices a catalogue product with channel fees", () => {
    const result = priceForChannel(
      { costPrice: 96, mrp: 249 },
      { commissionPct: 15, fixedFeeInr: 20, shippingFeeInr: 60 },
    )
    // C = 96 + 10 + 80 = 186; P* = 186 / 0.65 = 286.15 > MRP → capped
    expect(result.totalCost).toBe(186)
    expect(result.status).toBe("capped_by_mrp")
    expect(result.recommendedPrice).toBe(249)
  })
})
