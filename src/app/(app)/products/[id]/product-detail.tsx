"use client"

import { use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  PencilIcon,
  SparklesIcon,
} from "lucide-react"
import { DeleteProductButton } from "@/components/products/delete-product-button"
import { StockBadge } from "@/components/products/stock-badge"
import { StoreGate } from "@/components/store-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  type Product,
  categoryLabel,
  formatDimensions,
  formatInr,
  formatWeight,
} from "@/lib/catalog/product"
import { LISTING_MARKETPLACE_CODES } from "@/lib/marketplaces/catalog"
import { TEMPLATES, generateListing } from "@/lib/marketplaces/mapping"
import type { ListingRecord } from "@/lib/store/app-store"

export function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <StoreGate>
      {(state) => {
        const product = state.products.find((candidate) => candidate.id === id)
        if (!product) return <NotFound />
        return (
          <ProductDetailView
            product={product}
            listings={state.listings.filter((listing) => listing.productId === id)}
          />
        )
      }}
    </StoreGate>
  )
}

function NotFound() {
  return (
    <Card>
      <CardContent className="py-16 text-center">
        <h1 className="text-lg font-semibold">Product not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">It may have been deleted.</p>
        <Button variant="outline" className="mt-6" asChild>
          <Link href="/products">
            <ArrowLeftIcon /> Back to products
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function ProductDetailView({ product, listings }: { product: Product; listings: ListingRecord[] }) {
  const router = useRouter()
  const details: [string, React.ReactNode][] = [
    [
      "SKU",
      <span key="sku" className="font-mono">
        {product.sku}
      </span>,
    ],
    ["Category", categoryLabel(product.category)],
    ["MRP", formatInr(product.mrp)],
    ["Cost price", formatInr(product.costPrice)],
    ["Gross margin", `${(((product.mrp - product.costPrice) / product.mrp) * 100).toFixed(1)}%`],
    ["Weight", formatWeight(product.weightGrams)],
    ["Dimensions", formatDimensions(product)],
    ["Manufacturer", product.manufacturer || "—"],
  ]

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" asChild>
        <Link href="/products">
          <ArrowLeftIcon /> Products
        </Link>
      </Button>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StockBadge quantity={product.quantity} />
            {product.source === "ai_video" ? (
              <Badge variant="secondary">
                <SparklesIcon /> Extracted by AI from video
              </Badge>
            ) : null}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
          <p className="text-muted-foreground">{product.brand}</p>
        </div>
        <div className="flex gap-2">
          <DeleteProductButton
            productId={product.id}
            productName={product.name}
            variant="button"
            onDeleted={() => router.push("/products")}
          />
          <Button asChild>
            <Link href={`/products/${product.id}/edit`}>
              <PencilIcon /> Edit
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Product information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {product.description ? (
              <p className="text-sm leading-relaxed">{product.description}</p>
            ) : null}
            <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 font-medium">{value}</dd>
                </div>
              ))}
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Ingredients</dt>
                <dd className="mt-0.5 font-medium">{product.ingredients || "—"}</dd>
              </div>
            </dl>
            {product.attributes.length ? (
              <div>
                <h3 className="mb-2 text-sm text-muted-foreground">Additional attributes</h3>
                <div className="flex flex-wrap gap-2">
                  {product.attributes.map((attribute) => (
                    <Badge key={attribute.name} variant="outline" className="py-1">
                      <span className="text-muted-foreground">{attribute.name}:</span>{" "}
                      {attribute.value}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Marketplace readiness</CardTitle>
            <CardDescription>
              Price and contribution per unit after each channel&apos;s fees.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {LISTING_MARKETPLACE_CODES.map((code) => {
              const listing = generateListing(product, code)
              const record = listings.find((candidate) => candidate.marketplace === code)
              return (
                <div key={code} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{TEMPLATES[code].name}</span>
                    {record?.status === "published" ? (
                      <Badge variant="success">Published</Badge>
                    ) : listing.ready ? (
                      <Badge variant="secondary">
                        <CheckCircle2Icon /> Ready
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <CircleAlertIcon /> {listing.issues.length} issue
                        {listing.issues.length === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 text-muted-foreground">
                    Sell at{" "}
                    <span className="font-medium text-foreground">
                      {formatInr(listing.pricing.recommendedPrice)}
                    </span>{" "}
                    · contribution{" "}
                    <span
                      className={
                        listing.pricing.contribution < 0
                          ? "font-medium text-destructive"
                          : "font-medium text-foreground"
                      }
                    >
                      {formatInr(listing.pricing.contribution)}
                    </span>{" "}
                    ({listing.pricing.contributionMarginPct.toFixed(1)}%)
                  </p>
                  {!listing.ready ? (
                    <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-destructive">
                      {listing.issues.slice(0, 3).map((issue) => (
                        <li key={issue.column + issue.message}>{issue.message}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            })}
            <Button variant="outline" asChild>
              <Link href="/listings">Open listings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
