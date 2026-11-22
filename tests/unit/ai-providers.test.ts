import { describe, expect, it, vi } from "vitest"
import type { ClassifiedGeminiError } from "@/lib/ai/errors"
import type { ProductExtraction } from "@/lib/ai/extraction-schema"
import { formatTimestamp, jsonPrompt } from "@/lib/ai/prompt"
import {
  ChatCallError,
  InvalidModelOutputError,
  ProviderHttpError,
  chatBody,
  classifyProviderError,
  extractWithChat,
  framesContent,
  parseExtraction,
  videoFileContent,
} from "@/lib/ai/providers/openai-compatible"
import { AUTO_ORDER, runExtraction } from "@/lib/ai/providers/orchestrate"
import {
  ExtractionFailedError,
  type ProviderInput,
  type ProviderOutput,
  ProviderError,
  ProviderNotConfiguredError,
  type VideoExtractionProvider,
} from "@/lib/ai/providers/types"
import {
  DEFAULT_QWEN_BASE_URL,
  isPlausibleDeepSeekKey,
  parseEnv,
  serverEnvSchema,
} from "@/lib/env/schema"
import { candidateTimes, fitWithin, sharpness } from "@/lib/video/frames"

const field = <T>(value: T) => ({ value, confidence: 0.9, evidence: "00:01 – label" })
const EXTRACTION: ProductExtraction = {
  product_name: field("Kashmiri Red Chilli Powder"),
  brand: field("Spice Valley"),
  category: field("grocery"),
  description: field("Red chilli powder."),
  ingredients: field("Kashmiri red chilli"),
  manufacturer: field("Spice Valley Foods, Kochi"),
  net_weight_grams: field(200),
  mrp_inr: field(120),
  length_cm: field(null),
  width_cm: field(null),
  height_cm: field(null),
  color: field("red"),
  additional_attributes: [],
  video_summary: "A pack of chilli powder is shown.",
  quality_warnings: [],
}

const LABELS = { label: "Qwen", keyEnv: "QWEN_API_KEY", modelEnv: "QWEN_MODEL" }
const KEY = "sk-test0123456789abcdef0123"
const http = (status: number, body: object | string, retryAfter: number | null = null) =>
  new ProviderHttpError(status, typeof body === "string" ? body : JSON.stringify(body), retryAfter)

describe("classifyProviderError (Qwen / DeepSeek)", () => {
  it.each([
    [
      http(401, { error: { message: "Incorrect API key provided.", code: "invalid_api_key" } }),
      "auth",
      false,
    ],
    [http(402, { error: { message: "Insufficient Balance" } }), "insufficient_credits", false],
    [
      http(400, {
        code: "Arrearage",
        message: "Access denied, please make sure your account is in good standing.",
      }),
      "insufficient_credits",
      false,
    ],
    [
      http(429, { code: "Throttling.RateQuota", message: "Requests throttling triggered." }),
      "quota",
      false,
    ],
    [
      http(429, { error: { code: "insufficient_quota", message: "free quota exhausted" } }),
      "quota",
      false,
    ],
    [
      http(404, { code: "ModelNotFound", message: "Model can not be found." }),
      "model_unavailable",
      false,
    ],
    [
      http(400, { error: { message: "This model does not support image input" } }),
      "model_unavailable",
      false,
    ],
    [
      http(403, { code: "Model.AccessDenied", message: "Model access denied." }),
      "model_unavailable",
      false,
    ],
    [http(403, { code: "AccessDenied", message: "Access denied." }), "auth", false],
    [http(503, "Service Unavailable"), "overloaded", true],
    [http(500, { code: "InternalError" }), "server_error", true],
    [
      http(400, { code: "InvalidParameter", message: "The video duration is too short" }),
      "invalid_request",
      false,
    ],
    [new TypeError("fetch failed"), "network", false],
  ] as const)("%#: → %s (retryable %s)", (error, kind, retryable) => {
    const result = classifyProviderError(error, LABELS, [KEY])
    expect(result.kind).toBe(kind)
    expect(result.retryable).toBe(retryable)
  })

  it("distinguishes a rate limit from a used-up quota, and passes Retry-After on", () => {
    const rate = classifyProviderError(
      http(429, { message: "Requests throttling triggered." }, 12),
      LABELS,
    )
    expect(rate.message).toMatch(/rate limit/)
    expect(rate.retryAfterSeconds).toBe(12)
    const quota = classifyProviderError(http(429, { code: "AllocationQuota.FreeTierOnly" }), LABELS)
    expect(quota.message).toMatch(/quota .* used up/)
  })

  it("names the env var to fix and never echoes the key", () => {
    const result = classifyProviderError(http(400, { message: `bad key ${KEY}` }), LABELS, [KEY])
    expect(result.message).not.toContain(KEY)
    const auth = classifyProviderError(http(401, {}), LABELS)
    expect(auth.message).toContain("QWEN_API_KEY")
  })
})

describe("request builders", () => {
  it("sends a whole video as a Base64 data URL video_url part (Qwen-VL)", () => {
    const [video, text] = videoFileContent("video/mp4", "AAAA")
    expect(video).toEqual({ type: "video_url", video_url: { url: "data:video/mp4;base64,AAAA" } })
    expect(text).toMatchObject({ type: "text" })
  })

  it("labels each frame with its timestamp and ends with the JSON instructions", () => {
    const parts = framesContent([
      { timeSeconds: 2.4, mimeType: "image/jpeg", base64: "B1" },
      { timeSeconds: 75, mimeType: "image/jpeg", base64: "B2" },
    ])
    expect(parts.slice(0, 4)).toEqual([
      { type: "text", text: "Frame at 00:02" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,B1" } },
      { type: "text", text: "Frame at 01:15" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,B2" } },
    ])
    expect(parts.at(-1)).toMatchObject({ type: "text" })
  })

  it("uses JSON mode by default, and can drop it", () => {
    expect(chatBody("m", [])).toMatchObject({
      response_format: { type: "json_object" },
      stream: false,
    })
    expect(chatBody("m", [], { jsonMode: false })).not.toHaveProperty("response_format")
    expect(chatBody("m", [], { extra: { enable_thinking: false } })).toMatchObject({
      enable_thinking: false,
    })
  })

  it("puts the schema and the word JSON in the prompt", () => {
    const prompt = jsonPrompt("frames", [1, 2])
    expect(prompt).toContain("JSON")
    expect(prompt).toContain('"product_name"')
    expect(prompt).toContain("2 still frames")
    expect(formatTimestamp(3599.9)).toBe("59:59")
  })
})

describe("parseExtraction", () => {
  it("accepts plain JSON and ```json fences", () => {
    expect(parseExtraction(JSON.stringify(EXTRACTION)).extraction.brand.value).toBe("Spice Valley")
    expect(
      parseExtraction("```json\n" + JSON.stringify(EXTRACTION) + "\n```").extraction.mrp_inr.value,
    ).toBe(120)
  })
  it("rejects non-JSON and schema mismatches", () => {
    expect(() => parseExtraction("Sure! Here it is")).toThrow(InvalidModelOutputError)
    const broken = { ...EXTRACTION, category: field("spaceships") }
    expect(() => parseExtraction(JSON.stringify(broken))).toThrow(/category/)
  })
})

describe("extractWithChat (fake fetch, no network)", () => {
  const video = { name: "v.mp4", sizeBytes: 1, mimeType: "video/mp4" }
  const ok = (content: string) =>
    new Response(
      JSON.stringify({
        model: "qwen3-vl-flash",
        choices: [{ message: { content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
      { status: 200 },
    )
  const config = (fetchImpl: typeof fetch) => ({
    baseUrl: DEFAULT_QWEN_BASE_URL,
    apiKey: KEY,
    labels: LABELS,
    fetchImpl,
    sleep: async () => {},
  })

  it("posts to /chat/completions with a Bearer key and returns validated attributes", async () => {
    const fetchImpl = vi.fn(async () => ok(JSON.stringify(EXTRACTION)))
    const result = await extractWithChat(config(fetchImpl), "qwen3-vl-flash", [], video)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_QWEN_BASE_URL}/chat/completions`)
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    expect(result).toMatchObject({
      model: "qwen3-vl-flash",
      attempts: 1,
      usage: { totalTokens: 150 },
    })
    expect(result.extraction.product_name.value).toBe("Kashmiri Red Chilli Powder")
  })

  it("retries a 503 with backoff, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValue(ok(JSON.stringify(EXTRACTION)))
    const result = await extractWithChat(config(fetchImpl), "m", [], video)
    expect(result.attempts).toBe(3)
  })

  it("gives up after 3 retries on persistent 503", async () => {
    const fetchImpl = vi.fn(async () => new Response("busy", { status: 503 }))
    const error = await extractWithChat(config(fetchImpl), "m", [], video).catch((caught) => caught)
    expect(error).toBeInstanceOf(ChatCallError)
    expect((error as ChatCallError).classified.kind).toBe("overloaded")
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it("does not retry 402 insufficient credits", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }), {
          status: 402,
        }),
    )
    const error = (await extractWithChat(config(fetchImpl), "m", [], video).catch(
      (caught) => caught,
    )) as ChatCallError
    expect(error.classified.kind).toBe("insufficient_credits")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("retries once without JSON mode when the model does not support response_format", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "response_format json_object is not supported" } }),
          { status: 400 },
        ),
      )
      .mockResolvedValue(ok("```json\n" + JSON.stringify(EXTRACTION) + "\n```"))
    await extractWithChat(config(fetchImpl), "m", [], video)
    const second = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string)
    expect(second).not.toHaveProperty("response_format")
  })

  it("reports a cut-off or invalid answer instead of guessing", async () => {
    const cut = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "{" }, finish_reason: "length" }] }),
          { status: 200 },
        ),
    )
    await expect(extractWithChat(config(cut), "m", [], video)).rejects.toThrow(/cut off/)
    const prose = vi.fn(async () => ok("I think it is chilli powder"))
    await expect(extractWithChat(config(prose), "m", [], video)).rejects.toThrow(
      InvalidModelOutputError,
    )
  })
})

describe("runExtraction (Auto: Gemini → DeepSeek; Qwen manual-only)", () => {
  const output = (model: string): ProviderOutput => ({
    extraction: EXTRACTION,
    rawJson: "{}",
    model,
    durationMs: 1,
    attempts: 1,
    usage: { promptTokens: null, outputTokens: null, totalTokens: null },
    video: { name: "v.mp4", sizeBytes: 1, mimeType: "video/mp4" },
    inputMode: "frames",
    frameCount: 12,
    notes: [],
  })
  const classified = (kind: ClassifiedGeminiError["kind"]): ClassifiedGeminiError => ({
    kind,
    status: null,
    retryable: false,
    retryAfterSeconds: null,
    message: kind,
  })
  const fake = (
    id: VideoExtractionProvider["id"],
    behaviour: "ok" | "unconfigured" | ClassifiedGeminiError["kind"] | "bad_output",
    needsFrames = false,
  ) => {
    const extract = vi.fn(async (input: ProviderInput) => {
      if (behaviour === "ok") return output(input.model ?? `${id}-default`)
      if (behaviour === "bad_output") throw new ExtractionFailedError(id, "m", "not valid JSON")
      throw new ProviderError(
        id,
        `${id}-default`,
        classified(behaviour as ClassifiedGeminiError["kind"]),
        1,
      )
    })
    const provider: VideoExtractionProvider = {
      id,
      label: id,
      keyEnv: `${id.toUpperCase()}_API_KEY`,
      needsFrames,
      isConfigured: () => behaviour !== "unconfigured",
      defaultModel: () => `${id}-default`,
      modelChoices: async () => [`${id}-default`],
      extract,
    }
    return provider
  }
  const input: ProviderInput = {
    video: new File(["x"], "v.mp4", { type: "video/mp4" }),
    videoMeta: { name: "v.mp4", sizeBytes: 1, mimeType: "video/mp4" },
    frames: [{ timeSeconds: 0, mimeType: "image/jpeg", base64: "x" }],
  }

  it("uses Gemini first, and never uses Qwen in Auto even when it has a key", async () => {
    const providers = [fake("qwen", "ok"), fake("deepseek", "ok"), fake("gemini", "ok")]
    const outcome = await runExtraction(providers, "auto", input)
    expect(outcome.ok && outcome.response).toMatchObject({ provider: "gemini", fallbacks: [] })
    expect(providers[0].extract).not.toHaveBeenCalled()
    expect(providers[1].extract).not.toHaveBeenCalled()
    expect(AUTO_ORDER).toEqual(["gemini", "deepseek"])
  })

  it("works with Gemini as the only configured provider", async () => {
    const outcome = await runExtraction(
      [fake("qwen", "unconfigured"), fake("deepseek", "unconfigured"), fake("gemini", "ok")],
      "auto",
      { ...input, frames: [] },
    )
    expect(outcome.ok && outcome.response).toMatchObject({ provider: "gemini", fallbacks: [] })
  })

  it.each([
    "quota",
    "insufficient_credits",
    "model_unavailable",
    "overloaded",
    "server_error",
    "network",
  ] as const)("falls back from Gemini to DeepSeek on %s and records why", async (kind) => {
    const outcome = await runExtraction(
      [fake("qwen", "ok"), fake("deepseek", "ok"), fake("gemini", kind)],
      "auto",
      input,
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.response.provider).toBe("deepseek")
    expect(outcome.response.fallbacks).toEqual([
      { provider: "gemini", model: "gemini-default", kind, message: kind },
    ])
  })

  it("with Gemini alone, a Gemini failure is reported (no DeepSeek without a key)", async () => {
    const outcome = await runExtraction(
      [fake("qwen", "unconfigured"), fake("deepseek", "unconfigured"), fake("gemini", "quota")],
      "auto",
      input,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect((outcome.error as ProviderError).provider).toBe("gemini")
    expect(outcome.fallbacks.map((step) => step.kind)).toEqual(["not_configured"])
  })

  it("does NOT fall back silently on a rejected key or a malformed request", async () => {
    for (const kind of ["auth", "invalid_request"] as const) {
      const deepseek = fake("deepseek", "ok")
      const outcome = await runExtraction([fake("gemini", kind), deepseek], "auto", input)
      expect(outcome.ok).toBe(false)
      expect(!outcome.ok && (outcome.error as ProviderError).kind).toBe(kind)
      expect(deepseek.extract).not.toHaveBeenCalled()
    }
  })

  it("does not fall back when a provider returns invalid attributes", async () => {
    const outcome = await runExtraction(
      [fake("gemini", "bad_output"), fake("deepseek", "ok")],
      "auto",
      input,
    )
    expect(!outcome.ok && outcome.error).toBeInstanceOf(ExtractionFailedError)
  })

  it("skips frame-only providers when no frames were extracted", async () => {
    const outcome = await runExtraction(
      [fake("gemini", "quota"), fake("deepseek", "ok", true)],
      "auto",
      { ...input, frames: [] },
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect((outcome.error as ProviderError).provider).toBe("gemini")
    expect(outcome.fallbacks.map((step) => step.kind)).toEqual(["no_frames"])
  })

  it("when everything fails, returns the last error and the earlier ones as the trail", async () => {
    const outcome = await runExtraction(
      [fake("gemini", "overloaded"), fake("deepseek", "insufficient_credits")],
      "auto",
      input,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect((outcome.error as ProviderError).provider).toBe("deepseek")
    expect(outcome.fallbacks.map((step) => step.provider)).toEqual(["gemini"])
  })

  it("reports when nothing in the Auto chain is configured (a Qwen key alone is not enough)", async () => {
    const outcome = await runExtraction(
      [fake("qwen", "ok"), fake("deepseek", "unconfigured"), fake("gemini", "unconfigured")],
      "auto",
      input,
    )
    expect(!outcome.ok && outcome.error).toBeInstanceOf(ProviderNotConfiguredError)
  })

  it("a specific provider never falls back, and uses the chosen model", async () => {
    const outcome = await runExtraction([fake("qwen", "quota"), fake("deepseek", "ok")], "qwen", {
      ...input,
      model: "qwen3-vl-plus",
    })
    expect(!outcome.ok && (outcome.error as ProviderError).kind).toBe("quota")
    const chosen = await runExtraction([fake("qwen", "ok")], "qwen", {
      ...input,
      model: "qwen3-vl-plus",
    })
    expect(chosen.ok && chosen.response.model).toBe("qwen3-vl-plus")
    const missing = await runExtraction([fake("qwen", "unconfigured")], "qwen", input)
    expect(!missing.ok && missing.error).toBeInstanceOf(ProviderNotConfiguredError)
  })
})

describe("browser frame selection (pure parts)", () => {
  it("spreads two candidates per slot across the whole video", () => {
    const times = candidateTimes(12, 4)
    expect(times).toHaveLength(4)
    expect(times[0]).toEqual([1, 2])
    expect(times[3][1]).toBeCloseTo(11, 5)
    expect(candidateTimes(Infinity, 12)).toEqual([])
  })

  it("scores a sharp edge above a smooth gradient", () => {
    const size = 16
    const edge = Array.from({ length: size * size }, (_, i) => (i % size < size / 2 ? 0 : 255))
    const smooth = Array.from({ length: size * size }, (_, i) => (i % size) * 2)
    expect(sharpness(edge, size, size)).toBeGreaterThan(sharpness(smooth, size, size))
  })

  it("keeps the aspect ratio within the max edge", () => {
    expect(fitWithin(1920, 1080, 1024)).toEqual({ width: 1024, height: 576 })
    expect(fitWithin(400, 300, 1024)).toEqual({ width: 400, height: 300 })
  })
})

describe("provider env vars", () => {
  it("are optional, with Singapore Qwen and DeepSeek defaults", () => {
    const env = parseEnv(serverEnvSchema, {})
    expect(env.QWEN_API_KEY).toBeUndefined()
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(env).toMatchObject({
      QWEN_MODEL: "qwen3-vl-flash",
      QWEN_BASE_URL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com",
    })
  })
  it("accept another region and strip the trailing slash; reject http", () => {
    const env = parseEnv(serverEnvSchema, {
      QWEN_BASE_URL: "https://dashscope-us.aliyuncs.com/compatible-mode/v1/",
    })
    expect(env.QWEN_BASE_URL).toBe("https://dashscope-us.aliyuncs.com/compatible-mode/v1")
    expect(() =>
      parseEnv(serverEnvSchema, { DEEPSEEK_BASE_URL: "http://api.deepseek.com" }),
    ).toThrow(/https/)
  })
})

describe("DeepSeek activation", () => {
  it("only counts a real-looking DeepSeek key as configured", () => {
    expect(isPlausibleDeepSeekKey("sk-0123456789abcdef0123456789abcdef")).toBe(true)
    for (const key of [
      undefined,
      "",
      "your-key-here",
      "sk-short",
      "AIzaSyA1234567890abcdefghijklmnop",
    ]) {
      expect(isPlausibleDeepSeekKey(key)).toBe(false)
    }
  })
  it("defaults Gemini to Flash Lite", () => {
    expect(parseEnv(serverEnvSchema, {}).GEMINI_MODEL).toBe("gemini-flash-lite-latest")
  })
})
