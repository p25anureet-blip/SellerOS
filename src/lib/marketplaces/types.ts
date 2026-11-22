/**
 * The contract every marketplace connector implements.
 *
 * Phase 3 adds a `simulated` connector used for the demo. A real integration
 * (Amazon SP-API, Flipkart, ...) would be another implementation of this same
 * interface, so nothing outside src/lib/marketplaces needs to change.
 */

export type MarketplaceCode =
  "amazon_in" | "flipkart" | "meesho" | "myntra" | "blinkit" | "zepto" | "swiggy_instamart"

export type ListingPayload = {
  sku: string
  title: string
  description: string
  bulletPoints: string[]
  priceInr: number
  mrpInr: number
  quantity: number
  /** Attributes already translated to the marketplace's own names and values. */
  attributes: Record<string, string | number | boolean>
}

export type ConnectorResult<T> =
  { ok: true; data: T } | { ok: false; error: string; field?: string; retryable: boolean }

export interface MarketplaceConnector {
  readonly code: MarketplaceCode
  publishListing(listing: ListingPayload): Promise<ConnectorResult<{ externalId: string }>>
  updatePrice(externalId: string, priceInr: number): Promise<ConnectorResult<void>>
  updateStock(externalId: string, quantity: number): Promise<ConnectorResult<void>>
}
