import { type ProductFormValues, suggestSku } from "@/lib/catalog/product"
import type { ExtractionField, ProductExtraction } from "./extraction-schema"

/** Which product-form field each extracted attribute fills. */
export const FIELD_FOR_EXTRACTION: Partial<Record<ExtractionField, keyof ProductFormValues>> = {
  product_name: "name",
  brand: "brand",
  category: "category",
  description: "description",
  ingredients: "ingredients",
  manufacturer: "manufacturer",
  net_weight_grams: "weightGrams",
  mrp_inr: "mrp",
  length_cm: "lengthCm",
  width_cm: "widthCm",
  height_cm: "heightCm",
}

const asText = (value: string | number | null) => (value === null ? "" : String(value))
const roundNumber = (value: number | null) =>
  value === null ? "" : String(Math.round(value * 100) / 100)

/**
 * Pre-fills the review form. Stock quantity and cost price cannot be seen in a
 * video, so they are left blank for the seller to enter.
 */
export function extractionToForm(extraction: ProductExtraction): ProductFormValues {
  const name = asText(extraction.product_name.value)
  const brand = asText(extraction.brand.value)
  const attributes = extraction.additional_attributes
    .filter((attribute) => attribute.name.trim() && attribute.value.trim())
    .map(({ name: attributeName, value }) => ({ name: attributeName, value }))
  if (extraction.color.value) attributes.unshift({ name: "Colour", value: extraction.color.value })

  return {
    name,
    brand,
    category: (extraction.category.value ?? "") as ProductFormValues["category"],
    sku: name || brand ? suggestSku(brand, name) : "",
    description: asText(extraction.description.value),
    quantity: "",
    mrp: roundNumber(extraction.mrp_inr.value),
    costPrice: "",
    ingredients: asText(extraction.ingredients.value),
    manufacturer: asText(extraction.manufacturer.value),
    weightGrams: roundNumber(extraction.net_weight_grams.value),
    lengthCm: roundNumber(extraction.length_cm.value),
    widthCm: roundNumber(extraction.width_cm.value),
    heightCm: roundNumber(extraction.height_cm.value),
    attributes,
  }
}

export type ConfidenceLevel = "high" | "medium" | "low" | "missing"

export function confidenceLevel(value: unknown, confidence: number): ConfidenceLevel {
  if (value === null || value === "") return "missing"
  if (confidence >= 0.8) return "high"
  if (confidence >= 0.5) return "medium"
  return "low"
}

/** How many core attributes the AI found, for the summary banner. */
export function extractionCoverage(extraction: ProductExtraction) {
  const fields = Object.keys(FIELD_FOR_EXTRACTION) as ExtractionField[]
  const found = fields.filter((field) => extraction[field].value !== null).length
  return { found, total: fields.length }
}
