"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BoxIcon, PencilIcon, PlusIcon, SearchIcon, SparklesIcon, XIcon } from "lucide-react"
import { DeleteProductButton } from "@/components/products/delete-product-button"
import { StockBadge } from "@/components/products/stock-badge"
import { PageHeader } from "@/components/layout/page-header"
import { StoreGate } from "@/components/store-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  CATEGORIES,
  type Product,
  categoryLabel,
  formatInr,
  stockStatus,
} from "@/lib/catalog/product"

type SortKey = "updated" | "name" | "stock" | "margin"

const marginPct = (product: Product) => ((product.mrp - product.costPrice) / product.mrp) * 100

export function ProductsView() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Your central catalogue: one source of truth for every channel."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/media">
                <SparklesIcon /> Add from video
              </Link>
            </Button>
            <Button asChild>
              <Link href="/products/new">
                <PlusIcon /> Add product
              </Link>
            </Button>
          </>
        }
      />
      <StoreGate>{(state) => <ProductTable products={state.products} />}</StoreGate>
    </div>
  )
}

function ProductTable({ products }: { products: Product[] }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("")
  const [stock, setStock] = useState("")
  const [sort, setSort] = useState<SortKey>("updated")

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = products.filter((product) => {
      if (category && product.category !== category) return false
      if (stock && stockStatus(product.quantity) !== stock) return false
      if (!needle) return true
      return [product.name, product.brand, product.sku, product.manufacturer]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    })
    const sorters: Record<SortKey, (a: Product, b: Product) => number> = {
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      name: (a, b) => a.name.localeCompare(b.name),
      stock: (a, b) => a.quantity - b.quantity,
      margin: (a, b) => marginPct(b) - marginPct(a),
    }
    return rows.sort(sorters[sort])
  }, [products, query, category, stock, sort])

  const filtersActive = Boolean(query || category || stock)

  if (!products.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <BoxIcon className="size-6" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">No products yet</h2>
            <p className="text-sm text-muted-foreground">
              Add your first product by hand, or let the AI agent read it from a video.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/media">
                <SparklesIcon /> Add from video
              </Link>
            </Button>
            <Button asChild>
              <Link href="/products/new">
                <PlusIcon /> Add product
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, brand, SKU or manufacturer…"
            className="pl-9"
            aria-label="Search products"
          />
        </div>
        <div className="grid grid-cols-3 gap-2 lg:flex">
          <NativeSelect
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Filter by category"
            className="lg:w-52"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            value={stock}
            onChange={(event) => setStock(event.target.value)}
            aria-label="Filter by stock"
            className="lg:w-40"
          >
            <option value="">Any stock</option>
            <option value="ok">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </NativeSelect>
          <NativeSelect
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            aria-label="Sort products"
            className="lg:w-44"
          >
            <option value="updated">Recently updated</option>
            <option value="name">Name A–Z</option>
            <option value="stock">Lowest stock</option>
            <option value="margin">Highest margin</option>
          </NativeSelect>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 text-sm text-muted-foreground">
        <span>
          Showing <strong className="text-foreground">{filtered.length}</strong> of{" "}
          {products.length} products
        </span>
        {filtersActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("")
              setCategory("")
              setStock("")
            }}
          >
            <XIcon /> Clear filters
          </Button>
        ) : null}
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Product</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Stock</TableHead>
            <TableHead className="text-right">MRP</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Margin</TableHead>
            <TableHead className="pr-4 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((product) => (
            <TableRow
              key={product.id}
              className="cursor-pointer"
              onClick={() => router.push(`/products/${product.id}`)}
            >
              <TableCell className="pl-4">
                <div className="flex items-center gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/products/${product.id}`}
                      className="block max-w-72 truncate font-medium hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {product.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">{product.brand}</span>
                  </div>
                  {product.source === "ai_video" ? (
                    <Badge variant="secondary" title="Created by the AI Product Agent">
                      <SparklesIcon /> AI
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs">{product.sku}</TableCell>
              <TableCell className="text-muted-foreground">
                {categoryLabel(product.category)}
              </TableCell>
              <TableCell>
                <StockBadge quantity={product.quantity} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatInr(product.mrp)}</TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {formatInr(product.costPrice)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {marginPct(product).toFixed(0)}%
              </TableCell>
              <TableCell className="pr-4 text-right" onClick={(event) => event.stopPropagation()}>
                <div className="flex justify-end">
                  <Button variant="ghost" size="icon" asChild>
                    <Link href={`/products/${product.id}/edit`} aria-label={`Edit ${product.name}`}>
                      <PencilIcon className="text-muted-foreground" />
                    </Link>
                  </Button>
                  <DeleteProductButton productId={product.id} productName={product.name} />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!filtered.length ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                No products match these filters.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </Card>
  )
}
