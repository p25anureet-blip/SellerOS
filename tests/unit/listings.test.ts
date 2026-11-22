import { describe, expect, it } from "vitest"
import { type Product, productFormSchema } from "@/lib/catalog/product"
import { escapeCsvField, toCsv } from "@/lib/export/csv"
import { generateListing, templateHeaders } from "@/lib/marketplaces/mapping"
import { seedProducts } from "@/lib/store/seed"

const products = seedProducts(new Date("2026-11-22T00:00:00Z"))
const byId = (id: string) => products.find((product) => product.id === id) as Product

describe("CSV", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(escapeCsvField('Brand "A", Ltd\nline')).toBe('"Brand ""A"", Ltd\nline"')
    expect(escapeCsvField(null)).toBe("")
    expect(escapeCsvField(12.5)).toBe("12.5")
  })

  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    expect(escapeCsvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)")
    expect(escapeCsvField("-12")).toBe("-12")
  })

  it("writes a header row and one line per record", () => {
    const csv = toCsv(["a", "b"], [{ a: 1, b: "x,y" }])
    expect(csv).toBe('a,b\r\n1,"x,y"\r\n')
  })
})

describe("marketplace mapping", () => {
  it("maps a complete grocery product for Amazon", () => {
    const listing = generateListing(byId("seed-turmeric"), "amazon_in")
    expect(listing.ready).toBe(true)
    expect(listing.row.feed_product_type).toBe("GROCERY")
    expect(listing.row.item_name).toBe("Iyer Naturals Organic Lakadong Turmeric Powder 200 g")
    expect(listing.row.item_weight).toBe(200)
    expect(listing.row.maximum_retail_price).toBe(249)
    expect(Number(listing.row.standard_price)).toBeLessThanOrEqual(249)
  })

  it("converts units for Flipkart", () => {
    const listing = generateListing(byId("seed-coconut-oil"), "flipkart")
    expect(listing.row["Package Weight (KG)"]).toBe(0.5)
    expect(listing.row["Vertical"]).toBe("Packaged Food")
  })

  it("flags missing required attributes", () => {
    const listing = generateListing(byId("seed-face-wash"), "flipkart")
    expect(listing.ready).toBe(false)
    expect(listing.issues.map((issue) => issue.column)).toContain("Manufacturer Details")
  })

  it("rejects categories a marketplace does not sell", () => {
    const listing = generateListing(byId("seed-kurta"), "blinkit")
    expect(listing.ready).toBe(false)
    expect(listing.issues[0].message).toMatch(/does not sell/)
  })

  it("formats Blinkit titles with pack size", () => {
    expect(generateListing(byId("seed-ragi"), "blinkit").title).toBe(
      "Millet Mantra Sprouted Ragi Flour (1 kg)",
    )
  })

  it("produces a value for every template column", () => {
    for (const code of ["amazon_in", "flipkart", "blinkit"] as const) {
      const listing = generateListing(byId("seed-turmeric"), code)
      expect(Object.keys(listing.row)).toEqual(templateHeaders(code))
    }
  })
})

describe("product form validation", () => {
  const valid = {
    name: "Ragi",
    brand: "MM",
    category: "grocery",
    sku: "MM-1",
    description: "",
    quantity: "10",
    mrp: "100",
    costPrice: "40",
    ingredients: "",
    manufacturer: "",
    weightGrams: "",
    lengthCm: "5",
    widthCm: "",
    heightCm: "",
    attributes: [{ name: "Colour", value: "" }],
  }

  it("parses numbers and blanks", () => {
    const product = productFormSchema.parse(valid)
    expect(product.quantity).toBe(10)
    expect(product.weightGrams).toBeNull()
    expect(product.lengthCm).toBe(5)
    expect(product.attributes).toEqual([])
  })

  it("rejects bad quantities and SKUs", () => {
    const result = productFormSchema.safeParse({ ...valid, quantity: "2.5", sku: "a b" })
    const fields = result.error?.issues.map((issue) => issue.path[0])
    expect(fields).toEqual(expect.arrayContaining(["quantity", "sku"]))
  })

  it("rejects a cost price above MRP", () => {
    const result = productFormSchema.safeParse({ ...valid, costPrice: "150" })
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(["costPrice"])
  })
})
