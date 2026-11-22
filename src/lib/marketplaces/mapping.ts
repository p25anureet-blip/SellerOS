import {
  type CategoryCode,
  INGREDIENT_CATEGORIES,
  type Product,
  categoryLabel,
  formatWeight,
} from "@/lib/catalog/product"
import type { CsvValue } from "@/lib/export/csv"
import { type PricingResult, priceForChannel } from "@/lib/pricing/calculator"
import { type ListingMarketplaceCode, getMarketplace } from "./catalog"

/**
 * Maps the universal product model onto each marketplace's upload template.
 *
 * Each template is a list of columns. A column knows which universal attribute
 * it comes from (shown in the "attribute mapping" table), how to transform it,
 * and whether the marketplace requires it. Column names follow the style of each
 * marketplace's bulk-upload sheet; publishing itself is simulated.
 */

export type ListingContext = { product: Product; pricing: PricingResult }

export type TemplateColumn = {
  header: string
  /** Universal attribute(s) this column is built from, for the mapping table. */
  source: string
  required?: boolean | ((product: Product) => boolean)
  maxLength?: number
  value: (context: ListingContext) => CsvValue
}

export type MarketplaceTemplate = {
  code: ListingMarketplaceCode
  name: string
  fileName: string
  /** Universal category → marketplace category/product type. null = not sold there. */
  categoryMap: Record<CategoryCode, string | null>
  titleRule: string
  buildTitle: (product: Product) => string
  columns: TemplateColumn[]
}

const kg = (grams: number | null) =>
  grams === null ? null : Math.round((grams / 1000) * 1000) / 1000
const needsIngredients = (product: Product) => INGREDIENT_CATEGORIES.includes(product.category)

/** Short selling points generated from structured attributes (no AI needed). */
export function bulletPoints(product: Product): string[] {
  const bullets: string[] = []
  if (product.description) {
    const firstSentence = product.description.split(/(?<=[.!?])\s+/)[0]
    bullets.push(firstSentence)
  }
  for (const attribute of product.attributes.slice(0, 3)) {
    bullets.push(`${attribute.name}: ${attribute.value}`)
  }
  if (product.weightGrams !== null)
    bullets.push(`Net quantity: ${formatWeight(product.weightGrams)}`)
  if (product.ingredients) bullets.push(`Ingredients: ${product.ingredients}`)
  if (product.manufacturer) bullets.push(`Manufactured by ${product.manufacturer}`)
  return bullets.slice(0, 5)
}

/** Net quantity belongs in titles of consumables (e.g. "200 g"), not of bottles or kurtas. */
function sizeSuffix(product: Product): string {
  if (product.weightGrams === null || !needsIngredients(product)) return ""
  return formatWeight(product.weightGrams)
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

export const TEMPLATES: Record<ListingMarketplaceCode, MarketplaceTemplate> = {
  amazon_in: {
    code: "amazon_in",
    name: "Amazon India",
    fileName: "amazon-in-flat-file",
    titleRule: "Brand + product name + net quantity, max 200 characters",
    buildTitle: (product) =>
      truncate([product.brand, product.name, sizeSuffix(product)].filter(Boolean).join(" "), 200),
    categoryMap: {
      grocery: "GROCERY",
      beauty: "BEAUTY",
      health: "HEALTH_PERSONAL_CARE",
      home_kitchen: "KITCHEN",
      fashion: "APPAREL",
      footwear: "SHOES",
      electronics: "CONSUMER_ELECTRONICS",
      baby: "BABY_PRODUCT",
      toys: "TOYS_AND_GAMES",
      stationery: "OFFICE_PRODUCTS",
      pet: "PET_SUPPLIES",
      other: "HOME",
    },
    columns: [
      {
        header: "feed_product_type",
        source: "category",
        required: true,
        value: ({ product }) => TEMPLATES.amazon_in.categoryMap[product.category],
      },
      { header: "item_sku", source: "sku", required: true, value: ({ product }) => product.sku },
      {
        header: "brand_name",
        source: "brand",
        required: true,
        maxLength: 50,
        value: ({ product }) => product.brand,
      },
      {
        header: "item_name",
        source: "brand + name + weight",
        required: true,
        maxLength: 200,
        value: ({ product }) => TEMPLATES.amazon_in.buildTitle(product),
      },
      {
        header: "manufacturer",
        source: "manufacturer",
        required: true,
        value: ({ product }) => product.manufacturer,
      },
      {
        header: "product_description",
        source: "description",
        maxLength: 2000,
        value: ({ product }) => product.description,
      },
      ...[0, 1, 2, 3, 4].map((index) => ({
        header: `bullet_point${index + 1}`,
        source: "description, attributes, weight",
        maxLength: 500,
        value: ({ product }: ListingContext) => bulletPoints(product)[index] ?? null,
      })),
      {
        header: "standard_price",
        source: "pricing engine",
        required: true,
        value: ({ pricing }) => pricing.recommendedPrice,
      },
      {
        header: "maximum_retail_price",
        source: "mrp",
        required: true,
        value: ({ product }) => product.mrp,
      },
      {
        header: "quantity",
        source: "quantity",
        required: true,
        value: ({ product }) => product.quantity,
      },
      {
        header: "item_weight",
        source: "weightGrams",
        required: true,
        value: ({ product }) => product.weightGrams,
      },
      { header: "item_weight_unit_of_measure", source: "(constant)", value: () => "GR" },
      {
        header: "item_length",
        source: "lengthCm",
        required: true,
        value: ({ product }) => product.lengthCm,
      },
      {
        header: "item_width",
        source: "widthCm",
        required: true,
        value: ({ product }) => product.widthCm,
      },
      {
        header: "item_height",
        source: "heightCm",
        required: true,
        value: ({ product }) => product.heightCm,
      },
      { header: "item_dimensions_unit_of_measure", source: "(constant)", value: () => "CM" },
      {
        header: "ingredients",
        source: "ingredients",
        required: needsIngredients,
        maxLength: 1000,
        value: ({ product }) => product.ingredients,
      },
      { header: "country_of_origin", source: "(constant)", value: () => "India" },
      { header: "condition_type", source: "(constant)", value: () => "New" },
    ],
  },

  flipkart: {
    code: "flipkart",
    name: "Flipkart",
    fileName: "flipkart-listing-sheet",
    titleRule: "Brand + product name, max 150 characters",
    buildTitle: (product) => truncate(`${product.brand} ${product.name}`, 150),
    categoryMap: {
      grocery: "Packaged Food",
      beauty: "Beauty and Grooming",
      health: "Health Care",
      home_kitchen: "Kitchen, Cookware & Serveware",
      fashion: "Clothing and Accessories",
      footwear: "Footwear",
      electronics: "Mobile & Computer Accessories",
      baby: "Baby Care",
      toys: "Toys",
      stationery: "Stationery & Office Supplies",
      pet: "Pet Supplies",
      other: "Home Improvement",
    },
    columns: [
      {
        header: "Seller SKU ID",
        source: "sku",
        required: true,
        value: ({ product }) => product.sku,
      },
      {
        header: "Vertical",
        source: "category",
        required: true,
        value: ({ product }) => TEMPLATES.flipkart.categoryMap[product.category],
      },
      { header: "Brand", source: "brand", required: true, value: ({ product }) => product.brand },
      {
        header: "Product Title",
        source: "brand + name",
        required: true,
        maxLength: 150,
        value: ({ product }) => TEMPLATES.flipkart.buildTitle(product),
      },
      { header: "Listing Status", source: "(constant)", value: () => "ACTIVE" },
      { header: "MRP (INR)", source: "mrp", required: true, value: ({ product }) => product.mrp },
      {
        header: "Your Selling Price (INR)",
        source: "pricing engine",
        required: true,
        value: ({ pricing }) => pricing.recommendedPrice,
      },
      { header: "Fulfillment By", source: "(constant)", value: () => "Seller" },
      { header: "Procurement SLA (Day)", source: "(constant)", value: () => 2 },
      {
        header: "Stock",
        source: "quantity",
        required: true,
        value: ({ product }) => product.quantity,
      },
      {
        header: "Package Length (CM)",
        source: "lengthCm",
        required: true,
        value: ({ product }) => product.lengthCm,
      },
      {
        header: "Package Breadth (CM)",
        source: "widthCm",
        required: true,
        value: ({ product }) => product.widthCm,
      },
      {
        header: "Package Height (CM)",
        source: "heightCm",
        required: true,
        value: ({ product }) => product.heightCm,
      },
      {
        header: "Package Weight (KG)",
        source: "weightGrams ÷ 1000",
        required: true,
        value: ({ product }) => kg(product.weightGrams),
      },
      {
        header: "Description",
        source: "description",
        required: true,
        maxLength: 5000,
        value: ({ product }) => product.description,
      },
      {
        header: "Key Features",
        source: "description, attributes, weight",
        value: ({ product }) => bulletPoints(product).join(" | "),
      },
      {
        header: "Manufacturer Details",
        source: "manufacturer",
        required: true,
        value: ({ product }) => product.manufacturer,
      },
      {
        header: "Ingredients",
        source: "ingredients",
        required: needsIngredients,
        value: ({ product }) => product.ingredients,
      },
      { header: "Country Of Origin", source: "(constant)", value: () => "India" },
    ],
  },

  blinkit: {
    code: "blinkit",
    name: "Blinkit",
    fileName: "blinkit-catalogue",
    titleRule: "Brand + product name + pack size, max 100 characters",
    buildTitle: (product) => {
      const size = sizeSuffix(product)
      return truncate(`${product.brand} ${product.name}${size ? ` (${size})` : ""}`, 100)
    },
    // Quick commerce sells everyday essentials: no apparel or footwear.
    categoryMap: {
      grocery: "Grocery & Staples",
      beauty: "Personal Care",
      health: "Pharma & Wellness",
      home_kitchen: "Home & Kitchen Needs",
      fashion: null,
      footwear: null,
      electronics: "Electronics & Electricals",
      baby: "Baby Care",
      toys: "Toys & Games",
      stationery: "Stationery Needs",
      pet: "Pet Care",
      other: null,
    },
    columns: [
      { header: "Seller SKU", source: "sku", required: true, value: ({ product }) => product.sku },
      {
        header: "Item Name",
        source: "brand + name + weight",
        required: true,
        maxLength: 100,
        value: ({ product }) => TEMPLATES.blinkit.buildTitle(product),
      },
      { header: "Brand", source: "brand", required: true, value: ({ product }) => product.brand },
      {
        header: "Category",
        source: "category",
        required: true,
        value: ({ product }) => TEMPLATES.blinkit.categoryMap[product.category],
      },
      {
        header: "Net Weight",
        source: "weightGrams",
        required: true,
        value: ({ product }) =>
          product.weightGrams === null ? null : formatWeight(product.weightGrams),
      },
      { header: "MRP", source: "mrp", required: true, value: ({ product }) => product.mrp },
      {
        header: "Selling Price",
        source: "pricing engine",
        required: true,
        value: ({ pricing }) => pricing.recommendedPrice,
      },
      {
        header: "Inventory",
        source: "quantity",
        required: true,
        value: ({ product }) => product.quantity,
      },
      {
        header: "Ingredients",
        source: "ingredients",
        required: needsIngredients,
        value: ({ product }) => product.ingredients,
      },
      {
        header: "Manufacturer Name & Address",
        source: "manufacturer",
        required: true,
        value: ({ product }) => product.manufacturer,
      },
      {
        header: "Product Description",
        source: "description",
        maxLength: 1000,
        value: ({ product }) => product.description,
      },
    ],
  },
}

export type ListingIssue = { column: string; message: string }

export type GeneratedListing = {
  marketplace: ListingMarketplaceCode
  productId: string
  title: string
  pricing: PricingResult
  row: Record<string, CsvValue>
  issues: ListingIssue[]
  ready: boolean
}

const isEmpty = (value: CsvValue) => value === null || value === undefined || value === ""

/** Generates one marketplace row for a product and checks it against the template's rules. */
export function generateListing(product: Product, code: ListingMarketplaceCode): GeneratedListing {
  const template = TEMPLATES[code]
  const pricing = priceForChannel(product, getMarketplace(code))
  const context = { product, pricing }
  const row: Record<string, CsvValue> = {}
  const issues: ListingIssue[] = []

  const sellsCategory = template.categoryMap[product.category] !== null
  if (!sellsCategory) {
    issues.push({
      column: "Category",
      message: `${template.name} does not sell "${categoryLabel(product.category)}" products`,
    })
  }

  for (const column of template.columns) {
    const value = column.value(context)
    row[column.header] = value
    const required =
      typeof column.required === "function" ? column.required(product) : Boolean(column.required)
    // An unsupported category is already reported above; do not also call it "missing".
    const unsupportedCategory = column.source === "category" && !sellsCategory
    if (required && isEmpty(value) && !unsupportedCategory) {
      issues.push({
        column: column.header,
        message: `${column.header} is required (from ${column.source})`,
      })
    }
    if (column.maxLength && typeof value === "string" && value.length > column.maxLength) {
      issues.push({
        column: column.header,
        message: `${column.header} exceeds ${column.maxLength} characters`,
      })
    }
  }

  if (pricing.status === "loss_at_mrp" || pricing.status === "infeasible") {
    issues.push({
      column: "Price",
      message: `Selling on ${template.name} loses money even at MRP after fees (contribution ₹${pricing.contribution})`,
    })
  }

  return {
    marketplace: code,
    productId: product.id,
    title: template.buildTitle(product),
    pricing,
    row,
    issues,
    ready: issues.length === 0,
  }
}

export function templateHeaders(code: ListingMarketplaceCode): string[] {
  return TEMPLATES[code].columns.map((column) => column.header)
}
