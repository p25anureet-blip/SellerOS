/**
 * Pricing engine. All amounts are per unit, in rupees.
 *
 * Model: the marketplace takes `commissionPct` of the selling price P. Costs C
 * (manufacturing + packaging + fulfilment) are fixed per unit.
 *
 *   contribution(P)        = P − commission·P − C
 *   contribution margin(P) = contribution(P) / P
 *
 * Solving contribution(P) = desiredMargin·P gives the target price
 *
 *   P* = C / (1 − commission − desiredMargin)
 *
 * which is then capped at MRP (it is illegal to sell above MRP in India).
 * Prices are treated as the amount the seller receives before GST.
 */

export type PricingInput = {
  manufacturingCost: number
  packagingCost: number
  fulfilmentCost: number
  /** e.g. 15 for 15% */
  commissionPct: number
  mrp: number
  /** Desired contribution margin as % of selling price, e.g. 20 */
  desiredMarginPct: number
}

export type PricingStatus =
  /** Target margin reached at or below MRP. */
  | "on_target"
  /** Target price is above MRP: selling at MRP, margin below target but positive. */
  | "capped_by_mrp"
  /** Even at MRP every sale loses money. */
  | "loss_at_mrp"
  /** commission + desired margin ≥ 100%: no price can achieve it. */
  | "infeasible"

export type PricingResult = {
  totalCost: number
  breakEvenPrice: number
  targetPrice: number | null
  recommendedPrice: number
  commissionAmount: number
  contribution: number
  contributionMarginPct: number
  discountFromMrpPct: number
  status: PricingStatus
}

export function validatePricingInput(input: PricingInput): string[] {
  const errors: string[] = []
  const nonNegative: (keyof PricingInput)[] = [
    "manufacturingCost",
    "packagingCost",
    "fulfilmentCost",
    "commissionPct",
    "desiredMarginPct",
  ]
  for (const key of nonNegative) {
    if (!Number.isFinite(input[key]) || input[key] < 0) errors.push(`${key} must be 0 or more`)
  }
  if (!Number.isFinite(input.mrp) || input.mrp <= 0) errors.push("MRP must be more than 0")
  if (input.commissionPct >= 100) errors.push("Commission must be below 100%")
  if (input.desiredMarginPct >= 100) errors.push("Desired margin must be below 100%")
  return errors
}

const round2 = (value: number) => Math.round(value * 100) / 100

export function calculatePrice(input: PricingInput): PricingResult {
  const errors = validatePricingInput(input)
  if (errors.length) throw new Error(errors.join("; "))

  const commission = input.commissionPct / 100
  const margin = input.desiredMarginPct / 100
  const totalCost = input.manufacturingCost + input.packagingCost + input.fulfilmentCost
  const breakEvenPrice = totalCost / (1 - commission)

  const feasible = commission + margin < 1
  const targetPrice = feasible ? totalCost / (1 - commission - margin) : null

  let status: PricingStatus
  let price: number
  if (targetPrice === null) {
    status = "infeasible"
    price = input.mrp
  } else if (targetPrice <= input.mrp) {
    status = "on_target"
    // Round up to the next rupee so rounding never pushes margin below target.
    price = Math.min(Math.ceil(targetPrice), input.mrp)
  } else {
    price = input.mrp
    status = breakEvenPrice > input.mrp ? "loss_at_mrp" : "capped_by_mrp"
  }

  const commissionAmount = price * commission
  const contribution = price - commissionAmount - totalCost

  return {
    totalCost: round2(totalCost),
    breakEvenPrice: round2(breakEvenPrice),
    targetPrice: targetPrice === null ? null : round2(targetPrice),
    recommendedPrice: round2(price),
    commissionAmount: round2(commissionAmount),
    contribution: round2(contribution),
    contributionMarginPct: round2((contribution / price) * 100),
    discountFromMrpPct: round2(((input.mrp - price) / input.mrp) * 100),
    status,
  }
}

/** Defaults used when SellerOS prices a product automatically for a channel. */
export const DEFAULT_PACKAGING_COST = 10
export const DEFAULT_TARGET_MARGIN_PCT = 20

export type ChannelFees = { commissionPct: number; fixedFeeInr: number; shippingFeeInr: number }

/** Price a catalogue product for one marketplace using the channel's fees. */
export function priceForChannel(
  product: { costPrice: number; mrp: number },
  channel: ChannelFees,
  options: { packagingCost?: number; desiredMarginPct?: number } = {},
): PricingResult {
  return calculatePrice({
    manufacturingCost: product.costPrice,
    packagingCost: options.packagingCost ?? DEFAULT_PACKAGING_COST,
    fulfilmentCost: channel.fixedFeeInr + channel.shippingFeeInr,
    commissionPct: channel.commissionPct,
    mrp: product.mrp,
    desiredMarginPct: options.desiredMarginPct ?? DEFAULT_TARGET_MARGIN_PCT,
  })
}
