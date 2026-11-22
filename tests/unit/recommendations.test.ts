import { describe, expect, it } from "vitest"
import { extractionSchema } from "@/lib/ai/extraction-schema"
import { confidenceLevel, extractionToForm } from "@/lib/ai/extraction-to-product"
import { productFormSchema } from "@/lib/catalog/product"
import { generateRecommendations } from "@/lib/insights/recommendations"
import { seedProducts } from "@/lib/store/seed"

describe("recommendations", () => {
  const products = seedProducts(new Date("2026-11-22T00:00:00Z"))
  const all = generateRecommendations(products, [], 100)

  it("flags out-of-stock and low-stock products", () => {
    expect(all.some((r) => r.id === "out-seed-steel-bottle" && r.severity === "high")).toBe(true)
    expect(all.some((r) => r.id === "low-seed-ragi")).toBe(true)
  })

  it("flags channels where a product loses money (ragi on Amazon)", () => {
    const loss = all.find((r) => r.id === "loss-seed-ragi-amazon_in")
    expect(loss?.title).toMatch(/loses ₹/)
  })

  it("names missing data that blocks listings", () => {
    expect(all.find((r) => r.id === "data-seed-face-wash")?.title).toMatch(/manufacturer/)
  })

  it("orders by severity and respects the limit", () => {
    const top = generateRecommendations(products, [], 3)
    expect(top).toHaveLength(3)
    expect(top.every((r) => r.severity === "high")).toBe(true)
  })

  it("does not suggest listing a product that is already published", () => {
    const published = generateRecommendations(
      products,
      [{ productId: "seed-turmeric", marketplace: "amazon_in", status: "published" }],
      100,
    )
    expect(published.some((r) => r.id === "list-seed-turmeric")).toBe(false)
  })
})

describe("AI extraction → product form", () => {
  const field = <T>(value: T, confidence = 0.9) => ({ value, confidence, evidence: "00:03 label" })
  const extraction = extractionSchema.parse({
    product_name: field("Masala Chai Tea"),
    brand: field("Chaiwala Co"),
    category: field("grocery"),
    description: field("Strong Assam tea with spices."),
    ingredients: field("Black tea, cardamom, ginger"),
    manufacturer: field(null, 0),
    net_weight_grams: field(250),
    mrp_inr: field(299),
    length_cm: field(10, 0.4),
    width_cm: field(6, 0.4),
    height_cm: field(16, 0.4),
    color: field("Red"),
    additional_attributes: [
      { name: "Shelf life", value: "12 months", confidence: 0.8, evidence: "00:09" },
    ],
    video_summary: "A red tea box rotated on a table.",
    quality_warnings: [],
  })

  it("pre-fills the form and leaves stock and cost for the seller", () => {
    const form = extractionToForm(extraction)
    expect(form.name).toBe("Masala Chai Tea")
    expect(form.mrp).toBe("299")
    expect(form.weightGrams).toBe("250")
    expect(form.manufacturer).toBe("")
    expect(form.quantity).toBe("")
    expect(form.costPrice).toBe("")
    expect(form.sku).toMatch(/^CHA-MASALA-\d{4}$/)
    expect(form.attributes).toEqual([
      { name: "Colour", value: "Red" },
      { name: "Shelf life", value: "12 months" },
    ])
  })

  it("becomes a valid product once the seller adds stock and cost", () => {
    const form = { ...extractionToForm(extraction), quantity: "50", costPrice: "120" }
    expect(productFormSchema.safeParse(form).success).toBe(true)
  })

  it("rejects JSON that does not follow the schema", () => {
    expect(extractionSchema.safeParse({ product_name: "x" }).success).toBe(false)
    expect(
      extractionSchema.safeParse({ ...extraction, category: field("jewellery") }).success,
    ).toBe(false)
  })

  it("labels confidence levels", () => {
    expect(confidenceLevel("x", 0.9)).toBe("high")
    expect(confidenceLevel("x", 0.6)).toBe("medium")
    expect(confidenceLevel("x", 0.2)).toBe("low")
    expect(confidenceLevel(null, 0)).toBe("missing")
  })
})
