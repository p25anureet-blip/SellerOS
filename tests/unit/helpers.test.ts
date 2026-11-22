import { describe, expect, it } from "vitest"
import { NAV_ITEMS, findNavItem, isActive } from "@/components/layout/nav-items"
import { describeGeminiError } from "@/lib/ai/errors"
import { initials } from "@/lib/utils"

describe("initials", () => {
  it.each([
    ["Priya Sharma", "", "PS"],
    ["Arjun Kumar Rao", "", "AR"],
    ["Meera", "", "ME"],
    [null, "zoya@shop.in", "Z"],
    ["  ", "", "?"],
  ])("%j / %j → %s", (name, email, expected) => {
    expect(initials(name, email)).toBe(expected)
  })
})

describe("navigation", () => {
  it("matches a section and its sub-pages only", () => {
    const products = findNavItem("/products")
    expect(isActive(products, "/products")).toBe(true)
    expect(isActive(products, "/products/123")).toBe(true)
    expect(isActive(products, "/products-archive")).toBe(false)
  })

  it("has unique links", () => {
    const hrefs = NAV_ITEMS.map((item) => item.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})

describe("describeGeminiError", () => {
  it.each([
    ["API key not valid. Please pass a valid API key.", /rejected the API key/],
    ['{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}', /rate limit \(HTTP 429\)/],
    ["models/gemini-x is not found for API version v1beta", /not available to your API key/],
    ["TypeError: fetch failed", /Could not reach/],
    ["Something odd", /Gemini request failed: Something odd/],
  ])("explains %j", (message, expected) => {
    expect(describeGeminiError(new Error(message))).toMatch(expected)
  })
})
