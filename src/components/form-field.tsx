import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type FormFieldProps = React.ComponentProps<typeof Input> & {
  name: string
  label: string
  hint?: string
  errors?: string[]
}

/** Label + input + hint/error text, wired together for screen readers. */
export function FormField({ name, label, hint, errors, className, ...inputProps }: FormFieldProps) {
  const id = `field-${name}`
  const describedBy = errors?.length ? `${id}-error` : hint ? `${id}-hint` : undefined

  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {errors?.length ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {errors[0]}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
