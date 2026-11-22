"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PageHeader } from "@/components/layout/page-header"
import { ProductForm } from "@/components/products/product-form"
import { EMPTY_PRODUCT_FORM } from "@/lib/catalog/product"
import { addProduct } from "@/lib/store/app-store"

export default function NewProductPage() {
  const router = useRouter()
  return (
    <div className="space-y-6">
      <PageHeader title="Add product" description="Create a product in your central catalogue." />
      <ProductForm
        initial={EMPTY_PRODUCT_FORM}
        submitLabel="Save product"
        onCancel={() => router.push("/products")}
        onSubmit={(input) => {
          const product = addProduct(input)
          toast.success(`Added ${product.name}`)
          router.push(`/products/${product.id}`)
        }}
      />
    </div>
  )
}
