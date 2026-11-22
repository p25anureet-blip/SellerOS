"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { type AppState, useAppState } from "@/lib/store/app-store"

/** Renders children once the browser store has loaded; a skeleton until then. */
export function StoreGate({ children }: { children: (state: AppState) => React.ReactNode }) {
  const state = useAppState()
  if (!state) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  return <>{children(state)}</>
}
