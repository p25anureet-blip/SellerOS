"use client"

import { Fragment, useMemo, useState } from "react"
import Link from "next/link"
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  DownloadIcon,
  Loader2Icon,
  SendIcon,
  StoreIcon,
} from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/layout/page-header"
import { StoreGate } from "@/components/store-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { type Product, formatInr } from "@/lib/catalog/product"
import { downloadCsv, toCsv } from "@/lib/export/csv"
import {
  LISTING_MARKETPLACE_CODES,
  type ListingMarketplaceCode,
  getMarketplace,
} from "@/lib/marketplaces/catalog"
import {
  type GeneratedListing,
  TEMPLATES,
  generateListing,
  templateHeaders,
} from "@/lib/marketplaces/mapping"
import { type ListingRecord, saveListings } from "@/lib/store/app-store"
import { cn } from "@/lib/utils"

export function ListingsView() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Listings"
        description="Each product is mapped into every marketplace's format, priced after fees and checked against the channel's rules."
      />
      <StoreGate>
        {(state) => <Listings products={state.products} records={state.listings} />}
      </StoreGate>
    </div>
  )
}

function Listings({ products, records }: { products: Product[]; records: ListingRecord[] }) {
  const [marketplace, setMarketplace] = useState<ListingMarketplaceCode>("amazon_in")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

  const generated = useMemo(() => {
    const all = {} as Record<ListingMarketplaceCode, GeneratedListing[]>
    for (const code of LISTING_MARKETPLACE_CODES) {
      all[code] = products.map((product) => generateListing(product, code))
    }
    return all
  }, [products])

  const listings = generated[marketplace]
  const template = TEMPLATES[marketplace]
  const record = (productId: string) =>
    records.find((entry) => entry.productId === productId && entry.marketplace === marketplace)
  const ready = listings.filter((listing) => listing.ready)
  const published = listings.filter((listing) => record(listing.productId)?.status === "published")
  const selectedReady = ready.filter((listing) => selected.has(listing.productId))
  const target = selectedReady.length ? selectedReady : ready

  function switchTo(code: ListingMarketplaceCode) {
    setMarketplace(code)
    setSelected(new Set())
    setExpanded(null)
  }

  function exportCsv() {
    if (!target.length) {
      toast.error("No listings are ready to export. Fix the issues shown first.")
      return
    }
    const csv = toCsv(
      templateHeaders(marketplace),
      target.map((listing) => listing.row),
    )
    const date = new Date().toISOString().slice(0, 10)
    downloadCsv(`${template.fileName}-${date}.csv`, csv)
    saveListings(
      target.map((listing) => ({
        productId: listing.productId,
        marketplace,
        title: listing.title,
        price: listing.pricing.recommendedPrice,
      })),
      "draft",
    )
    toast.success(
      `Downloaded ${target.length} ${template.name} listing${target.length === 1 ? "" : "s"}`,
    )
  }

  async function publish() {
    if (!target.length) {
      toast.error("No listings are ready to publish.")
      return
    }
    setPublishing(true)
    // Simulated marketplace API round-trip.
    await new Promise((resolve) => setTimeout(resolve, 1200))
    saveListings(
      target.map((listing) => ({
        productId: listing.productId,
        marketplace,
        title: listing.title,
        price: listing.pricing.recommendedPrice,
      })),
      "published",
    )
    setPublishing(false)
    setSelected(new Set())
    toast.success(
      `Published ${target.length} listing${target.length === 1 ? "" : "s"} to ${template.name}`,
      {
        description: "Simulated publishing: no real marketplace was contacted.",
      },
    )
  }

  if (!products.length) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <StoreIcon className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Add products to generate listings</p>
          <Button className="mt-4" asChild>
            <Link href="/products/new">Add product</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3" role="tablist" aria-label="Marketplace">
        {LISTING_MARKETPLACE_CODES.map((code) => {
          const readyCount = generated[code].filter((listing) => listing.ready).length
          const info = getMarketplace(code)
          return (
            <button
              key={code}
              role="tab"
              aria-selected={marketplace === code}
              onClick={() => switchTo(code)}
              className={cn(
                "cursor-pointer rounded-xl border bg-card p-4 text-left transition-colors",
                marketplace === code
                  ? "border-primary ring-2 ring-primary/20"
                  : "hover:bg-accent/40",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{info.name}</span>
                <Badge variant="outline">
                  {info.channelType === "quick_commerce" ? "Quick commerce" : "E-commerce"}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{readyCount}</span> of{" "}
                {generated[code].length} ready · {info.commissionPct}% commission
              </p>
            </button>
          )
        })}
      </div>

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="secondary">
              <CheckCircle2Icon /> {ready.length} ready
            </Badge>
            <Badge variant="destructive">
              <CircleAlertIcon /> {listings.length - ready.length} need attention
            </Badge>
            <Badge variant="success">{published.length} published</Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCsv}>
              <DownloadIcon /> Download CSV ({target.length})
            </Button>
            <Button onClick={publish} disabled={publishing}>
              {publishing ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              Publish ({target.length})
            </Button>
          </div>
        </div>
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">
          {selectedReady.length
            ? `${selectedReady.length} selected.`
            : "No selection: actions apply to every ready listing."}{" "}
          Publishing is simulated for this demo; the CSV is a real {template.name} upload file.
        </p>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 pl-4">
                <input
                  type="checkbox"
                  aria-label="Select all ready listings"
                  className="size-4 accent-[var(--primary)]"
                  checked={ready.length > 0 && selectedReady.length === ready.length}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? new Set(ready.map((listing) => listing.productId))
                        : new Set(),
                    )
                  }
                />
              </TableHead>
              <TableHead>{template.name} title</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Contribution</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10 pr-4">
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listings.map((listing) => {
              const product = products.find((candidate) => candidate.id === listing.productId)!
              const saved = record(listing.productId)
              const open = expanded === listing.productId
              return (
                <Fragment key={listing.productId}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => setExpanded(open ? null : listing.productId)}
                  >
                    <TableCell className="pl-4" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${product.name}`}
                        className="size-4 accent-[var(--primary)]"
                        disabled={!listing.ready}
                        checked={selected.has(listing.productId)}
                        onChange={(event) => {
                          const next = new Set(selected)
                          if (event.target.checked) next.add(listing.productId)
                          else next.delete(listing.productId)
                          setSelected(next)
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <p className="max-w-xl font-medium">{listing.title}</p>
                      <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatInr(listing.pricing.recommendedPrice)}
                      <p className="text-xs text-muted-foreground">MRP {formatInr(product.mrp)}</p>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        listing.pricing.contribution < 0 && "text-destructive",
                      )}
                    >
                      {formatInr(listing.pricing.contribution)}
                      <p className="text-xs text-muted-foreground">
                        {listing.pricing.contributionMarginPct.toFixed(1)}%
                      </p>
                    </TableCell>
                    <TableCell>
                      {saved?.status === "published" ? (
                        <div>
                          <Badge variant="success">Published</Badge>
                          <p className="mt-1 font-mono text-xs text-muted-foreground">
                            {saved.externalId}
                          </p>
                        </div>
                      ) : listing.ready ? (
                        <Badge variant="secondary">
                          <CheckCircle2Icon /> Ready{saved ? " · exported" : ""}
                        </Badge>
                      ) : (
                        <div>
                          <Badge variant="destructive">
                            <CircleAlertIcon /> {listing.issues.length} issue
                            {listing.issues.length === 1 ? "" : "s"}
                          </Badge>
                          <p className="mt-1 max-w-56 truncate text-xs text-destructive">
                            {listing.issues[0].message}
                          </p>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="pr-4">
                      <ChevronDownIcon
                        className={cn(
                          "size-4 text-muted-foreground transition-transform",
                          open && "rotate-180",
                        )}
                      />
                    </TableCell>
                  </TableRow>
                  {open ? (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={6} className="px-4 py-4">
                        <ListingDetail listing={listing} productId={product.id} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      <MappingTable code={marketplace} />
    </div>
  )
}

function ListingDetail({ listing, productId }: { listing: GeneratedListing; productId: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <p className="mb-2 text-xs font-medium text-muted-foreground uppercase">Generated row</p>
        <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          {Object.entries(listing.row).map(([column, value]) => (
            <div key={column} className="flex gap-2 border-b border-dashed py-1">
              <dt className="w-44 shrink-0 font-mono text-muted-foreground">{column}</dt>
              <dd
                className={cn(
                  "min-w-0 break-words",
                  (value === null || value === "") && "text-muted-foreground/60",
                )}
              >
                {value === null || value === "" ? "(empty)" : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="grid content-start gap-3 text-sm">
        {listing.issues.length ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
            <p className="mb-1 font-medium text-destructive">Fix before listing</p>
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {listing.issues.map((issue) => (
                <li key={issue.column + issue.message}>{issue.message}</li>
              ))}
            </ul>
            <Button size="sm" variant="outline" className="mt-3" asChild>
              <Link href={`/products/${productId}/edit`}>Edit product</Link>
            </Button>
          </div>
        ) : null}
        <div className="rounded-md border bg-card p-3 text-xs">
          <p className="mb-1 font-medium">How the price was set</p>
          <p className="text-muted-foreground">
            Total cost {formatInr(listing.pricing.totalCost)} (product + ₹10 packaging + channel
            fees), commission {formatInr(listing.pricing.commissionAmount)}, target 20% contribution
            margin
            {listing.pricing.status === "capped_by_mrp" ? ", capped at MRP" : ""}.
          </p>
        </div>
      </div>
    </div>
  )
}

function MappingTable({ code }: { code: ListingMarketplaceCode }) {
  const template = TEMPLATES[code]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attribute mapping: SellerOS → {template.name}</CardTitle>
        <CardDescription>
          How universal product attributes become {template.name} template fields. Title rule:{" "}
          {template.titleRule}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-x-8 sm:grid-cols-2">
          {template.columns.map((column) => (
            <div
              key={column.header}
              className="flex items-center justify-between gap-3 border-b py-2 text-sm"
            >
              <span className="font-mono text-xs">{column.header}</span>
              <span className="flex items-center gap-2 text-right text-muted-foreground">
                {column.source}
                {column.required === true ? (
                  <Badge variant="outline" className="text-[10px]">
                    required
                  </Badge>
                ) : typeof column.required === "function" ? (
                  <Badge variant="outline" className="text-[10px]">
                    required for food/beauty
                  </Badge>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
