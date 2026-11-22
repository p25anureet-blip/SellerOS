import { describe, expect, it } from "vitest"
import { parseEnv, publicEnvSchema, serverEnvSchema } from "@/lib/env/schema"

describe("environment validation", () => {
  it("accepts a complete public configuration", () => {
    const env = parseEnv(publicEnvSchema, {
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    })
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://abc.supabase.co")
  })

  it("lists every missing variable in one error", () => {
    expect(() => parseEnv(publicEnvSchema, {})).toThrowError(
      /NEXT_PUBLIC_SUPABASE_URL is missing[\s\S]*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing/,
    )
  })

  it("treats blank values as missing", () => {
    expect(() =>
      parseEnv(publicEnvSchema, {
        NEXT_PUBLIC_SUPABASE_URL: "  ",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "key",
      }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_URL is missing/)
  })

  it("rejects a malformed Supabase URL", () => {
    expect(() =>
      parseEnv(publicEnvSchema, {
        NEXT_PUBLIC_SUPABASE_URL: "abc.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "key",
      }),
    ).toThrowError(/must be a valid URL/)
  })

  it("defaults the Gemini model and allows starting without a key", () => {
    expect(parseEnv(serverEnvSchema, { GEMINI_API_KEY: "k" }).GEMINI_MODEL).toBe(
      "gemini-flash-lite-latest",
    )
    // AI features check for the key themselves and show setup instructions.
    expect(parseEnv(serverEnvSchema, {}).GEMINI_API_KEY).toBeUndefined()
    expect(parseEnv(serverEnvSchema, { GEMINI_API_KEY: "  " }).GEMINI_API_KEY).toBeUndefined()
    expect(parseEnv(serverEnvSchema, { GEMINI_MODEL: "" }).GEMINI_MODEL).toBe(
      "gemini-flash-lite-latest",
    )
  })
})
