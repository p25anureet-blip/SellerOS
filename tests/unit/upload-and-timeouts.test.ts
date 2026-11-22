import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { timeBudgetError } from "@/lib/ai/errors"
import { geminiFramesParts } from "@/lib/ai/prompt"
import { ChatCallError, extractWithChat } from "@/lib/ai/providers/openai-compatible"
import { runExtraction } from "@/lib/ai/providers/orchestrate"
import {
  type ProviderInput,
  ProviderError,
  type VideoExtractionProvider,
} from "@/lib/ai/providers/types"
import {
  FUNCTION_MAX_DURATION_S,
  MIN_ATTEMPT_MS,
  REQUEST_TIME_BUDGET_MS,
  RetriesExhaustedError,
  isOutOfTime,
  requestDeadline,
  timeoutWithin,
  withRetry,
} from "@/lib/ai/retry"
import { readUploadInput } from "@/lib/ai/upload-input"
import {
  DIRECT_VIDEO_MAX_BYTES,
  VERCEL_BODY_LIMIT_BYTES,
  estimateRequestBytes,
  fitPayload,
  planUpload,
} from "@/lib/ai/upload-plan"

const MB = 1024 * 1024
const KB = 1024

describe("planUpload: which path a video takes", () => {
  it("sends videos up to 4 MB as the file (Gemini, no frames needed)", () => {
    expect(planUpload(1 * MB, "gemini")).toEqual({
      sendVideo: true,
      wantFrames: false,
      reason: "fits",
    })
    expect(planUpload(DIRECT_VIDEO_MAX_BYTES, "auto", ["gemini"])).toMatchObject({
      sendVideo: true,
      wantFrames: false,
    })
  })

  it("never uploads videos over 4 MB: frames instead, for every provider", () => {
    for (const selection of ["auto", "gemini", "deepseek", "qwen"] as const) {
      expect(planUpload(DIRECT_VIDEO_MAX_BYTES + 1, selection, ["gemini"])).toEqual({
        sendVideo: false,
        wantFrames: true,
        reason: "too_large",
      })
    }
  })

  it("in Auto, adds frames only when a frame-reading fallback (DeepSeek) is configured", () => {
    expect(planUpload(2 * MB, "auto", ["gemini", "deepseek"])).toMatchObject({
      sendVideo: true,
      wantFrames: true,
    })
    expect(planUpload(2 * MB, "auto", ["deepseek"])).toMatchObject({
      sendVideo: false,
      wantFrames: true,
    })
    expect(planUpload(2 * MB, "deepseek")).toMatchObject({ sendVideo: false, wantFrames: true })
  })
})

describe("payload sizes stay under Vercel's 4.5 MB body limit", () => {
  const twelveFrames = (size: number) => Array.from({ length: 12 }, () => size)

  it("a 4 MB video alone fits, with room for the form fields", () => {
    expect(estimateRequestBytes(DIRECT_VIDEO_MAX_BYTES, [])).toBeLessThan(VERCEL_BODY_LIMIT_BYTES)
  })

  it("12 typical frames (~30–150 KB) are far below the limit", () => {
    const decision = fitPayload(planUpload(40 * MB, "gemini"), 40 * MB, twelveFrames(150 * KB))
    expect(decision).toMatchObject({ ok: true, includeVideo: false, includeFrames: true })
    expect(decision.bytes).toBeLessThan(2 * MB)
  })

  it("drops fallback frames rather than the video when both would not fit", () => {
    const plan = planUpload(3.9 * MB, "auto", ["gemini", "deepseek"])
    const decision = fitPayload(plan, 3.9 * MB, twelveFrames(100 * KB))
    expect(decision).toMatchObject({ ok: true, includeVideo: true, includeFrames: false })
    expect(decision.bytes).toBeLessThanOrEqual(VERCEL_BODY_LIMIT_BYTES)
  })

  it("keeps both when they fit together", () => {
    const plan = planUpload(1 * MB, "auto", ["gemini", "deepseek"])
    expect(fitPayload(plan, 1 * MB, twelveFrames(100 * KB))).toMatchObject({
      ok: true,
      includeVideo: true,
      includeFrames: true,
    })
  })

  it("refuses a frames-only request that would still be too large", () => {
    const decision = fitPayload(planUpload(50 * MB, "gemini"), 50 * MB, twelveFrames(500 * KB))
    expect(decision.ok).toBe(false)
    expect(decision.bytes).toBeGreaterThan(VERCEL_BODY_LIMIT_BYTES)
  })
})

describe("readUploadInput: both request shapes", () => {
  const jpeg = (name = "f.jpg") =>
    new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: "image/jpeg" })
  const meta = { name: "big.mp4", sizeBytes: 40 * MB, mimeType: "video/mp4" }

  it("video path: the file plus its metadata", async () => {
    const form = new FormData()
    form.append("video", new File(["abc"], "small.mp4", { type: "video/mp4" }))
    const input = await readUploadInput(form)
    expect(input).toMatchObject({
      videoMeta: { name: "small.mp4", sizeBytes: 3, mimeType: "video/mp4" },
      frames: [],
    })
    expect("video" in input && input.video).toBeInstanceOf(File)
  })

  it("frames path: no video, frames + timestamps + videoMeta", async () => {
    const form = new FormData()
    form.append("frames", jpeg())
    form.append("frames", jpeg())
    form.append("frameTimes", "[0.5, 1.5]")
    form.append("videoMeta", JSON.stringify(meta))
    const input = await readUploadInput(form)
    expect(input).toMatchObject({ video: null, videoMeta: meta })
    expect("frames" in input && input.frames.map((frame) => frame.timeSeconds)).toEqual([0.5, 1.5])
  })

  it.each([
    ["neither video nor frames", () => new FormData(), 400, /No video was uploaded/],
    [
      "frames without videoMeta",
      () => {
        const form = new FormData()
        form.append("frames", jpeg())
        form.append("frameTimes", "[1]")
        return form
      },
      400,
      /videoMeta must describe/,
    ],
    [
      "a non-video file",
      () => {
        const form = new FormData()
        form.append("video", new File(["x"], "a.gif", { type: "image/gif" }))
        return form
      },
      415,
      /MP4/,
    ],
    [
      "timestamps that do not match the frames",
      () => {
        const form = new FormData()
        form.append("frames", jpeg())
        form.append("frameTimes", "[1, 2]")
        return form
      },
      400,
      /one entry per frame/,
    ],
  ])("rejects %s with a clear message", async (_, build, status, message) => {
    const input = await readUploadInput(build())
    expect(input).toMatchObject({ status })
    expect("error" in input && input.error).toMatch(message)
  })
})

describe("time budget for Vercel Hobby (300 s)", () => {
  it("the upload route declares maxDuration = 300 (a literal, as Next.js requires)", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/ai/extract-product/route.ts"),
      "utf8",
    )
    expect(route).toMatch(/^export const maxDuration = 300$/m)
    expect(FUNCTION_MAX_DURATION_S).toBe(300)
  })

  it("AI work stops 30 s before the platform limit", () => {
    expect(REQUEST_TIME_BUDGET_MS).toBe(270_000)
    expect(requestDeadline(1_000)).toBe(271_000)
  })

  it("per-call timeouts never run past the deadline", () => {
    const now = 1_000_000
    expect(timeoutWithin(180_000, now + 60_000, now)).toBe(60_000)
    expect(timeoutWithin(180_000, undefined, now)).toBe(180_000)
    expect(timeoutWithin(180_000, now - 5_000, now)).toBe(1_000)
    expect(isOutOfTime(now + MIN_ATTEMPT_MS - 1, now)).toBe(true)
    expect(isOutOfTime(now + MIN_ATTEMPT_MS + 1, now)).toBe(false)
  })

  it("withRetry does not start a retry that cannot finish before the deadline", async () => {
    let clock = 0
    const operation = vi.fn(async () => {
      clock += 10_000 // each attempt takes 10 s
      throw Object.assign(new Error("busy"), { status: 503 })
    })
    const error = await withRetry(operation, {
      shouldRetry: () => true,
      deadline: 30_000,
      now: () => clock,
      sleep: async (ms) => void (clock += ms),
      random: () => 1,
    }).catch((caught) => caught)
    expect(error).toBeInstanceOf(RetriesExhaustedError)
    expect((error as RetriesExhaustedError).outOfTime).toBe(true)
    // 10 s attempt + 2 s wait + 15 s minimum > 30 s? No: 27 s ≤ 30 s → 2nd attempt; then 22 s + 4 s + 15 s > 30 s → stop.
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it("explains what a retry will reuse", () => {
    expect(timeBudgetError("Gemini", "analysing the video", "stored_video").message).toMatch(
      /still stored at Gemini, so Retry continues without uploading it again/,
    )
    expect(timeBudgetError("Gemini", "analysing the frames", "frames").message).toMatch(
      /only the small frames are sent again/,
    )
    const error = timeBudgetError("Gemini", "x", "none")
    expect(error).toMatchObject({ kind: "time_budget", retryable: false })
    expect(error.message).toMatch(/time limit/)
  })
})

describe("OpenAI-compatible providers respect the deadline", () => {
  const video = { name: "v.mp4", sizeBytes: 1, mimeType: "video/mp4" }
  const labels = { label: "DeepSeek", keyEnv: "DEEPSEEK_API_KEY", modelEnv: "DEEPSEEK_MODEL" }

  it("does not even start when the budget is already spent", async () => {
    const fetchImpl = vi.fn()
    const error = (await extractWithChat(
      { baseUrl: "https://x", apiKey: "k", labels, fetchImpl, deadline: 5_000, now: () => 0 },
      "m",
      [],
      video,
    ).catch((caught) => caught)) as ChatCallError
    expect(error.classified.kind).toBe("time_budget")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("stops retrying a 503 when the deadline is near and says so", async () => {
    let clock = 0
    const fetchImpl = vi.fn(async () => {
      clock += 5_000
      return new Response("busy", { status: 503 })
    })
    const error = (await extractWithChat(
      {
        baseUrl: "https://x",
        apiKey: "k",
        labels,
        fetchImpl,
        deadline: 25_000,
        now: () => clock,
        sleep: async (ms) => void (clock += ms),
      },
      "m",
      [],
      video,
    ).catch((caught) => caught)) as ChatCallError
    expect(error.classified.kind).toBe("time_budget")
    expect(error.classified.message).toMatch(/DeepSeek did not finish .* time limit/)
    expect(fetchImpl.mock.calls.length).toBeLessThan(4)
  })
})

describe("Auto does not start another provider without time left", () => {
  it("records the skipped provider and returns the first provider's error", async () => {
    const failing: VideoExtractionProvider = {
      id: "gemini",
      label: "Gemini",
      keyEnv: "GEMINI_API_KEY",
      needsFrames: false,
      isConfigured: () => true,
      defaultModel: () => "gemini-flash-lite-latest",
      modelChoices: async () => [],
      extract: async () => {
        throw new ProviderError(
          "gemini",
          "gemini-flash-lite-latest",
          {
            kind: "overloaded",
            status: 503,
            retryable: true,
            retryAfterSeconds: null,
            message: "busy",
          },
          4,
        )
      },
    }
    const deepseekExtract = vi.fn()
    const deepseek: VideoExtractionProvider = {
      ...failing,
      id: "deepseek",
      label: "DeepSeek",
      needsFrames: true,
      extract: deepseekExtract,
    }
    const input: ProviderInput = {
      video: null,
      videoMeta: { name: "v.mp4", sizeBytes: 5 * MB, mimeType: "video/mp4" },
      frames: [{ timeSeconds: 1, mimeType: "image/jpeg", base64: "x" }],
      deadline: Date.now() + 1_000, // almost nothing left
    }
    const outcome = await runExtraction([failing, deepseek], "auto", input)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect((outcome.error as ProviderError).provider).toBe("gemini")
    expect(outcome.fallbacks).toEqual([
      expect.objectContaining({ provider: "deepseek", kind: "time_budget" }),
    ])
    expect(deepseekExtract).not.toHaveBeenCalled()
  })
})

describe("Gemini frames request", () => {
  it("labels each inline frame with its timestamp and ends with the frames prompt", () => {
    const parts = geminiFramesParts([
      { timeSeconds: 0.4, mimeType: "image/jpeg", base64: "AAA" },
      { timeSeconds: 65, mimeType: "image/jpeg", base64: "BBB" },
    ])
    expect(parts.slice(0, 4)).toEqual([
      { text: "Frame at 00:00" },
      { inlineData: { mimeType: "image/jpeg", data: "AAA" } },
      { text: "Frame at 01:05" },
      { inlineData: { mimeType: "image/jpeg", data: "BBB" } },
    ])
    const prompt = (parts.at(-1) as { text: string }).text
    expect(prompt).toMatch(/2 still frames/)
    expect(prompt).toMatch(/no audio/)
  })
})
