import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { ProviderOutput, VideoFrame } from "@/lib/ai/providers/types"

/**
 * Real requests to each AI provider, one at a time. Each block runs only when
 * that provider's key is in .env.local, and passes only if the provider
 * answers and the attributes pass the SellerOS extraction schema.
 *
 * Fixture: a synthetic 4-second label video ("SPICE VALLEY Kashmiri Red Chilli
 * Powder, Net Wt. 200 g, MRP Rs. 120") and 12 frames taken from it.
 */

const fixtures = join(process.cwd(), "tests", "fixtures")
const video = () =>
  new File([readFileSync(join(fixtures, "synthetic-label.webm"))], "synthetic-label.webm", {
    type: "video/webm",
  })
const frames = (): VideoFrame[] =>
  readdirSync(join(fixtures, "frames"))
    .filter((name) => name.endsWith(".jpg"))
    .sort()
    .map((name) => ({
      timeSeconds: Number(name.match(/-(\d+(?:\.\d+)?)s\.jpg$/)![1]),
      mimeType: "image/jpeg",
      base64: readFileSync(join(fixtures, "frames", name)).toString("base64"),
    }))

const META = { name: "synthetic-label.webm", sizeBytes: 114_881, mimeType: "video/webm" }
const has = (name: string) => Boolean(process.env[name]?.trim())

/** The label is unambiguous, so a working vision model must read these. */
function expectLabelRead(result: ProviderOutput) {
  const { extraction } = result
  console.log(
    `${result.model} (${result.inputMode}${result.frameCount ? `, ${result.frameCount} frames` : ""}) in ${result.durationMs} ms, ${result.usage.totalTokens ?? "?"} tokens:`,
    JSON.stringify({
      brand: extraction.brand.value,
      name: extraction.product_name.value,
      category: extraction.category.value,
      mrp: extraction.mrp_inr.value,
      weight: extraction.net_weight_grams.value,
      notes: result.notes.map((note) => note.kind),
    }),
  )
  expect(extraction.brand.value?.toLowerCase()).toContain("spice valley")
  expect(extraction.mrp_inr.value).toBe(120)
  expect(extraction.net_weight_grams.value).toBe(200)
}

const TIMEOUT = 300_000

describe.skipIf(!has("QWEN_API_KEY"))("Qwen (real Model Studio request)", () => {
  it(
    "reads the video file directly (or falls back to frames) with QWEN_MODEL",
    async () => {
      const { qwenProvider } = await import("@/lib/ai/providers/qwen")
      expectLabelRead(
        await qwenProvider.extract({ video: video(), videoMeta: META, frames: frames() }),
      )
    },
    TIMEOUT,
  )

  it(
    "reads browser-style frames (the path used for videos over 7 MB)",
    async () => {
      const { serverEnv } = await import("@/lib/env/server")
      const { extractWithChat, framesContent } =
        await import("@/lib/ai/providers/openai-compatible")
      const result = await extractWithChat(
        {
          baseUrl: serverEnv.QWEN_BASE_URL,
          apiKey: serverEnv.QWEN_API_KEY!,
          labels: { label: "Qwen", keyEnv: "QWEN_API_KEY", modelEnv: "QWEN_MODEL" },
        },
        serverEnv.QWEN_MODEL,
        framesContent(frames()),
        { name: "synthetic-label.webm", sizeBytes: 1, mimeType: "video/webm" },
        { enable_thinking: false },
      )
      expectLabelRead({ ...result, inputMode: "frames", frameCount: 12, notes: [] })
    },
    TIMEOUT,
  )
})

describe.skipIf(!has("DEEPSEEK_API_KEY"))("DeepSeek (real vision request with frames)", () => {
  it(
    "reads 12 frames with DEEPSEEK_MODEL",
    async () => {
      const { deepseekProvider } = await import("@/lib/ai/providers/deepseek")
      expectLabelRead(
        await deepseekProvider.extract({ video: video(), videoMeta: META, frames: frames() }),
      )
    },
    TIMEOUT,
  )
})

describe.skipIf(!has("GEMINI_API_KEY"))("Gemini through the provider adapter", () => {
  it(
    "reads the video file with GEMINI_MODEL",
    async () => {
      const { geminiProvider } = await import("@/lib/ai/providers/gemini-provider")
      expectLabelRead(await geminiProvider.extract({ video: video(), videoMeta: META, frames: [] }))
    },
    TIMEOUT,
  )

  it(
    "reads frames only (the path for videos over 4 MB), within the request time budget",
    async () => {
      const { geminiProvider } = await import("@/lib/ai/providers/gemini-provider")
      const { requestDeadline } = await import("@/lib/ai/retry")
      const result = await geminiProvider.extract({
        video: null,
        videoMeta: { name: "phone-clip.mp4", sizeBytes: 25 * 1024 * 1024, mimeType: "video/mp4" },
        frames: frames(),
        deadline: requestDeadline(),
      })
      expect(result).toMatchObject({ inputMode: "frames", frameCount: 12 })
      expect(result.video.name).toBe("phone-clip.mp4")
      expectLabelRead(result)
    },
    TIMEOUT,
  )
})
