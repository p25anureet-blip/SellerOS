import { z } from "zod"
import { CATEGORY_CODES } from "@/lib/catalog/product"

/**
 * Shape of the structured JSON Gemini must return for a product video.
 * Kept free of server-only imports so the review screen can share the types.
 *
 * Every attribute carries the model's confidence (0–1) and the evidence it
 * used, e.g. "00:07 – front label reads 'Net Wt. 200 g'". `value` is null when
 * the information is not visible: the model is told never to guess.
 */

const field = <T extends z.ZodType>(value: T) =>
  z.object({
    value: value.nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string(),
  })

export const extractionSchema = z.object({
  product_name: field(z.string()),
  brand: field(z.string()),
  category: field(z.enum(CATEGORY_CODES)),
  description: field(z.string()),
  ingredients: field(z.string()),
  manufacturer: field(z.string()),
  net_weight_grams: field(z.number()),
  mrp_inr: field(z.number()),
  length_cm: field(z.number()),
  width_cm: field(z.number()),
  height_cm: field(z.number()),
  color: field(z.string()),
  additional_attributes: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      confidence: z.number().min(0).max(1),
      evidence: z.string(),
    }),
  ),
  video_summary: z.string(),
  quality_warnings: z.array(z.string()),
})

export type ProductExtraction = z.infer<typeof extractionSchema>
export type ExtractionField = keyof Omit<
  ProductExtraction,
  "additional_attributes" | "video_summary" | "quality_warnings"
>

export type AiProviderId = "qwen" | "deepseek" | "gemini"

/** What the selected provider actually received. */
export type VideoInputMode = "video_file" | "frames"

/** One provider that was tried before the one that answered (Auto mode). */
export type FallbackStep = {
  provider: AiProviderId
  model: string
  /** Error category, e.g. "quota", or "not_configured" when skipped. */
  kind: string
  message: string
}

/** The answer of POST /api/ai/extract-product: one provider's result plus how it was obtained. */
export type ExtractionResponse = ExtractionResult & {
  provider: AiProviderId
  providerLabel: string
  inputMode: VideoInputMode
  /** Frames sent (frames mode only). */
  frameCount: number | null
  /** Providers tried first and why they were skipped (empty when the first one answered). */
  fallbacks: FallbackStep[]
}

/** One provider's validated extraction. */
export type ExtractionResult = {
  extraction: ProductExtraction
  /** Exactly what Gemini returned, for the "raw JSON" view. */
  rawJson: string
  model: string
  durationMs: number
  /** Calls to generateContent, including automatic retries after a 503. */
  attempts: number
  usage: { promptTokens: number | null; outputTokens: number | null; totalTokens: number | null }
  video: { name: string; sizeBytes: number; mimeType: string }
}

export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024
