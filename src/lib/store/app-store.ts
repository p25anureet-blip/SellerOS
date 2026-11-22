"use client"

import { useSyncExternalStore } from "react"
import type { Product, ProductInput } from "@/lib/catalog/product"
import type { ListingMarketplaceCode } from "@/lib/marketplaces/catalog"
import { seedProducts } from "./seed"

/**
 * Demo-mode data store, kept in the browser's localStorage.
 *
 * Everything the UI needs goes through the functions below, so replacing this
 * file with a Supabase-backed implementation later does not touch the pages.
 */

export type ListingStatus = "draft" | "published"

export type ListingRecord = {
  id: string
  productId: string
  marketplace: ListingMarketplaceCode
  status: ListingStatus
  title: string
  price: number
  externalId: string | null
  updatedAt: string
}

export type AppState = {
  version: 1
  products: Product[]
  listings: ListingRecord[]
}

const STORAGE_KEY = "selleros:demo:v1"
const listeners = new Set<() => void>()
let state: AppState | null = null

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function freshState(): AppState {
  return { version: 1, products: seedProducts(), listings: [] }
}

function load(): AppState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      if (
        parsed?.version === 1 &&
        Array.isArray(parsed.products) &&
        Array.isArray(parsed.listings)
      ) {
        return parsed
      }
    }
  } catch {
    // Unreadable or blocked storage: fall back to the sample catalogue.
  }
  const initial = freshState()
  persist(initial)
  return initial
}

function persist(next: AppState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Private mode / quota: keep working in memory for this session.
  }
}

function setState(update: (current: AppState) => AppState) {
  const next = update(getSnapshot())
  state = next
  persist(next)
  listeners.forEach((listener) => listener())
}

function getSnapshot(): AppState {
  state ??= load()
  return state
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Keep several open tabs in sync.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return
    state = null
    listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

/** The whole store, or null during server rendering / before the browser loads it. */
export function useAppState(): AppState | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export function isSkuTaken(sku: string, exceptId?: string): boolean {
  const wanted = sku.trim().toLowerCase()
  return getSnapshot().products.some(
    (product) => product.sku.toLowerCase() === wanted && product.id !== exceptId,
  )
}

export function addProduct(input: ProductInput, source: Product["source"] = "manual"): Product {
  const now = new Date().toISOString()
  const product: Product = { ...input, id: newId(), source, createdAt: now, updatedAt: now }
  setState((current) => ({ ...current, products: [product, ...current.products] }))
  return product
}

export function updateProduct(id: string, input: ProductInput) {
  setState((current) => ({
    ...current,
    products: current.products.map((product) =>
      product.id === id ? { ...product, ...input, updatedAt: new Date().toISOString() } : product,
    ),
  }))
}

export function deleteProduct(id: string) {
  setState((current) => ({
    ...current,
    products: current.products.filter((product) => product.id !== id),
    listings: current.listings.filter((listing) => listing.productId !== id),
  }))
}

// ---------------------------------------------------------------------------
// Listings (publishing is simulated)
// ---------------------------------------------------------------------------

const EXTERNAL_ID_PREFIX: Record<ListingMarketplaceCode, string> = {
  amazon_in: "B0",
  flipkart: "FK",
  blinkit: "BLK",
}

function externalId(marketplace: ListingMarketplaceCode): string {
  const random = Math.random().toString(36).slice(2, 10).toUpperCase()
  return `${EXTERNAL_ID_PREFIX[marketplace]}${random}`
}

export type ListingDraft = Pick<ListingRecord, "productId" | "marketplace" | "title" | "price">

/** Saves (or refreshes) listings with the given status. */
export function saveListings(drafts: ListingDraft[], status: ListingStatus) {
  const now = new Date().toISOString()
  setState((current) => {
    const listings = [...current.listings]
    for (const draft of drafts) {
      const index = listings.findIndex(
        (listing) =>
          listing.productId === draft.productId && listing.marketplace === draft.marketplace,
      )
      const existing = index >= 0 ? listings[index] : null
      const record: ListingRecord = {
        id: existing?.id ?? newId(),
        ...draft,
        status: existing?.status === "published" ? "published" : status,
        externalId:
          status === "published"
            ? (existing?.externalId ?? externalId(draft.marketplace))
            : (existing?.externalId ?? null),
        updatedAt: now,
      }
      if (index >= 0) listings[index] = record
      else listings.push(record)
    }
    return { ...current, listings }
  })
}

export function unpublishListing(productId: string, marketplace: ListingMarketplaceCode) {
  setState((current) => ({
    ...current,
    listings: current.listings.filter(
      (listing) => !(listing.productId === productId && listing.marketplace === marketplace),
    ),
  }))
}

// ---------------------------------------------------------------------------
// Demo data management
// ---------------------------------------------------------------------------

export function resetDemoData() {
  setState(() => freshState())
}

export function clearAllData() {
  setState(() => ({ version: 1, products: [], listings: [] }))
}
