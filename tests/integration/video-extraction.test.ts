import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { describe, expect, it } from "vitest"
import { requireEnv } from "./helpers"

/**
 * Real Gemini video extraction. Point TEST_VIDEO_PATH (in .env.local) at any
 * short MP4 of a packaged product, then run `npm run test:integration`.
 */
const videoPath = process.env.TEST_VIDEO_PATH?.trim()

describe("AI Product Agent (real Gemini video request)", () => {
  it.skipIf(!videoPath)(
    "extracts schema-valid product attributes from a video",
    async () => {
      requireEnv("GEMINI_API_KEY")
      const { extractProductFromVideo } = await import("@/lib/ai/product-extraction")
      const bytes = readFileSync(videoPath!)
      const video = new File([bytes], basename(videoPath!), { type: "video/mp4" })

      const result = await extractProductFromVideo(video)

      // The result has already passed Zod validation inside extractProductFromVideo.
      expect(result.extraction.video_summary.length).toBeGreaterThan(10)
      expect(JSON.parse(result.rawJson)).toHaveProperty("product_name")
      const found = [
        result.extraction.product_name.value,
        result.extraction.brand.value,
        result.extraction.category.value,
      ].filter(Boolean)
      expect(found.length).toBeGreaterThan(0)
      console.log(
        `Gemini (${result.model}) in ${result.durationMs} ms:`,
        JSON.stringify(
          {
            name: result.extraction.product_name.value,
            brand: result.extraction.brand.value,
            category: result.extraction.category.value,
            mrp: result.extraction.mrp_inr.value,
          },
          null,
          2,
        ),
      )
    },
    300_000,
  )
})
