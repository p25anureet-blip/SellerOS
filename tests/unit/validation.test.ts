import { describe, expect, it } from "vitest"
import { loginSchema, signupSchema } from "@/lib/validation/auth"
import { readFields, validationError } from "@/lib/validation/form-state"
import { organizationSchema } from "@/lib/validation/organization"

const validSignup = {
  fullName: "Priya Sharma",
  organizationName: "Sharma Handlooms",
  email: "Priya@Example.com ",
  password: "handloom2026",
}

describe("signup validation", () => {
  it("accepts valid input and normalises the email", () => {
    const result = signupSchema.parse(validSignup)
    expect(result.email).toBe("priya@example.com")
  })

  it.each([
    ["short", "Use at least 8 characters"],
    ["12345678", "Include at least one letter"],
    ["abcdefgh", "Include at least one number"],
    ["a1".repeat(37), "Use at most 72 characters"],
  ])("rejects password %j", (password, message) => {
    const result = signupSchema.safeParse({ ...validSignup, password })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toContain(message)
  })

  it("rejects an invalid email and a blank name", () => {
    const result = signupSchema.safeParse({ ...validSignup, email: "nope", fullName: " " })
    const fields = result.error?.issues.map((issue) => issue.path[0])
    expect(fields).toEqual(expect.arrayContaining(["email", "fullName"]))
  })
})

describe("login validation", () => {
  it("requires both fields", () => {
    const result = loginSchema.safeParse({ email: "", password: "" })
    expect(result.error?.issues).toHaveLength(2)
  })
})

describe("organization validation", () => {
  it("upper-cases a valid GSTIN", () => {
    expect(organizationSchema.parse({ name: "Shop", gstin: "27aapfu0939f1zv" }).gstin).toBe(
      "27AAPFU0939F1ZV",
    )
  })

  it("treats a blank GSTIN as not set", () => {
    expect(organizationSchema.parse({ name: "Shop", gstin: "  " }).gstin).toBeNull()
  })

  it.each(["27AAPFU0939F1Z", "27AAPFU0939F1AV", "XXAAPFU0939F1ZV"])(
    "rejects malformed GSTIN %s",
    (gstin) => {
      expect(organizationSchema.safeParse({ name: "Shop", gstin }).success).toBe(false)
    },
  )
})

describe("form helpers", () => {
  it("reads text fields and ignores files", () => {
    const formData = new FormData()
    formData.set("name", "Shop")
    formData.set("logo", new Blob(["x"]))
    expect(readFields(formData, ["name", "logo", "missing"])).toEqual({
      name: "Shop",
      logo: "",
      missing: "",
    })
  })

  it("groups validation messages by field", () => {
    const result = signupSchema.safeParse({ ...validSignup, password: "x" })
    if (result.success) throw new Error("expected failure")
    const state = validationError(result.error, { email: "a@b.co" })
    expect(state.status).toBe("error")
    expect(state.fieldErrors?.password?.length).toBeGreaterThan(1)
    expect(state.values).toEqual({ email: "a@b.co" })
  })
})
