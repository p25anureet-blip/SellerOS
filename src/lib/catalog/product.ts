import { z } from "zod"

/**
 * The universal product model: one source of truth that every marketplace
 * listing is generated from. Money is in rupees, weight in grams, size in cm.
 */

export const CATEGORIES = [
  { value: "grocery", label: "Grocery & Gourmet Foods" },
  { value: "beauty", label: "Beauty & Personal Care" },
  { value: "health", label: "Health & Wellness" },
  { value: "home_kitchen", label: "Home & Kitchen" },
  { value: "fashion", label: "Fashion & Apparel" },
  { value: "footwear", label: "Footwear" },
  { value: "electronics", label: "Electronics & Accessories" },
  { value: "baby", label: "Baby Care" },
  { value: "toys", label: "Toys & Games" },
  { value: "stationery", label: "Books & Stationery" },
  { value: "pet", label: "Pet Supplies" },
  { value: "other", label: "Other" },
] as const

export type CategoryCode = (typeof CATEGORIES)[number]["value"]
export const CATEGORY_CODES = CATEGORIES.map((category) => category.value) as [
  CategoryCode,
  ...CategoryCode[],
]

export function categoryLabel(code: CategoryCode): string {
  return CATEGORIES.find((category) => category.value === code)?.label ?? code
}

/** Categories where ingredients are legally/commercially expected on listings. */
export const INGREDIENT_CATEGORIES: CategoryCode[] = ["grocery", "beauty", "health", "baby", "pet"]

export type ProductAttribute = { name: string; value: string }

export type Product = {
  id: string
  name: string
  brand: string
  category: CategoryCode
  sku: string
  description: string
  quantity: number
  mrp: number
  costPrice: number
  ingredients: string
  manufacturer: string
  weightGrams: number | null
  lengthCm: number | null
  widthCm: number | null
  heightCm: number | null
  /** Extra attributes, e.g. "Flavour: Masala" (often found by the AI agent). */
  attributes: ProductAttribute[]
  source: "manual" | "ai_video"
  createdAt: string
  updatedAt: string
}

export type ProductInput = Omit<Product, "id" | "source" | "createdAt" | "updatedAt">

// ---------------------------------------------------------------------------
// Validation for the product form (values arrive as strings from inputs).
// ---------------------------------------------------------------------------

const text = (label: string, max: number) =>
  z.string().trim().max(max, `${label} is too long (max ${max} characters)`)

const requiredText = (label: string, max: number) => text(label, max).min(1, `${label} is required`)

/** "" → null; otherwise a positive number. */
const optionalPositive = (label: string) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) {
        ctx.addIssue({ code: "custom", message: `${label} must be a positive number` })
        return z.NEVER
      }
      return number
    })

const money = (label: string, { allowZero }: { allowZero: boolean }) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .transform((value, ctx) => {
      const number = Number(value)
      if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0)) {
        ctx.addIssue({ code: "custom", message: `Enter a valid ${label.toLowerCase()} in ₹` })
        return z.NEVER
      }
      return Math.round(number * 100) / 100
    })

export const productFormSchema = z
  .object({
    name: requiredText("Product name", 200),
    brand: requiredText("Brand", 100),
    category: z.enum(CATEGORY_CODES, { error: "Choose a category" }),
    sku: requiredText("SKU", 40).regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      "SKU may contain letters, numbers, dot, dash and underscore",
    ),
    description: text("Description", 2000),
    quantity: z
      .string()
      .trim()
      .min(1, "Quantity is required")
      .transform((value, ctx) => {
        const number = Number(value)
        if (!Number.isInteger(number) || number < 0) {
          ctx.addIssue({ code: "custom", message: "Quantity must be a whole number (0 or more)" })
          return z.NEVER
        }
        return number
      }),
    mrp: money("MRP", { allowZero: false }),
    costPrice: money("Cost price", { allowZero: true }),
    ingredients: text("Ingredients", 2000),
    manufacturer: text("Manufacturer", 300),
    weightGrams: optionalPositive("Weight"),
    lengthCm: optionalPositive("Length"),
    widthCm: optionalPositive("Width"),
    heightCm: optionalPositive("Height"),
    attributes: z
      .array(z.object({ name: z.string().trim(), value: z.string().trim() }))
      .transform((rows) => rows.filter((row) => row.name && row.value)),
  })
  .refine((product) => product.costPrice <= product.mrp, {
    path: ["costPrice"],
    message: "Cost price is higher than MRP: every sale would lose money",
  })

export type ProductFormValues = z.input<typeof productFormSchema>

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  name: "",
  brand: "",
  category: "" as CategoryCode,
  sku: "",
  description: "",
  quantity: "",
  mrp: "",
  costPrice: "",
  ingredients: "",
  manufacturer: "",
  weightGrams: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
  attributes: [],
}

export function productToForm(product: ProductInput): ProductFormValues {
  const optional = (value: number | null) => (value === null ? "" : String(value))
  return {
    name: product.name,
    brand: product.brand,
    category: product.category,
    sku: product.sku,
    description: product.description,
    quantity: String(product.quantity),
    mrp: String(product.mrp),
    costPrice: String(product.costPrice),
    ingredients: product.ingredients,
    manufacturer: product.manufacturer,
    weightGrams: optional(product.weightGrams),
    lengthCm: optional(product.lengthCm),
    widthCm: optional(product.widthCm),
    heightCm: optional(product.heightCm),
    attributes: product.attributes.map((attribute) => ({ ...attribute })),
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
})

export function formatInr(value: number): string {
  return inr.format(value)
}

export function formatWeight(grams: number | null): string {
  if (grams === null) return "—"
  return grams >= 1000 ? `${+(grams / 1000).toFixed(2)} kg` : `${+grams.toFixed(1)} g`
}

export function formatDimensions(product: Pick<Product, "lengthCm" | "widthCm" | "heightCm">) {
  const { lengthCm, widthCm, heightCm } = product
  if (lengthCm === null || widthCm === null || heightCm === null) return "—"
  return `${lengthCm} × ${widthCm} × ${heightCm} cm`
}

export type StockStatus = "out" | "low" | "ok"
export const LOW_STOCK_THRESHOLD = 20

export function stockStatus(quantity: number): StockStatus {
  if (quantity <= 0) return "out"
  return quantity < LOW_STOCK_THRESHOLD ? "low" : "ok"
}

/** Builds a suggested SKU like "IYE-TURMER-4821" from brand and name. */
export function suggestSku(brand: string, name: string): string {
  const part = (value: string, length: number) =>
    value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, length)
  const random = Math.floor(1000 + Math.random() * 9000)
  return [part(brand, 3) || "SKU", part(name, 6) || "ITEM", random].join("-")
}
