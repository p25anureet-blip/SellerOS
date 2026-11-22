/**
 * Inventory allocation across marketplaces.
 *
 * Problem: split S units of stock across channels i = 1..n to maximise total
 * expected contribution. Demand D_i on each channel is uncertain, modelled as
 * Normal(mean = expectedDemand, sd = cv · expectedDemand). A unit placed on a
 * channel only earns if it sells; an unsold unit costs `unsoldCostPerUnit`
 * (return shipping, storage, write-off).
 *
 * The k-th unit sent to channel i has expected marginal value
 *
 *   Δ_i(k) = p_i · P(D_i ≥ k) − h_i · P(D_i < k)
 *
 * P(D_i ≥ k) falls as k grows, so Δ_i is non-increasing and the objective is a
 * sum of concave functions under one capacity constraint. For that class of
 * problem, the marginal-value greedy rule (always give the next unit to the
 * channel where it adds the most) is provably optimal. We stop early if no
 * unit adds positive value, keeping the rest as warehouse reserve.
 *
 * With cv = 0 (certain demand) this reduces to filling channels in order of
 * contribution per unit, i.e. the classic fractional-knapsack solution.
 */

export type AllocationChannel = {
  code: string
  name: string
  expectedDemand: number
  contributionPerUnit: number
  /** Demand uncertainty as % of the mean (coefficient of variation). 0 = certain. */
  demandCvPct: number
  unsoldCostPerUnit: number
}

export type ChannelAllocation = {
  code: string
  name: string
  allocated: number
  expectedSales: number
  expectedUnsold: number
  fillRatePct: number
  expectedContribution: number
}

export type AllocationResult = {
  channels: ChannelAllocation[]
  totalStock: number
  totalAllocated: number
  reserve: number
  expectedContribution: number
  expectedSales: number
}

export const MAX_ALLOCATABLE_STOCK = 1_000_000

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1.5e-7). */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/** Probability that demand is at least k units. */
export function probDemandAtLeast(k: number, channel: AllocationChannel): number {
  const mean = Math.max(0, channel.expectedDemand)
  const sd = (Math.max(0, channel.demandCvPct) / 100) * mean
  if (sd === 0) return k <= mean ? 1 : 0
  // Continuity correction: P(D ≥ k) for integer demand ≈ P(X > k − 0.5).
  return 1 - normalCdf((k - 0.5 - mean) / sd)
}

export function marginalValue(k: number, channel: AllocationChannel): number {
  const sells = probDemandAtLeast(k, channel)
  return channel.contributionPerUnit * sells - channel.unsoldCostPerUnit * (1 - sells)
}

export function validateAllocationInput(
  totalStock: number,
  channels: AllocationChannel[],
): string[] {
  const errors: string[] = []
  if (!Number.isInteger(totalStock) || totalStock < 0) {
    errors.push("Total stock must be a whole number (0 or more)")
  } else if (totalStock > MAX_ALLOCATABLE_STOCK) {
    errors.push(`Total stock must be at most ${MAX_ALLOCATABLE_STOCK.toLocaleString("en-IN")}`)
  }
  if (!channels.length) errors.push("Add at least one channel")
  for (const channel of channels) {
    if (!Number.isFinite(channel.expectedDemand) || channel.expectedDemand < 0)
      errors.push(`${channel.name}: expected demand must be 0 or more`)
    if (!Number.isFinite(channel.contributionPerUnit))
      errors.push(`${channel.name}: contribution per unit must be a number`)
    if (
      !Number.isFinite(channel.demandCvPct) ||
      channel.demandCvPct < 0 ||
      channel.demandCvPct > 200
    )
      errors.push(`${channel.name}: demand variability must be between 0% and 200%`)
    if (!Number.isFinite(channel.unsoldCostPerUnit) || channel.unsoldCostPerUnit < 0)
      errors.push(`${channel.name}: unsold-unit cost must be 0 or more`)
  }
  return errors
}

/** Expected outcome of a given allocation (used for both optimal and baseline plans). */
export function evaluateAllocation(
  channels: AllocationChannel[],
  allocated: number[],
  totalStock: number,
): AllocationResult {
  const rows = channels.map((channel, index) => {
    let expectedSales = 0
    let expectedContribution = 0
    for (let k = 1; k <= allocated[index]; k++) {
      expectedSales += probDemandAtLeast(k, channel)
      expectedContribution += marginalValue(k, channel)
    }
    return {
      code: channel.code,
      name: channel.name,
      allocated: allocated[index],
      expectedSales,
      expectedUnsold: allocated[index] - expectedSales,
      fillRatePct: channel.expectedDemand > 0 ? (expectedSales / channel.expectedDemand) * 100 : 0,
      expectedContribution,
    }
  })
  const totalAllocated = allocated.reduce((sum, value) => sum + value, 0)
  return {
    channels: rows,
    totalStock,
    totalAllocated,
    reserve: totalStock - totalAllocated,
    expectedContribution: rows.reduce((sum, row) => sum + row.expectedContribution, 0),
    expectedSales: rows.reduce((sum, row) => sum + row.expectedSales, 0),
  }
}

/** Optimal allocation by marginal-value greedy. */
export function allocateInventory(
  totalStock: number,
  channels: AllocationChannel[],
): AllocationResult {
  const errors = validateAllocationInput(totalStock, channels)
  if (errors.length) throw new Error(errors.join("; "))

  const allocated = channels.map(() => 0)
  // Next unit's marginal value per channel; recomputed only for the channel that won.
  const next = channels.map((channel) => marginalValue(1, channel))

  for (let unit = 0; unit < totalStock; unit++) {
    let best = -1
    for (let i = 0; i < channels.length; i++) {
      if (next[i] > 0 && (best === -1 || next[i] > next[best])) best = i
    }
    if (best === -1) break // No channel gains from another unit: keep the rest in reserve.
    allocated[best] += 1
    next[best] = marginalValue(allocated[best] + 1, channels[best])
  }

  return evaluateAllocation(channels, allocated, totalStock)
}

/**
 * The common rule of thumb the optimiser is compared against: split all stock
 * in proportion to expected demand (largest-remainder rounding).
 */
export function proportionalAllocation(
  totalStock: number,
  channels: AllocationChannel[],
): AllocationResult {
  const totalDemand = channels.reduce(
    (sum, channel) => sum + Math.max(0, channel.expectedDemand),
    0,
  )
  if (totalDemand === 0)
    return evaluateAllocation(
      channels,
      channels.map(() => 0),
      totalStock,
    )

  const exact = channels.map(
    (channel) => (totalStock * Math.max(0, channel.expectedDemand)) / totalDemand,
  )
  const allocated = exact.map(Math.floor)
  let left = totalStock - allocated.reduce((sum, value) => sum + value, 0)
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder)
  for (const { index } of byRemainder) {
    if (left-- <= 0) break
    allocated[index] += 1
  }
  return evaluateAllocation(channels, allocated, totalStock)
}
