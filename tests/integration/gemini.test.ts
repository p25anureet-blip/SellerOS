import { describe, expect, it } from "vitest"
import { requireEnv } from "./helpers"

describe("Gemini API (real request)", () => {
  it("answers the connection check with the configured key and model", async () => {
    requireEnv("GEMINI_API_KEY")
    // Imported lazily so a missing key fails with requireEnv's clearer message.
    const { checkGeminiConnection } = await import("@/lib/ai/gemini")

    const result = await checkGeminiConnection()

    if (!result.ok) throw new Error(`Gemini check failed for ${result.model}: ${result.error}`)
    expect(result.reply.length).toBeGreaterThan(10)
    expect(result.latencyMs).toBeGreaterThan(0)
  })
})
