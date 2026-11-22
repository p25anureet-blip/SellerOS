"use client"

import { useState } from "react"
import { Loader2Icon, PlusIcon, Trash2Icon, WandSparklesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import {
  CATEGORIES,
  type ProductFormValues,
  type ProductInput,
  formatInr,
  productFormSchema,
  suggestSku,
} from "@/lib/catalog/product"
import { isSkuTaken } from "@/lib/store/app-store"
import { cn } from "@/lib/utils"

type FieldName = Exclude<keyof ProductFormValues, "attributes">
type Errors = Partial<Record<string, string>>

type ProductFormProps = {
  initial: ProductFormValues
  /** Set when editing, so the product's own SKU is not reported as a duplicate. */
  productId?: string
  submitLabel: string
  onSubmit: (input: ProductInput) => void | Promise<void>
  onCancel?: () => void
  /** Extra content shown under a field, e.g. the AI's confidence and evidence. */
  fieldNotes?: Partial<Record<FieldName, React.ReactNode>>
}

export function ProductForm({
  initial,
  productId,
  submitLabel,
  onSubmit,
  onCancel,
  fieldNotes = {},
}: ProductFormProps) {
  const [values, setValues] = useState<ProductFormValues>(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)

  const set =
    (name: FieldName) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const value = event.target.value
      setValues((current) => ({ ...current, [name]: value }))
      if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }))
    }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = productFormSchema.safeParse(values)
    const nextErrors: Errors = {}
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0])
        nextErrors[key] ??= issue.message
      }
    } else if (isSkuTaken(parsed.data.sku, productId)) {
      nextErrors.sku = "Another product already uses this SKU"
    }
    setErrors(nextErrors)
    if (!parsed.success || Object.keys(nextErrors).length) {
      document.getElementById(`product-${Object.keys(nextErrors)[0]}`)?.focus()
      return
    }
    setSaving(true)
    try {
      await onSubmit(parsed.data)
    } finally {
      setSaving(false)
    }
  }

  const field = (
    name: FieldName,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <Field name={name} label={label} error={errors[name]} note={fieldNotes[name]}>
      <Input
        id={`product-${name}`}
        value={values[name]}
        onChange={set(name)}
        aria-invalid={errors[name] ? true : undefined}
        {...props}
      />
    </Field>
  )

  const mrp = Number(values.mrp)
  const cost = Number(values.costPrice)
  const grossMargin =
    mrp > 0 && cost >= 0 && values.costPrice !== "" ? ((mrp - cost) / mrp) * 100 : null

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Basic information</CardTitle>
          <CardDescription>How the product is identified across every channel.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          {field("name", "Product name", {
            placeholder: "e.g. Organic Turmeric Powder",
            className: "",
          })}
          {field("brand", "Brand", { placeholder: "e.g. Iyer Naturals" })}
          <Field
            name="category"
            label="Category"
            error={errors.category}
            note={fieldNotes.category}
          >
            <NativeSelect
              id="product-category"
              value={values.category}
              onChange={set("category")}
              aria-invalid={errors.category ? true : undefined}
            >
              <option value="" disabled>
                Choose a category…
              </option>
              {CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field name="sku" label="SKU" error={errors.sku} note={fieldNotes.sku}>
            <div className="flex gap-2">
              <Input
                id="product-sku"
                value={values.sku}
                onChange={set("sku")}
                placeholder="e.g. IYN-TURM-200"
                aria-invalid={errors.sku ? true : undefined}
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Suggest a SKU from brand and name"
                aria-label="Suggest a SKU"
                onClick={() =>
                  setValues((current) => ({
                    ...current,
                    sku: suggestSku(current.brand, current.name),
                  }))
                }
              >
                <WandSparklesIcon />
              </Button>
            </div>
          </Field>
          <Field
            name="description"
            label="Description"
            error={errors.description}
            note={fieldNotes.description}
            className="sm:col-span-2"
          >
            <Textarea
              id="product-description"
              value={values.description}
              onChange={set("description")}
              rows={3}
              placeholder="What it is, who it's for and why it's better."
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pricing &amp; stock</CardTitle>
          <CardDescription>Selling prices per channel are calculated from these.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-3">
          {field("mrp", "MRP (₹)", { inputMode: "decimal", placeholder: "e.g. 249" })}
          {field("costPrice", "Cost price (₹)", { inputMode: "decimal", placeholder: "e.g. 96" })}
          {field("quantity", "Quantity in stock", {
            inputMode: "numeric",
            placeholder: "e.g. 100",
          })}
          {grossMargin !== null && Number.isFinite(grossMargin) ? (
            <p className="text-sm text-muted-foreground sm:col-span-3">
              Gross margin at MRP:{" "}
              <span
                className={cn(
                  "font-medium",
                  grossMargin < 0 ? "text-destructive" : "text-foreground",
                )}
              >
                {grossMargin.toFixed(1)}% ({formatInr(mrp - cost)} per unit)
              </span>{" "}
              before marketplace fees.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Composition &amp; compliance</CardTitle>
          <CardDescription>
            Required on food, beauty and health listings under Indian labelling rules.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field
            name="ingredients"
            label="Ingredients"
            error={errors.ingredients}
            note={fieldNotes.ingredients}
          >
            <Textarea
              id="product-ingredients"
              value={values.ingredients}
              onChange={set("ingredients")}
              rows={3}
              placeholder="Comma-separated, as printed on the pack"
            />
          </Field>
          <Field
            name="manufacturer"
            label="Manufacturer"
            error={errors.manufacturer}
            note={fieldNotes.manufacturer}
          >
            <Textarea
              id="product-manufacturer"
              value={values.manufacturer}
              onChange={set("manufacturer")}
              rows={3}
              placeholder="Name and address"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weight &amp; dimensions</CardTitle>
          <CardDescription>
            Packed size. Used for shipping fees and marketplace templates.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-4">
          {field("weightGrams", "Weight (g)", { inputMode: "decimal", placeholder: "e.g. 200" })}
          {field("lengthCm", "Length (cm)", { inputMode: "decimal" })}
          {field("widthCm", "Width (cm)", { inputMode: "decimal" })}
          {field("heightCm", "Height (cm)", { inputMode: "decimal" })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Additional attributes</CardTitle>
          <CardDescription>
            Anything else buyers care about: colour, flavour, size, material…
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {values.attributes.map((attribute, index) => (
            <div key={index} className="flex gap-2">
              <Input
                aria-label={`Attribute ${index + 1} name`}
                placeholder="Name"
                value={attribute.name}
                className="max-w-56"
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    attributes: current.attributes.map((row, i) =>
                      i === index ? { ...row, name: event.target.value } : row,
                    ),
                  }))
                }
              />
              <Input
                aria-label={`Attribute ${index + 1} value`}
                placeholder="Value"
                value={attribute.value}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    attributes: current.attributes.map((row, i) =>
                      i === index ? { ...row, value: event.target.value } : row,
                    ),
                  }))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove attribute"
                onClick={() =>
                  setValues((current) => ({
                    ...current,
                    attributes: current.attributes.filter((_, i) => i !== index),
                  }))
                }
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  attributes: [...current.attributes, { name: "", value: "" }],
                }))
              }
            >
              <PlusIcon /> Add attribute
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 flex justify-end gap-2 border-t bg-background/90 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
        {Object.values(errors).some(Boolean) ? (
          <p role="alert" className="mr-auto self-center text-sm text-destructive">
            Please fix the highlighted fields.
          </p>
        ) : null}
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

function Field({
  name,
  label,
  error,
  note,
  className,
  children,
}: {
  name: string
  label: string
  error?: string
  note?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={`product-${name}`}>{label}</Label>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
    </div>
  )
}
