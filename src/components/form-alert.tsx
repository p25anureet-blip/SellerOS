import { CircleAlertIcon, CircleCheckIcon } from "lucide-react"
import type { FormState } from "@/lib/validation/form-state"
import { cn } from "@/lib/utils"

/** The form-level message returned by a Server Action, if any. */
export function FormAlert({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null
  const isError = state.status === "error"
  const Icon = isError ? CircleAlertIcon : CircleCheckIcon

  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm",
        isError
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-success/30 bg-success/10 text-success",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{state.message}</span>
    </div>
  )
}
