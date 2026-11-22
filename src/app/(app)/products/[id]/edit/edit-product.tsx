"use client"

import { use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PageHeader } from "@/components/layout/page-header"
import { ProductForm } from "@/components/products/product-form"
import { StoreGate } from "@/components/store-gate"
import { Button } from "@/components/ui/button"
import { productToForm } from "@/lib/catalog/product"
import { updateProduct } from "@/lib/store/app-store"

export function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  return (
    <StoreGate>
      {(state) => {
        const product = state.products.find((candidate) => candidate.id === id)
        if (!product) {
          return (
            <div className="py-16 text-center">
              <p className="text-muted-foreground">Product not found.</p>
              <Button variant="outline" className="mt-4" asChild>
                <Link href="/products">Back to products</Link>
              </Button>
            </div>
          )
        }
        return (
          <div className="space-y-6">
            <PageHeader title={`Edit ${product.name}`} description={`SKU ${product.sku}`} />
            <ProductForm
              key={product.id}
              initial={productToForm(product)}
              productId={product.id}
              submitLabel="Save changes"
              onCancel={() => router.push(`/products/${product.id}`)}
              onSubmit={(input) => {
                updateProduct(product.id, input)
                toast.success("Changes saved")
                router.push(`/products/${product.id}`)
              }}
            />
          </div>
        )
      }}
    </StoreGate>
  )
}
