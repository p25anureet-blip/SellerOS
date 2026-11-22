import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Both Gemini upload paths against a fake Gemini client (no network):
 * - video path: Files API upload → processing → generateContent; the stored
 *   video is kept when the time budget runs out, so Retry needs no re-upload;
 * - frames path: inline images, no Files API upload at all.
 */

const fake = {
  upload: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(async () => ({})),
  generate: vi.fn(),
}

vi.mock("@/lib/ai/gemini", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/gemini")>()
  return {
    ...original,
    defaultModel: () => "gemini-flash-lite-latest",
    getGemini: () => ({
      files: { upload: fake.upload, get: fake.get, delete: fake.remove },
      models: { generateContent: fake.generate },
    }),
  }
})

const { GeminiCallError, extractProductFromFrames, extractProductFromVideo } =
  await import("@/lib/ai/product-extraction")

const field = <T>(value: T) => ({ value, confidence: 0.9, evidence: "00:01 – label" })
const ANSWER = JSON.stringify({
  product_name: field("Kashmiri Red Chilli Powder"),
  brand: field("Spice Valley"),
  category: field("grocery"),
  description: field("Chilli powder."),
  ingredients: field("Kashmiri red chilli"),
  manufacturer: field(null),
  net_weight_grams: field(200),
  mrp_inr: field(120),
  length_cm: field(null),
  width_cm: field(null),
  height_cm: field(null),
  color: field("red"),
  additional_attributes: [],
  video_summary: "A chilli powder pack.",
  quality_warnings: [],
})
const ok = { text: ANSWER, usageMetadata: { totalTokenCount: 900 } }
const overloaded = () =>
  Object.assign(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'), { status: 503 })

const frames = [
  { timeSeconds: 0.5, mimeType: "image/jpeg", base64: "AAA" },
  { timeSeconds: 1.5, mimeType: "image/jpeg", base64: "BBB" },
]
const meta = { name: "big.mp4", sizeBytes: 40 * 1024 * 1024, mimeType: "video/mp4" }

beforeEach(() => {
  for (const mock of Object.values(fake)) mock.mockReset()
  fake.remove.mockResolvedValue({})
})

describe("frames path (videos over 4 MB)", () => {
  it("sends inline frames to generateContent and never uses the Files API", async () => {
    fake.generate.mockResolvedValue(ok)
    const result = await extractProductFromFrames(frames, meta, "gemini-flash-lite-latest", {
      deadline: Date.now() + 200_000,
    })
    expect(result.extraction.brand.value).toBe("Spice Valley")
    expect(result.video).toEqual(meta)
    expect(fake.upload).not.toHaveBeenCalled()
    const request = fake.generate.mock.calls[0][0]
    expect(request.contents[0].parts[1]).toEqual({
      inlineData: { mimeType: "image/jpeg", data: "AAA" },
    })
    // The per-call timeout is capped by the remaining budget.
    expect(request.config.httpOptions.timeout).toBeLessThanOrEqual(180_000)
  })

  it("stops retrying 503s before the deadline with a frames-specific retry message", async () => {
    fake.generate.mockRejectedValue(overloaded())
    const error = await extractProductFromFrames(frames, meta, "gemini-flash-lite-latest", {
      deadline: Date.now() + 15_500, // room for one attempt; any retry (≥ 1 s wait + 15 s) is refused
    }).catch((caught) => caught)
    expect(error).toBeInstanceOf(GeminiCallError)
    expect(error.classified.kind).toBe("time_budget")
    expect(error.classified.message).toMatch(/only the small frames are sent again/)
    expect(error.upload).toBeNull()
    expect(fake.generate).toHaveBeenCalledTimes(1)
  })

  it("without time pressure, still reports a plain 503 after the normal retries", async () => {
    fake.generate.mockRejectedValue(overloaded())
    const error = await extractProductFromFrames(frames, meta).catch((caught) => caught)
    expect(error.classified.kind).toBe("overloaded")
    expect(fake.generate).toHaveBeenCalledTimes(4)
  }, 30_000)
})

describe("video path (videos up to 4 MB)", () => {
  const video = new File(["small"], "small.mp4", { type: "video/mp4" })
  const stored = { name: "files/abc123", uri: "https://x/files/abc123", mimeType: "video/mp4" }

  it("uploads, waits for processing, analyses and deletes the stored copy", async () => {
    fake.upload.mockResolvedValue({ ...stored, state: "ACTIVE", expirationTime: "2026-11-24" })
    fake.generate.mockResolvedValue(ok)
    const result = await extractProductFromVideo(video, "gemini-flash-lite-latest", {
      deadline: Date.now() + 200_000,
    })
    expect(result.extraction.mrp_inr.value).toBe(120)
    const uploadConfig = fake.upload.mock.calls[0][0].config
    expect(uploadConfig.abortSignal).toBeInstanceOf(AbortSignal)
    // httpOptions on files.upload breaks the SDK upload URL (404), so it must not be set.
    expect(uploadConfig).not.toHaveProperty("httpOptions")
    expect(fake.remove).toHaveBeenCalledWith({ name: "files/abc123" })
  })

  it("keeps the stored video when the budget runs out during processing (Retry skips the upload)", async () => {
    fake.upload.mockResolvedValue({ ...stored, state: "PROCESSING" })
    const error = await extractProductFromVideo(video, "gemini-flash-lite-latest", {
      deadline: Date.now() + 16_000, // enough to upload, not enough to wait for processing
    }).catch((caught) => caught)
    expect(error).toBeInstanceOf(GeminiCallError)
    expect(error.classified.kind).toBe("time_budget")
    expect(error.classified.message).toMatch(/still stored at Gemini/)
    expect(error.upload).toMatchObject({ fileName: "files/abc123" })
    expect(fake.remove).not.toHaveBeenCalled()
  })

  it("does not start an upload the budget cannot cover, and says to retry", async () => {
    const error = await extractProductFromVideo(video, "gemini-flash-lite-latest", {
      deadline: Date.now() + 5_000,
    }).catch((caught) => caught)
    expect(error.classified.kind).toBe("time_budget")
    expect(error.classified.message).toMatch(/Click Retry/)
    expect(fake.upload).not.toHaveBeenCalled()
  })

  it("keeps the stored video when 503 retries are cut short by the deadline", async () => {
    fake.upload.mockResolvedValue({ ...stored, state: "ACTIVE" })
    fake.generate.mockRejectedValue(overloaded())
    const error = await extractProductFromVideo(video, "gemini-flash-lite-latest", {
      deadline: Date.now() + 15_500,
    }).catch((caught) => caught)
    expect(error.classified.kind).toBe("time_budget")
    expect(error.upload).toMatchObject({ fileName: "files/abc123" })
    expect(fake.remove).not.toHaveBeenCalled()
  })
})
