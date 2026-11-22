import { z } from "zod"
import type { AiErrorKind } from "./errors"
import type { AiProviderId, FallbackStep } from "./extraction-schema"
import { MODEL_ID_PATTERN } from "./model-choice"

/**
 * Contract of POST /api/ai/extract-product, shared by the route and the
 * browser. Pure (no server-only imports).
 *
 * - multipart/form-data with a "video" file (and optional "model"): upload + analyse.
 * - application/json RetryRequest: analyse a video that is already uploaded to
 *   Gemini again, so a retry does not re-upload the file.
 */

/** The Gemini Files API copy of the video, kept after a temporary failure. */
export type UploadedVideoRef = {
  /** Gemini file resource name, e.g. "files/abc123". Not a secret. */
  fileName: string
  /** Google deletes uploaded files after 48 hours. */
  expiresAt: string | null
  video: { name: string; sizeBytes: number; mimeType: string }
}

export type ExtractErrorBody = {
  error: string
  code: string
  kind?: AiErrorKind
  /** The provider whose error this is (the last one tried in Auto). */
  provider?: AiProviderId
  providerLabel?: string
  /** Providers tried before this one in Auto, and why each was skipped. */
  fallbacks?: FallbackStep[]
  /** True when trying again later may work (overload, rate limit, network). */
  retryable?: boolean
  retryAfterSeconds?: number | null
  /** How many times SellerOS called the provider (1 + automatic retries). */
  attempts?: number
  model?: string
  /** Other models your key can use for video, best first. */
  suggestedModels?: string[]
  /** Present when the video is still stored at Gemini, so a retry skips the upload. */
  upload?: UploadedVideoRef
}

export const GEMINI_FILE_NAME_PATTERN = /^files\/[a-z0-9-]{1,64}$/

export const retryRequestSchema = z.object({
  fileName: z.string().regex(GEMINI_FILE_NAME_PATTERN, "Not a Gemini file reference."),
  model: z.string().regex(MODEL_ID_PATTERN, "Not a valid model id.").optional(),
  video: z.object({
    name: z.string().min(1).max(255),
    sizeBytes: z.number().int().nonnegative(),
    mimeType: z.string().min(1).max(100),
  }),
})

export type RetryRequest = z.infer<typeof retryRequestSchema>

/** Limits for browser-extracted frames sent with the video (multipart fields "frames" + "frameTimes"). */
export const MAX_FRAMES = 16
export const MAX_FRAME_BYTES = 2 * 1024 * 1024
export const FRAME_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

export const frameTimesSchema = z
  .array(
    z
      .number()
      .nonnegative()
      .max(24 * 3600),
  )
  .max(MAX_FRAMES)

export const providerSelectionSchema = z.enum(["auto", "qwen", "deepseek", "gemini"])

/**
 * Describes the video when only its frames are uploaded (large videos), so
 * the result still records which file was analysed. Multipart field "videoMeta".
 */
export const videoMetaSchema = z.object({
  name: z.string().min(1).max(255),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
  mimeType: z.enum(["video/mp4", "video/quicktime", "video/webm"]),
})
