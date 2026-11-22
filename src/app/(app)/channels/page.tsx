import type { Metadata } from "next"
import { Suspense } from "react"
import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getCurrentUser } from "@/lib/auth"
import { formatInr } from "@/lib/catalog/product"
import { DEMO_MODE } from "@/lib/demo"
import { LISTING_MARKETPLACE_CODES, MARKETPLACES } from "@/lib/marketplaces/catalog"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Channels" }

export default function ChannelsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Channels"
        description="The marketplaces SellerOS prepares listings for, and the fees used in pricing."
      />
      <Card>
        <CardHeader>
          <CardTitle>Marketplaces</CardTitle>
          <CardDescription>
            Fees are illustrative demo defaults, not official fee schedules. Publishing is
            simulated; CSV exports are real for Amazon India, Flipkart and Blinkit.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Suspense fallback={<Skeleton className="mx-6 h-64" />}>
            <ChannelTable />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  )
}

type ChannelRow = {
  code: string
  name: string
  channel_type: string
  commission_pct: number
  fixed_fee_inr: number
  shipping_fee_inr: number
}

/** Demo mode uses the built-in copy; otherwise the marketplaces table in Supabase. */
async function loadChannels(): Promise<{ data: ChannelRow[]; source: string; error?: string }> {
  if (DEMO_MODE) {
    return {
      source: "Built-in reference data (demo mode)",
      data: MARKETPLACES.map((m) => ({
        code: m.code,
        name: m.name,
        channel_type: m.channelType,
        commission_pct: m.commissionPct,
        fixed_fee_inr: m.fixedFeeInr,
        shipping_fee_inr: m.shippingFeeInr,
      })),
    }
  }
  await getCurrentUser()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("marketplaces")
    .select("code, name, channel_type, commission_pct, fixed_fee_inr, shipping_fee_inr")
    .eq("is_active", true)
    .order("channel_type")
    .order("name")
  return { data: data ?? [], source: "Supabase database", error: error?.message }
}

async function ChannelTable() {
  const { data, source, error } = await loadChannels()
  if (error)
    return <p className="px-6 text-sm text-destructive">Could not load channels: {error}</p>
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-6">Marketplace</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Commission</TableHead>
            <TableHead className="text-right">Fixed fee</TableHead>
            <TableHead className="text-right">Shipping</TableHead>
            <TableHead className="pr-6">Integration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((channel) => (
            <TableRow key={channel.code}>
              <TableCell className="pl-6 font-medium">{channel.name}</TableCell>
              <TableCell>
                <Badge
                  variant={channel.channel_type === "quick_commerce" ? "default" : "secondary"}
                >
                  {channel.channel_type === "quick_commerce" ? "Quick commerce" : "E-commerce"}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{channel.commission_pct}%</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatInr(channel.fixed_fee_inr)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatInr(channel.shipping_fee_inr)}
              </TableCell>
              <TableCell className="pr-6 text-sm text-muted-foreground">
                {(LISTING_MARKETPLACE_CODES as readonly string[]).includes(channel.code)
                  ? "CSV export + simulated publish"
                  : "Pricing & allocation only"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="px-6 pt-4 text-xs text-muted-foreground">Source: {source}</p>
    </>
  )
}
