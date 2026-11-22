"use client"

import { DatabaseIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"
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
import { clearAllData, resetDemoData, useAppState } from "@/lib/store/app-store"

export function DemoData() {
  const state = useAppState()
  return (
    <div className="grid gap-4 text-sm">
      <p className="flex items-center gap-2 text-muted-foreground">
        <DatabaseIcon className="size-4" />
        {state
          ? `${state.products.length} products and ${state.listings.length} listings saved in this browser.`
          : "Loading…"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Confirm
          title="Reset to the sample catalogue?"
          description="Your products and listings in this browser are replaced by the 6 sample products."
          confirm="Reset demo data"
          onConfirm={() => {
            resetDemoData()
            toast.success("Demo data reset")
          }}
        >
          <Button variant="outline">
            <RotateCcwIcon /> Reset sample data
          </Button>
        </Confirm>
        <Confirm
          title="Delete all data?"
          description="Every product and listing in this browser is removed. This cannot be undone."
          confirm="Delete everything"
          onConfirm={() => {
            clearAllData()
            toast.success("All data deleted")
          }}
        >
          <Button variant="outline">
            <Trash2Icon /> Start empty
          </Button>
        </Confirm>
      </div>
    </div>
  )
}

function Confirm({
  title,
  description,
  confirm,
  onConfirm,
  children,
}: {
  title: string
  description: string
  confirm: string
  onConfirm: () => void
  children: React.ReactNode
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive" onClick={onConfirm}>
              {confirm}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
