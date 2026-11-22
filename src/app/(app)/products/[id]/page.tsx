import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ProductDetail } from "./product-detail"

export default function ProductPage({ params }: PageProps<"/products/[id]">) {
  return (
    // The id comes from the URL at request time, so it streams in behind Suspense.
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ProductDetail params={params} />
    </Suspense>
  )
}
