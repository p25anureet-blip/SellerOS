import { describe, expect, it } from "vitest"
import { isAuthPage, isPublicPath, safeRedirectPath } from "@/lib/routes"

describe("route access rules", () => {
  it("knows which pages are public", () => {
    expect(isPublicPath("/")).toBe(true)
    expect(isPublicPath("/login")).toBe(true)
    expect(isPublicPath("/signup/")).toBe(true)
    expect(isPublicPath("/dashboard")).toBe(false)
    expect(isPublicPath("/settings")).toBe(false)
    expect(isPublicPath("/loginx")).toBe(false)
  })

  it("knows which pages are for logged-out users only", () => {
    expect(isAuthPage("/login")).toBe(true)
    expect(isAuthPage("/signup")).toBe(true)
    expect(isAuthPage("/")).toBe(false)
  })
})

describe("safeRedirectPath (open-redirect protection)", () => {
  it.each(["/dashboard", "/products?page=2", "/settings#ai"])("allows %s", (path) => {
    expect(safeRedirectPath(path)).toBe(path)
  })

  it.each([
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "javascript:alert(1)",
    "dashboard",
    "",
    "/login",
    "/signup?next=/x",
    "/da\nshboard",
  ])("rejects %j", (path) => {
    expect(safeRedirectPath(path)).toBe("/dashboard")
  })

  it("rejects non-strings", () => {
    expect(safeRedirectPath(null)).toBe("/dashboard")
    expect(safeRedirectPath(undefined, "/settings")).toBe("/settings")
  })
})
