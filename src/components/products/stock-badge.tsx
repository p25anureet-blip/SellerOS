import { Badge } from "@/components/ui/badge"
import { stockStatus } from "@/lib/catalog/product"

export function StockBadge({ quantity }: { quantity: number }) {
  const status = stockStatus(quantity)
  if (status === "out") return <Badge variant="destructive">Out of stock</Badge>
  if (status === "low")
    return (
      <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400">
        Low · {quantity}
      </Badge>
    )
  return <Badge variant="success">{quantity.toLocaleString("en-IN")} in stock</Badge>
}
