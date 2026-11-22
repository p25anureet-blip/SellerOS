import { LOW_STOCK_THRESHOLD, type Product, formatInr } from "@/lib/catalog/product"
import { LISTING_MARKETPLACE_CODES, getMarketplace } from "@/lib/marketplaces/catalog"
import { generateListing } from "@/lib/marketplaces/mapping"

/**
 * Recommendations computed from the catalogue with the same pricing and
 * listing rules used elsewhere: every number shown is calculated, not generated.
 */

export type Recommendation = {
  id: string
  severity: "high" | "medium" | "info"
  kind: "stock" | "pricing" | "listing" | "data"
  title: string
  detail: string
  href: string
  action: string
}

type ListingState = { productId: string; marketplace: string; status: string }

const SEVERITY_ORDER = { high: 0, medium: 1, info: 2 } as const

export function generateRecommendations(
  products: Product[],
  listings: ListingState[],
  limit = 6,
): Recommendation[] {
  const recommendations: Recommendation[] = []

  for (const product of products) {
    const generated = LISTING_MARKETPLACE_CODES.map((code) => generateListing(product, code))

    if (product.quantity <= 0) {
      recommendations.push({
        id: `out-${product.id}`,
        severity: "high",
        kind: "stock",
        title: `${product.name} is out of stock`,
        detail: "Live listings will be hidden by marketplaces. Restock or pause the listings.",
        href: `/products/${product.id}/edit`,
        action: "Update stock",
      })
    } else if (product.quantity < LOW_STOCK_THRESHOLD) {
      recommendations.push({
        id: `low-${product.id}`,
        severity: "medium",
        kind: "stock",
        title: `Only ${product.quantity} units of ${product.name} left`,
        detail: `Below the ${LOW_STOCK_THRESHOLD}-unit threshold. Plan which channels get the remaining stock.`,
        href: "/inventory",
        action: "Plan allocation",
      })
    }

    const losing = generated.filter((listing) => listing.pricing.contribution < 0)
    for (const listing of losing) {
      const name = getMarketplace(listing.marketplace).name
      recommendations.push({
        id: `loss-${product.id}-${listing.marketplace}`,
        severity: "high",
        kind: "pricing",
        title: `${product.name} loses ${formatInr(Math.abs(listing.pricing.contribution))} per sale on ${name}`,
        detail: `Even at MRP, fees and costs exceed the price. Break-even needs ${formatInr(listing.pricing.breakEvenPrice)}.`,
        href: "/insights",
        action: "Review pricing",
      })
    }

    const blockedByData = generated.filter(
      (listing) => !listing.ready && listing.issues.some((issue) => /required/.test(issue.message)),
    )
    if (blockedByData.length) {
      const missing = [
        ...new Set(
          blockedByData.flatMap((listing) =>
            listing.issues
              .filter((issue) => /required/.test(issue.message))
              .map((issue) => issue.message.match(/from (\w+)/)?.[1] ?? issue.column),
          ),
        ),
      ]
      const channels = blockedByData.map((listing) => getMarketplace(listing.marketplace).name)
      recommendations.push({
        id: `data-${product.id}`,
        severity: "medium",
        kind: "data",
        title: `Add ${missing.join(", ")} to ${product.name}`,
        detail: `Missing data blocks listing on ${channels.join(" and ")}.`,
        href: `/products/${product.id}/edit`,
        action: "Complete product",
      })
    }

    const published = listings.some(
      (listing) => listing.productId === product.id && listing.status === "published",
    )
    const profitable = generated
      .filter((listing) => listing.ready && listing.pricing.contribution > 0)
      .sort((a, b) => b.pricing.contribution - a.pricing.contribution)
    if (!published && profitable.length && product.quantity > 0) {
      const best = profitable[0]
      const worst = profitable[profitable.length - 1]
      recommendations.push({
        id: `list-${product.id}`,
        severity: "info",
        kind: "listing",
        title: `List ${product.name} on ${getMarketplace(best.marketplace).name}`,
        detail:
          profitable.length > 1
            ? `Highest contribution: ${formatInr(best.pricing.contribution)} per unit vs ${formatInr(worst.pricing.contribution)} on ${getMarketplace(worst.marketplace).name}.`
            : `Earns ${formatInr(best.pricing.contribution)} per unit after fees.`,
        href: "/listings",
        action: "Open listings",
      })
    }
  }

  return recommendations
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, limit)
}
