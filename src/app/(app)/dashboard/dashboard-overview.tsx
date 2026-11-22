"use client"

import Link from "next/link"
import {
  ArrowRightIcon,
  BoxIcon,
  CircleAlertIcon,
  IndianRupeeIcon,
  InfoIcon,
  LightbulbIcon,
  PackageIcon,
  SparklesIcon,
  StoreIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { StockBadge } from "@/components/products/stock-badge"
import { StoreGate } from "@/components/store-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  CATEGORIES,
  LOW_STOCK_THRESHOLD,
  categoryLabel,
  formatInr,
  stockStatus,
} from "@/lib/catalog/product"
import { generateRecommendations } from "@/lib/insights/recommendations"
import { LISTING_MARKETPLACE_CODES, getMarketplace } from "@/lib/marketplaces/catalog"
import { generateListing } from "@/lib/marketplaces/mapping"
import type { AppState } from "@/lib/store/app-store"
import { cn } from "@/lib/utils"

export function DashboardOverview() {
  return <StoreGate>{(state) => <Overview state={state} />}</StoreGate>
}

function Overview({ state }: { state: AppState }) {
  const { products, listings } = state
  const published = listings.filter((listing) => listing.status === "published")
  const readiness = LISTING_MARKETPLACE_CODES.map((code) => {
    const ready = products.filter((product) => generateListing(product, code).ready).length
    const live = published.filter((listing) => listing.marketplace === code).length
    return { code, name: getMarketplace(code).name, ready, live }
  })
  const totalReady = readiness.reduce((sum, row) => sum + row.ready, 0)
  const units = products.reduce((sum, product) => sum + product.quantity, 0)
  const costValue = products.reduce((sum, product) => sum + product.quantity * product.costPrice, 0)
  const mrpValue = products.reduce((sum, product) => sum + product.quantity * product.mrp, 0)
  const low = products.filter((product) => stockStatus(product.quantity) === "low").length
  const out = products.filter((product) => stockStatus(product.quantity) === "out").length
  const aiCreated = products.filter((product) => product.source === "ai_video").length
  const recent = [...products].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
  const recommendations = generateRecommendations(products, listings)

  const unitsByCategory = CATEGORIES.map((category) => ({
    label: category.label,
    units: products
      .filter((product) => product.category === category.value)
      .reduce((sum, product) => sum + product.quantity, 0),
  }))
    .filter((row) => row.units > 0)
    .sort((a, b) => b.units - a.units)
  const maxUnits = Math.max(1, ...unitsByCategory.map((row) => row.units))

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={BoxIcon}
          label="Total products"
          value={products.length.toLocaleString("en-IN")}
          sub={aiCreated ? `${aiCreated} added by the AI agent` : "In your central catalogue"}
          href="/products"
        />
        <StatCard
          icon={StoreIcon}
          label="Marketplace listings"
          value={published.length.toLocaleString("en-IN")}
          sub={`published · ${totalReady} ready across 3 channels`}
          href="/listings"
        />
        <StatCard
          icon={PackageIcon}
          label="Units in stock"
          value={units.toLocaleString("en-IN")}
          sub={`${low} low · ${out} out of stock`}
          tone={out ? "warn" : undefined}
          href="/inventory"
        />
        <StatCard
          icon={IndianRupeeIcon}
          label="Inventory value (cost)"
          value={formatInr(Math.round(costValue))}
          sub={`${formatInr(Math.round(mrpValue))} at MRP`}
          href="/insights"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LightbulbIcon className="size-4 text-primary" /> Recommendations
            </CardTitle>
            <CardDescription>
              Computed from your catalogue, channel fees and margins using SellerOS&apos;s pricing
              and listing engines.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {recommendations.length ? (
              recommendations.map((recommendation) => {
                const Icon =
                  recommendation.severity === "high"
                    ? CircleAlertIcon
                    : recommendation.severity === "medium"
                      ? TriangleAlertIcon
                      : InfoIcon
                return (
                  <div
                    key={recommendation.id}
                    className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40"
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        recommendation.severity === "high" && "text-destructive",
                        recommendation.severity === "medium" && "text-amber-500",
                        recommendation.severity === "info" && "text-primary",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{recommendation.title}</p>
                      <p className="text-xs text-muted-foreground">{recommendation.detail}</p>
                    </div>
                    <Button variant="ghost" size="sm" className="shrink-0" asChild>
                      <Link href={recommendation.href}>
                        {recommendation.action} <ArrowRightIcon />
                      </Link>
                    </Button>
                  </div>
                )
              })
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing needs attention right now.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Inventory overview</CardTitle>
            <CardDescription>Units in stock by category.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-3">
              {unitsByCategory.map((row) => (
                <div key={row.label} className="grid gap-1 text-sm">
                  <div className="flex justify-between">
                    <span>{row.label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {row.units.toLocaleString("en-IN")}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(row.units / maxUnits) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
              {!unitsByCategory.length ? (
                <p className="text-sm text-muted-foreground">No stock recorded yet.</p>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <MiniStat
                label="In stock"
                value={products.length - low - out}
                className="text-success"
              />
              <MiniStat
                label={`Low (<${LOW_STOCK_THRESHOLD})`}
                value={low}
                className="text-amber-500"
              />
              <MiniStat label="Out" value={out} className="text-destructive" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-start justify-between">
            <div className="grid gap-1.5">
              <CardTitle>Recent products</CardTitle>
              <CardDescription>Latest additions to your catalogue.</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/products">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-1">
            {recent.map((product) => (
              <Link
                key={product.id}
                href={`/products/${product.id}`}
                className="flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/60"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accent-foreground">
                  {product.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{product.name}</span>
                    {product.source === "ai_video" ? (
                      <Badge variant="secondary">
                        <SparklesIcon /> AI
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {product.brand} · {categoryLabel(product.category)}
                  </span>
                </span>
                <span className="hidden text-sm tabular-nums sm:block">
                  {formatInr(product.mrp)}
                </span>
                <StockBadge quantity={product.quantity} />
              </Link>
            ))}
            {!recent.length ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No products yet.{" "}
                <Link href="/products/new" className="text-primary hover:underline">
                  Add one
                </Link>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Listings by marketplace</CardTitle>
            <CardDescription>Ready to list vs. published (simulated).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {readiness.map((row) => (
              <div key={row.code} className="grid gap-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-muted-foreground">
                    {row.live} live · {row.ready}/{products.length} ready
                  </span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="bg-success"
                    style={{ width: `${(row.live / Math.max(1, products.length)) * 100}%` }}
                  />
                  <div
                    className="bg-primary/50"
                    style={{
                      width: `${(Math.max(0, row.ready - row.live) / Math.max(1, products.length)) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            <Button variant="outline" asChild>
              <Link href="/listings">
                Manage listings <ArrowRightIcon />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  href,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub: string
  href: string
  tone?: "warn"
}) {
  return (
    <Link href={href} className="group">
      <Card className="gap-3 transition-colors group-hover:border-primary/40">
        <CardContent className="grid gap-3">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            {label}
            <span className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Icon className="size-4" />
            </span>
          </div>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
          <p
            className={cn(
              "text-xs text-muted-foreground",
              tone === "warn" && "text-amber-600 dark:text-amber-400",
            )}
          >
            {sub}
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}

function MiniStat({
  label,
  value,
  className,
}: {
  label: string
  value: number
  className?: string
}) {
  return (
    <div className="rounded-md bg-muted/60 px-2 py-2">
      <p className={cn("text-lg font-semibold tabular-nums", className)}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
