"use client"

import { useMemo, useState } from "react"
import { PlusIcon, Trash2Icon, TrendingUpIcon } from "lucide-react"
import { PageHeader } from "@/components/layout/page-header"
import { NumberField } from "@/components/number-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { type Product, formatInr } from "@/lib/catalog/product"
import {
  type AllocationChannel,
  type AllocationResult,
  allocateInventory,
  proportionalAllocation,
  validateAllocationInput,
} from "@/lib/inventory/allocation"
import { MARKETPLACES, getMarketplace } from "@/lib/marketplaces/catalog"
import type { MarketplaceCode } from "@/lib/marketplaces/types"
import { priceForChannel } from "@/lib/pricing/calculator"
import { useAppState } from "@/lib/store/app-store"
import { cn } from "@/lib/utils"

type Row = {
  code: string
  name: string
  demand: string
  contribution: string
  cv: string
  unsoldCost: string
}

const COLORS = [
  "bg-primary",
  "bg-sky-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-violet-400",
  "bg-teal-500",
]

const DEFAULT_ROWS: Row[] = [
  {
    code: "amazon_in",
    name: "Amazon India",
    demand: "140",
    contribution: "26",
    cv: "30",
    unsoldCost: "12",
  },
  {
    code: "flipkart",
    name: "Flipkart",
    demand: "90",
    contribution: "33",
    cv: "35",
    unsoldCost: "12",
  },
  {
    code: "blinkit",
    name: "Blinkit",
    demand: "180",
    contribution: "38",
    // Quick commerce: volatile demand and costly returns from dark stores.
    cv: "60",
    unsoldCost: "35",
  },
  {
    code: "meesho",
    name: "Meesho",
    demand: "120",
    contribution: "8",
    cv: "40",
    unsoldCost: "15",
  },
]

const inr0 = (value: number) => formatInr(Math.round(value))

export function AllocationPlanner() {
  const state = useAppState()
  const [stock, setStock] = useState("300")
  const [rows, setRows] = useState<Row[]>(DEFAULT_ROWS)

  const { channels, errors, plans } = useMemo(() => {
    const channels: AllocationChannel[] = rows.map((row) => ({
      code: row.code,
      name: row.name || row.code,
      expectedDemand: Number(row.demand),
      contributionPerUnit: Number(row.contribution),
      demandCvPct: Number(row.cv),
      unsoldCostPerUnit: Number(row.unsoldCost),
    }))
    const totalStock = Number(stock)
    const blank =
      stock.trim() === "" ||
      rows.some((row) =>
        [row.demand, row.contribution, row.cv, row.unsoldCost].some((v) => v.trim() === ""),
      )
    const errors = blank
      ? ["Fill in stock and every channel's numbers"]
      : validateAllocationInput(totalStock, channels)
    const plans = errors.length
      ? null
      : {
          optimal: allocateInventory(totalStock, channels),
          naive: proportionalAllocation(totalStock, channels),
        }
    return { channels, errors, plans }
  }, [rows, stock])

  const update = (index: number, key: keyof Row) => (value: string) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)))

  function loadProduct(product: Product) {
    setStock(String(product.quantity))
    setRows((current) =>
      current.map((row) => {
        const marketplace = MARKETPLACES.find((candidate) => candidate.code === row.code)
        if (!marketplace) return row
        const pricing = priceForChannel(product, marketplace)
        return { ...row, contribution: String(pricing.contribution) }
      }),
    )
  }

  const unusedMarketplaces = MARKETPLACES.filter(
    (marketplace) => !rows.some((row) => row.code === marketplace.code),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory intelligence"
        description="Split limited stock across marketplaces to maximise expected contribution."
      />

      <Card>
        <CardHeader>
          <CardTitle>Inputs</CardTitle>
          <CardDescription>
            Expected demand is units you expect to sell in the planning period. Contribution per
            unit comes from the pricing engine when you load a product.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid content-start gap-2">
              <Label htmlFor="load-product">Load a product</Label>
              <NativeSelect
                id="load-product"
                defaultValue=""
                onChange={(event) => {
                  const product = state?.products.find(
                    (candidate) => candidate.id === event.target.value,
                  )
                  if (product) loadProduct(product)
                }}
              >
                <option value="">Choose…</option>
                {state?.products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.quantity} in stock)
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                Sets stock and per-channel contribution.
              </p>
            </div>
            <NumberField
              id="stock"
              label="Total available stock"
              unit="units"
              step="1"
              value={stock}
              onChange={setStock}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground uppercase">
                  <th className="pb-2 font-medium">Marketplace</th>
                  <th className="pb-2 font-medium">Expected demand (units)</th>
                  <th className="pb-2 font-medium">Contribution / unit (₹)</th>
                  <th className="pb-2 font-medium" title="How uncertain the demand forecast is">
                    Demand variability (%)
                  </th>
                  <th
                    className="pb-2 font-medium"
                    title="Return shipping, storage or write-off for a unit that does not sell"
                  >
                    Cost if unsold (₹)
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.code}>
                    <td className="py-1.5 pr-3 font-medium">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn("size-2.5 rounded-sm", COLORS[index % COLORS.length])}
                        />
                        {row.name}
                      </span>
                    </td>
                    {(["demand", "contribution", "cv", "unsoldCost"] as const).map((key) => (
                      <td key={key} className="py-1.5 pr-3">
                        <Input
                          type="number"
                          inputMode="decimal"
                          aria-label={`${row.name} ${key}`}
                          value={row[key]}
                          onChange={(event) => update(index, key)(event.target.value)}
                        />
                      </td>
                    ))}
                    <td className="py-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${row.name}`}
                        disabled={rows.length === 1}
                        onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                      >
                        <Trash2Icon className="text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unusedMarketplaces.length ? (
            <div className="flex flex-wrap gap-2">
              {unusedMarketplaces.map((marketplace) => (
                <Button
                  key={marketplace.code}
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRows((current) => [
                      ...current,
                      {
                        code: marketplace.code,
                        name: getMarketplace(marketplace.code as MarketplaceCode).name,
                        demand: "50",
                        contribution: "25",
                        cv: "35",
                        unsoldCost: "12",
                      },
                    ])
                  }
                >
                  <PlusIcon /> {marketplace.name}
                </Button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {errors.length || !plans ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            {errors.join(" · ")}
          </CardContent>
        </Card>
      ) : (
        <Results
          optimal={plans.optimal}
          naive={plans.naive}
          totalDemand={channels.reduce((sum, c) => sum + c.expectedDemand, 0)}
        />
      )}
    </div>
  )
}

function Results({
  optimal,
  naive,
  totalDemand,
}: {
  optimal: AllocationResult
  naive: AllocationResult
  totalDemand: number
}) {
  const uplift = optimal.expectedContribution - naive.expectedContribution
  const upliftPct =
    naive.expectedContribution > 0 ? (uplift / naive.expectedContribution) * 100 : null

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Optimal allocation</CardTitle>
          <CardDescription>
            {optimal.totalStock.toLocaleString("en-IN")} units in stock against{" "}
            {Math.round(totalDemand).toLocaleString("en-IN")} units of expected demand.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div>
            <div className="flex h-9 overflow-hidden rounded-md bg-muted">
              {optimal.channels.map((channel, index) =>
                channel.allocated > 0 ? (
                  <div
                    key={channel.code}
                    className={cn(
                      "flex items-center justify-center text-xs font-medium text-white",
                      COLORS[index % COLORS.length],
                    )}
                    style={{
                      width: `${(channel.allocated / Math.max(1, optimal.totalStock)) * 100}%`,
                    }}
                    title={`${channel.name}: ${channel.allocated} units`}
                  >
                    {channel.allocated / Math.max(1, optimal.totalStock) > 0.08
                      ? channel.allocated
                      : ""}
                  </div>
                ) : null,
              )}
            </div>
            {optimal.reserve > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Grey = {optimal.reserve.toLocaleString("en-IN")} units kept in the warehouse:
                sending them out would cost more in unsold-unit costs than they are expected to
                earn.
              </p>
            ) : null}
          </div>

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Marketplace</TableHead>
                <TableHead className="text-right">Allocate</TableHead>
                <TableHead className="text-right">Expected sales</TableHead>
                <TableHead className="text-right">Fill rate</TableHead>
                <TableHead className="text-right">Exp. contribution</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {optimal.channels.map((channel, index) => (
                <TableRow key={channel.code}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <span className={cn("size-2.5 rounded-sm", COLORS[index % COLORS.length])} />
                      {channel.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {channel.allocated.toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {channel.expectedSales.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {channel.fillRatePct.toFixed(0)}%
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      channel.expectedContribution < 0 && "text-destructive",
                    )}
                  >
                    {inr0(channel.expectedContribution)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold hover:bg-transparent">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {optimal.totalAllocated.toLocaleString("en-IN")}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {optimal.expectedSales.toFixed(1)}
                </TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums">
                  {inr0(optimal.expectedContribution)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUpIcon className="size-4 text-success" /> vs. split by demand
            </CardTitle>
            <CardDescription>
              The usual rule of thumb: share stock in proportion to demand.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Optimised</span>
              <span className="font-semibold tabular-nums">
                {inr0(optimal.expectedContribution)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Proportional split</span>
              <span className="tabular-nums">{inr0(naive.expectedContribution)}</span>
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <span className="font-medium">Extra expected contribution</span>
              <Badge variant={uplift > 0.5 ? "success" : "secondary"} className="text-sm">
                +{inr0(uplift)}
                {upliftPct !== null && uplift > 0.5 ? ` (${upliftPct.toFixed(1)}%)` : ""}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Proportional plan:{" "}
              {naive.channels.map((channel) => `${channel.name} ${channel.allocated}`).join(" · ")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How it works</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-xs text-muted-foreground">
            <p>
              Demand on each channel is uncertain: modelled as a normal distribution around your
              estimate, with the variability you set.
            </p>
            <p>
              The k-th unit sent to a channel is worth{" "}
              <span className="font-mono text-foreground">p·P(D ≥ k) − h·P(D &lt; k)</span>: its
              contribution if it sells, minus the unsold cost if it doesn&apos;t. This value only
              falls as more units are added.
            </p>
            <p>
              The optimiser gives each unit, one at a time, to the channel where it adds the most,
              and stops when no channel gains. Because every channel&apos;s value curve is concave,
              this greedy rule is provably optimal (checked against brute force in the test suite).
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
