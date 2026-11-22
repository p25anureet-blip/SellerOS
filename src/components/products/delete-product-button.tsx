"use client"

import { Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { deleteProduct } from "@/lib/store/app-store"

export function DeleteProductButton({
  productId,
  productName,
  variant = "icon",
  onDeleted,
}: {
  productId: string
  productName: string
  variant?: "icon" | "button"
  onDeleted?: () => void
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {variant === "icon" ? (
          <Button variant="ghost" size="icon" aria-label={`Delete ${productName}`}>
            <Trash2Icon className="text-muted-foreground" />
          </Button>
        ) : (
          <Button variant="outline">
            <Trash2Icon /> Delete
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Delete this product?</DialogTitle>
        <DialogDescription>
          <strong className="text-foreground">{productName}</strong> and its marketplace listings
          will be removed. This cannot be undone.
        </DialogDescription>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              variant="destructive"
              onClick={() => {
                deleteProduct(productId)
                toast.success(`Deleted ${productName}`)
                onDeleted?.()
              }}
            >
              Delete product
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
