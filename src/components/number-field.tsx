import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/** Labelled numeric input with an optional unit (₹ or %) and hint. */
export function NumberField({
  id,
  label,
  value,
  onChange,
  unit,
  hint,
  step = "any",
  className,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  unit?: "₹" | "%" | "units"
  hint?: string
  step?: string
  className?: string
}) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {unit === "₹" ? (
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
            ₹
          </span>
        ) : null}
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(unit === "₹" && "pl-7", (unit === "%" || unit === "units") && "pr-14")}
        />
        {unit === "%" || unit === "units" ? (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
