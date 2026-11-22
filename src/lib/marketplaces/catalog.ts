import type { MarketplaceCode } from "./types"

/**
 * Built-in copy of the marketplace reference data (mirrors the rows inserted by
 * supabase/migrations/20261122000001_foundation.sql). Used in DEMO_MODE and by
 * the pricing and allocation calculators as defaults.
 *
 * Fee values are illustrative demo defaults, not official fee schedules.
 */
export type MarketplaceInfo = {
  code: MarketplaceCode
  name: string
  channelType: "ecommerce" | "quick_commerce"
  commissionPct: number
  fixedFeeInr: number
  shippingFeeInr: number
}

export const MARKETPLACES: MarketplaceInfo[] = [
  {
    code: "amazon_in",
    name: "Amazon India",
    channelType: "ecommerce",
    commissionPct: 15,
    fixedFeeInr: 20,
    shippingFeeInr: 60,
  },
  {
    code: "flipkart",
    name: "Flipkart",
    channelType: "ecommerce",
    commissionPct: 14,
    fixedFeeInr: 20,
    shippingFeeInr: 55,
  },
  {
    code: "meesho",
    name: "Meesho",
    channelType: "ecommerce",
    commissionPct: 0,
    fixedFeeInr: 0,
    shippingFeeInr: 70,
  },
  {
    code: "myntra",
    name: "Myntra",
    channelType: "ecommerce",
    commissionPct: 22,
    fixedFeeInr: 25,
    shippingFeeInr: 50,
  },
  {
    code: "blinkit",
    name: "Blinkit",
    channelType: "quick_commerce",
    commissionPct: 18,
    fixedFeeInr: 10,
    shippingFeeInr: 0,
  },
  {
    code: "zepto",
    name: "Zepto",
    channelType: "quick_commerce",
    commissionPct: 17,
    fixedFeeInr: 10,
    shippingFeeInr: 0,
  },
  {
    code: "swiggy_instamart",
    name: "Swiggy Instamart",
    channelType: "quick_commerce",
    commissionPct: 18,
    fixedFeeInr: 10,
    shippingFeeInr: 0,
  },
]

/** The channels SellerOS generates listings and CSV exports for in the demo. */
export const LISTING_MARKETPLACE_CODES = ["amazon_in", "flipkart", "blinkit"] as const
export type ListingMarketplaceCode = (typeof LISTING_MARKETPLACE_CODES)[number]

export function getMarketplace(code: MarketplaceCode): MarketplaceInfo {
  const marketplace = MARKETPLACES.find((candidate) => candidate.code === code)
  if (!marketplace) throw new Error(`Unknown marketplace ${code}`)
  return marketplace
}
