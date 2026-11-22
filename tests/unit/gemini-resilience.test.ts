import { describe, expect, it, vi } from "vitest"
import { classifyGeminiError, redactSecrets } from "@/lib/ai/errors"
import { retryRequestSchema } from "@/lib/ai/extraction-api"
import { isVideoAnalysisModel, modelId, suggestAlternativeModels } from "@/lib/ai/model-choice"
import { RetriesExhaustedError, backoffDelayMs, withRetry } from "@/lib/ai/retry"

/** Shaped like the SDK's ApiError: a message holding Google's JSON plus a numeric status. */
const apiError = (status: number, body: object) =>
  Object.assign(new Error(JSON.stringify(body)), { name: "ApiError", status })

const OVERLOADED = apiError(503, {
  error: {
    code: 503,
    message: "This model is currently experiencing high demand. Please try again later.",
    status: "UNAVAILABLE",
  },
})
const RATE_LIMITED = apiError(429, {
  error: {
    code: 429,
    message: "You exceeded your current quota.",
    status: "RESOURCE_EXHAUSTED",
    details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" }],
  },
})

describe("classifyGeminiError", () => {
  it("treats 503 UNAVAILABLE as temporary overload and retryable", () => {
    const result = classifyGeminiError(OVERLOADED)
    expect(result).toMatchObject({ kind: "overloaded", status: 503, retryable: true })
    expect(result.message).toMatch(/HTTP 503/)
  })

  it("treats 429 as a quota problem on the key, distinct from 503, and not auto-retried", () => {
    const result = classifyGeminiError(RATE_LIMITED)
    expect(result).toMatchObject({
      kind: "quota",
      status: 429,
      retryable: false,
      retryAfterSeconds: 37,
    })
    expect(result.message).toMatch(/not a Google outage/)
    expect(result.message).toMatch(/37 s/)
  })

  it("recognises a daily quota", () => {
    const daily = apiError(429, {
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "GenerateRequestsPerDayPerProjectPerModel",
      },
    })
    expect(classifyGeminiError(daily).message).toMatch(/daily quota/)
  })

  it.each([
    [500, "server_error", true],
    [502, "server_error", true],
    [504, "server_error", true],
    [404, "model_unavailable", false],
    [401, "auth", false],
  ] as const)("HTTP %i → %s (retryable %s)", (status, kind, retryable) => {
    const result = classifyGeminiError(apiError(status, { error: { code: status, message: "x" } }))
    expect(result).toMatchObject({ kind, retryable })
  })

  it("reads the status from the message when the error has no status field", () => {
    expect(classifyGeminiError(new Error('{"error":{"code":503}}')).kind).toBe("overloaded")
  })

  it("never puts the API key in the message", () => {
    const key = "AQ.Ab8RN6Lsecretsecretsecretsecret"
    const result = classifyGeminiError(new Error(`weird failure for key=${key} and ${key}`), [key])
    expect(result.message).not.toContain(key)
    expect(result.message).toContain("[REDACTED]")
  })
})

describe("redactSecrets", () => {
  it("removes the configured key, key-shaped strings and ?key= params", () => {
    const text = redactSecrets(
      "a my-secret-value b AIzaSyA1234567890abcdefghijklmnopqrstu c https://x/y?key=abc123&z=1",
      ["my-secret-value"],
    )
    expect(text).toBe("a [REDACTED] b [REDACTED] c https://x/y?key=[REDACTED]&z=1")
  })
})

describe("backoffDelayMs", () => {
  it("doubles each retry, with jitter between 50% and 100%, capped", () => {
    expect(backoffDelayMs(1, { random: () => 1 })).toBe(2000)
    expect(backoffDelayMs(2, { random: () => 1 })).toBe(4000)
    expect(backoffDelayMs(3, { random: () => 1 })).toBe(8000)
    expect(backoffDelayMs(3, { random: () => 0 })).toBe(4000)
    expect(backoffDelayMs(10, { random: () => 1 })).toBe(16000)
  })
})

describe("withRetry", () => {
  const noSleep = vi.fn(async () => {})
  const transient = (error: unknown) => classifyGeminiError(error).retryable

  it("retries a 503 and returns once Gemini recovers", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(OVERLOADED)
      .mockRejectedValueOnce(OVERLOADED)
      .mockResolvedValue("ok")
    const result = await withRetry(operation, { shouldRetry: transient, sleep: noSleep })
    expect(result).toEqual({ value: "ok", attempts: 3 })
  })

  it("stops after 3 retries (4 calls in total) and reports the last error", async () => {
    const operation = vi.fn().mockRejectedValue(OVERLOADED)
    const sleep = vi.fn((ms: number) => Promise.resolve(void ms))
    const error = await withRetry(operation, {
      shouldRetry: transient,
      sleep,
      random: () => 1,
    }).catch((caught) => caught)
    expect(error).toBeInstanceOf(RetriesExhaustedError)
    expect((error as RetriesExhaustedError).attempts).toBe(4)
    expect((error as RetriesExhaustedError).lastError).toBe(OVERLOADED)
    expect(operation).toHaveBeenCalledTimes(4)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 4000, 8000])
  })

  it("does not retry a 429 quota error", async () => {
    const operation = vi.fn().mockRejectedValue(RATE_LIMITED)
    await expect(withRetry(operation, { shouldRetry: transient, sleep: noSleep })).rejects.toBe(
      RATE_LIMITED,
    )
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it("never retries more than 10 times even if asked to", async () => {
    const operation = vi.fn().mockRejectedValue(OVERLOADED)
    await withRetry(operation, { shouldRetry: () => true, sleep: noSleep, maxRetries: 1000 }).catch(
      () => undefined,
    )
    expect(operation).toHaveBeenCalledTimes(11)
  })
})

describe("model choice", () => {
  // A real list returned by models.list() for a free AI Studio key (trimmed).
  const available = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-image",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash-preview-tts",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-pro-latest",
    "gemma-4-31b-it",
    "lyria-3.5",
    "nano-banana-pro-preview",
  ]

  it("strips the models/ prefix", () => {
    expect(modelId("models/gemini-flash-latest")).toBe("gemini-flash-latest")
  })

  it("only suggests models that can turn video into text", () => {
    expect(isVideoAnalysisModel("gemini-2.5-flash")).toBe(true)
    for (const id of [
      "gemini-2.5-flash-image",
      "gemini-2.5-flash-preview-tts",
      "gemma-4-31b-it",
      "lyria-3.5",
    ]) {
      expect(isVideoAnalysisModel(id)).toBe(false)
    }
  })

  it("suggests stable aliases first and never the failing model", () => {
    const suggestions = suggestAlternativeModels("gemini-flash-latest", available)
    expect(suggestions).toEqual([
      "gemini-flash-lite-latest",
      "gemini-pro-latest",
      "gemini-3.5-flash",
    ])
  })

  it("suggests alternatives for a model the key does not have", () => {
    const suggestions = suggestAlternativeModels("gemini-1.0-pro", available, 2)
    expect(suggestions).toEqual(["gemini-flash-latest", "gemini-flash-lite-latest"])
  })
})

describe("retryRequestSchema", () => {
  const video = { name: "a.mp4", sizeBytes: 10, mimeType: "video/mp4" }
  it("accepts a Gemini file reference and optional model", () => {
    expect(
      retryRequestSchema.safeParse({ fileName: "files/abc-123", video, model: "gemini-2.5-flash" })
        .success,
    ).toBe(true)
  })
  it.each(["files/../x", "https://evil", "files/ABC", "corpora/x"])("rejects %s", (fileName) => {
    expect(retryRequestSchema.safeParse({ fileName, video }).success).toBe(false)
  })
  it("rejects a model id with path characters", () => {
    expect(
      retryRequestSchema.safeParse({ fileName: "files/abc", video, model: "../x" }).success,
    ).toBe(false)
  })
})
