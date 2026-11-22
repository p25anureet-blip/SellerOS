import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { EditProduct } from "./edit-product"

export default function EditProductPage({ params }: PageProps<"/products/[id]/edit">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <EditProduct params={params} />
    </Suspense>
  )
}
