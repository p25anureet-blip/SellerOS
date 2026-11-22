"use client"

import { useMemo, useState } from "react"
import { CircleAlertIcon, CircleCheckIcon, TriangleAlertIcon } from "lucide-react"
import { PageHeader } from "@/components/layout/page-header"
import { NumberField } from "@/components/number-field"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { formatInr } from "@/lib/catalog/product"
import { MARKETPLACES } from "@/lib/marketplaces/catalog"
import {
  DEFAULT_PACKAGING_COST,
  type PricingInput,
  type PricingResult,
  calculatePrice,
  validatePricingInput,
} from "@/lib/pricing/calculator"
import { useAppState } from "@/lib/store/app-store"
import { cn } from "@/lib/utils"

type Fields = Record<keyof PricingInput, string>

const amazon = MARKETPLACES[0]
const DEFAULTS: Fields = {
  manufacturingCost: "96",
  packagingCost: String(DEFAULT_PACKAGING_COST),
  fulfilmentCost: String(amazon.fixedFeeInr + amazon.shippingFeeInr),
  commissionPct: String(amazon.commissionPct),
  mrp: "249",
  desiredMarginPct: "20",
}

const STATUS = {
  on_target: {
    icon: CircleCheckIcon,
    className: "border-success/30 bg-success/10 text-success",
    title: "Target margin achieved",
    body: (r: PricingResult) =>
      `Selling at ${formatInr(r.recommendedPrice)} gives a ${r.contributionMarginPct.toFixed(1)}% contribution margin, ${r.discountFromMrpPct.toFixed(1)}% below MRP.`,
  },
  capped_by_mrp: {
    icon: TriangleAlertIcon,
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    title: "Capped at MRP",
    body: (r: PricingResult) =>
      `Your target needs ${formatInr(r.targetPrice ?? 0)}, above MRP. At MRP you still earn ${formatInr(r.contribution)} per unit (${r.contributionMarginPct.toFixed(1)}%). Reduce costs or choose a lower-fee channel to reach the target.`,
  },
  loss_at_mrp: {
    icon: CircleAlertIcon,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    title: "Loss-making on this channel",
    body: (r: PricingResult) =>
      `Even at MRP each sale loses ${formatInr(Math.abs(r.contribution))}. Break-even needs ${formatInr(r.breakEvenPrice)}.`,
  },
  infeasible: {
    icon: CircleAlertIcon,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    title: "Target is impossible",
    body: () =>
      "Commission plus desired margin is 100% or more of the price, so no price can reach it.",
  },
} as const

export function PricingCalculator() {
  const [fields, setFields] = useState<Fields>(DEFAULTS)
  const [channel, setChannel] = useState<string>(amazon.code)
  const state = useAppState()

  const input = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, Number(value)]),
      ) as PricingInput,
    [fields],
  )
  const errors = Object.values(fields).some((value) => value.trim() === "")
    ? ["Fill in every field"]
    : validatePricingInput(input)
  const result = errors.length ? null : calculatePrice(input)

  const set = (key: keyof Fields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }))

  function applyChannel(code: string) {
    setChannel(code)
    const marketplace = MARKETPLACES.find((candidate) => candidate.code === code)
    if (!marketplace) return
    setFields((current) => ({
      ...current,
      commissionPct: String(marketplace.commissionPct),
      fulfilmentCost: String(marketplace.fixedFeeInr + marketplace.shippingFeeInr),
    }))
  }

  function applyProduct(id: string) {
    const product = state?.products.find((candidate) => candidate.id === id)
    if (!product) return
    setFields((current) => ({
      ...current,
      manufacturingCost: String(product.costPrice),
      mrp: String(product.mrp),
    }))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pricing intelligence"
        description="Find the selling price that hits your target contribution margin after marketplace fees, without breaking MRP."
      />

      <div className="grid items-start gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Inputs</CardTitle>
            <CardDescription>All amounts per unit, in rupees.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="prefill-product">Prefill from product</Label>
                <NativeSelect
                  id="prefill-product"
                  defaultValue=""
                  onChange={(event) => applyProduct(event.target.value)}
                >
                  <option value="">Choose…</option>
                  {state?.products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="prefill-channel">Marketplace fees</Label>
                <NativeSelect
                  id="prefill-channel"
                  value={channel}
                  onChange={(event) => applyChannel(event.target.value)}
                >
                  {MARKETPLACES.map((marketplace) => (
                    <option key={marketplace.code} value={marketplace.code}>
                      {marketplace.name}
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </NativeSelect>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                id="manufacturingCost"
                label="Manufacturing cost"
                unit="₹"
                value={fields.manufacturingCost}
                onChange={set("manufacturingCost")}
              />
              <NumberField
                id="packagingCost"
                label="Packaging cost"
                unit="₹"
                value={fields.packagingCost}
                onChange={set("packagingCost")}
              />
              <NumberField
                id="fulfilmentCost"
                label="Fulfilment cost"
                unit="₹"
                value={fields.fulfilmentCost}
                onChange={(value) => {
                  setChannel("custom")
                  set("fulfilmentCost")(value)
                }}
                hint="Shipping + fixed closing fee"
              />
              <NumberField
                id="commissionPct"
                label="Marketplace commission"
                unit="%"
                value={fields.commissionPct}
                onChange={(value) => {
                  setChannel("custom")
                  set("commissionPct")(value)
                }}
                hint="% of selling price"
              />
              <NumberField
                id="mrp"
                label="MRP"
                unit="₹"
                value={fields.mrp}
                onChange={set("mrp")}
                hint="Legal maximum price"
              />
              <NumberField
                id="desiredMarginPct"
                label="Desired margin"
                unit="%"
                value={fields.desiredMarginPct}
                onChange={set("desiredMarginPct")}
                hint="Contribution as % of price"
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:col-span-3">
          {result ? (
            <Result result={result} input={input} />
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-sm text-destructive">
                {errors.join(" · ")}
              </CardContent>
            </Card>
          )}
          {result ? <ChannelComparison input={input} /> : null}
        </div>
      </div>
    </div>
  )
}

function Result({ result, input }: { result: PricingResult; input: PricingInput }) {
  const status = STATUS[result.status]
  const Icon = status.icon
  const price = result.recommendedPrice
  const segments = [
    { label: "Manufacturing", value: input.manufacturingCost, className: "bg-slate-400" },
    { label: "Packaging", value: input.packagingCost, className: "bg-slate-300 dark:bg-slate-500" },
    { label: "Fulfilment", value: input.fulfilmentCost, className: "bg-sky-400" },
    { label: "Commission", value: result.commissionAmount, className: "bg-amber-400" },
    { label: "Contribution", value: Math.max(0, result.contribution), className: "bg-success" },
  ]
  const scale = Math.max(price, result.totalCost + result.commissionAmount)

  return (
    <Card>
      <CardContent className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Metric
            label="Recommended selling price"
            value={formatInr(price)}
            emphasis
            sub={`MRP ${formatInr(input.mrp)}`}
          />
          <Metric
            label="Contribution margin"
            value={`${result.contributionMarginPct.toFixed(1)}%`}
            sub={`${formatInr(result.contribution)} per unit`}
            tone={result.contribution < 0 ? "bad" : "good"}
          />
          <Metric
            label="Total cost"
            value={formatInr(result.totalCost)}
            sub={`Break-even ${formatInr(result.breakEvenPrice)}`}
          />
        </div>

        <div className={cn("flex gap-3 rounded-lg border p-4 text-sm", status.className)}>
          <Icon className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-medium">{status.title}</p>
            <p className="text-foreground/80">{status.body(result)}</p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Where each rupee of the selling price goes</p>
          <div className="flex h-8 overflow-hidden rounded-md">
            {segments.map((segment) =>
              segment.value > 0 ? (
                <div
                  key={segment.label}
                  className={segment.className}
                  style={{ width: `${(segment.value / scale) * 100}%` }}
                  title={`${segment.label}: ${formatInr(segment.value)}`}
                />
              ) : null,
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {segments.map((segment) => (
              <span key={segment.label} className="flex items-center gap-1.5">
                <span className={cn("size-2.5 rounded-sm", segment.className)} />
                {segment.label} {formatInr(segment.value)}
              </span>
            ))}
          </div>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer font-medium">How this is calculated</summary>
          <div className="mt-2 grid gap-1 rounded-md bg-muted/60 p-3 font-mono text-xs">
            <p>
              Total cost C = manufacturing + packaging + fulfilment = {formatInr(result.totalCost)}
            </p>
            <p>Contribution = P − commission% × P − C</p>
            <p>
              Target price P* = C ÷ (1 − commission% − margin%) ={" "}
              {result.targetPrice === null ? "impossible" : formatInr(result.targetPrice)}
            </p>
            <p>Recommended = min(P* rounded up, MRP) = {formatInr(price)}</p>
            <p>Break-even = C ÷ (1 − commission%) = {formatInr(result.breakEvenPrice)}</p>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}

function Metric({
  label,
  value,
  sub,
  emphasis = false,
  tone,
}: {
  label: string
  value: string
  sub?: string
  emphasis?: boolean
  tone?: "good" | "bad"
}) {
  return (
    <div className={cn("rounded-lg border p-4", emphasis && "border-primary/40 bg-accent/50")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          emphasis && "text-primary",
          tone === "bad" && "text-destructive",
          tone === "good" && "text-success",
        )}
      >
        {value}
      </p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

function ChannelComparison({ input }: { input: PricingInput }) {
  const rows = MARKETPLACES.map((marketplace) => ({
    marketplace,
    result: calculatePrice({
      ...input,
      commissionPct: marketplace.commissionPct,
      fulfilmentCost: marketplace.fixedFeeInr + marketplace.shippingFeeInr,
    }),
  })).sort((a, b) => b.result.contribution - a.result.contribution)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Same product on every channel</CardTitle>
        <CardDescription>
          Your costs, MRP and target margin with each marketplace&apos;s commission and fees (demo
          fee defaults). Sorted by contribution per unit.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-6">Marketplace</TableHead>
              <TableHead className="text-right">Fees</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Contribution</TableHead>
              <TableHead className="pr-6 text-right">Margin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ marketplace, result }, index) => (
              <TableRow key={marketplace.code}>
                <TableCell className="pl-6 font-medium">
                  {marketplace.name}
                  {index === 0 && result.contribution > 0 ? (
                    <Badge variant="success" className="ml-2">
                      Best
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {marketplace.commissionPct}% +{" "}
                  {formatInr(marketplace.fixedFeeInr + marketplace.shippingFeeInr)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatInr(result.recommendedPrice)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    result.contribution < 0 && "text-destructive",
                  )}
                >
                  {formatInr(result.contribution)}
                </TableCell>
                <TableCell className="pr-6 text-right tabular-nums">
                  {result.contributionMarginPct.toFixed(1)}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
