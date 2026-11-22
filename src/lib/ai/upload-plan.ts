import type { AiProviderId } from "./extraction-schema"

/**
 * Decides what the browser sends to POST /api/ai/extract-product so the
 * request always fits Vercel's 4.5 MB function body limit. Pure (no React,
 * no browser APIs), so the rules are unit-tested.
 *
 * - Videos up to 4 MB are sent as the file itself ("video" path): Gemini
 *   watches the whole video, including audio.
 * - Larger videos are never uploaded. The browser sends ~12 sharp frames
 *   instead (≈0.5–1.5 MB total) and the provider reads them as images
 *   ("frames" path).
 */

/** Vercel Functions reject request bodies above 4.5 MB (413 FUNCTION_PAYLOAD_TOO_LARGE). */
export const VERCEL_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024
/** Largest video sent as a file. The rest of the 4.5 MB is headroom for form fields. */
export const DIRECT_VIDEO_MAX_BYTES = 4 * 1024 * 1024
/** Multipart boundary + headers per form part (generous estimate). */
export const MULTIPART_PART_OVERHEAD_BYTES = 512

export type UploadSelection = "auto" | AiProviderId

export type UploadPlan = {
  /** Send the video file itself. */
  sendVideo: boolean
  /** Extract frames in the browser (to send instead of, or alongside, the video). */
  wantFrames: boolean
  /** Why the video is not sent, for the UI. */
  reason: "fits" | "too_large" | "frames_provider"
}

/**
 * @param autoChain configured providers in Auto order (Auto mode only).
 */
export function planUpload(
  videoBytes: number,
  selection: UploadSelection,
  autoChain: readonly AiProviderId[] = [],
): UploadPlan {
  if (videoBytes > DIRECT_VIDEO_MAX_BYTES) {
    return { sendVideo: false, wantFrames: true, reason: "too_large" }
  }
  if (selection === "deepseek") {
    return { sendVideo: false, wantFrames: true, reason: "frames_provider" }
  }
  if (selection === "gemini") return { sendVideo: true, wantFrames: false, reason: "fits" }
  // Qwen reads the file and falls back to frames if it rejects it.
  if (selection === "qwen") return { sendVideo: true, wantFrames: true, reason: "fits" }
  // Auto: the file for Gemini/Qwen, frames only if a frame-reading fallback (DeepSeek) is configured.
  const readsVideo = autoChain.some((id) => id === "gemini" || id === "qwen")
  return {
    sendVideo: readsVideo,
    wantFrames: !readsVideo || autoChain.some((id) => id !== "gemini"),
    reason: readsVideo ? "fits" : "frames_provider",
  }
}

/** Approximate multipart body size for a video (or none) plus frames and small fields. */
export function estimateRequestBytes(videoBytes: number | null, frameBytes: readonly number[]) {
  const fields = 4 * MULTIPART_PART_OVERHEAD_BYTES + 2_048 // provider, model, frameTimes, videoMeta
  const video = videoBytes === null ? 0 : videoBytes + MULTIPART_PART_OVERHEAD_BYTES
  const frames = frameBytes.reduce((sum, size) => sum + size + MULTIPART_PART_OVERHEAD_BYTES, 0)
  return fields + video + frames
}

export type PayloadDecision =
  | { ok: true; includeVideo: boolean; includeFrames: boolean; bytes: number }
  | { ok: false; bytes: number }

/**
 * Final check before sending. If video + frames would be too big, the frames
 * (only needed for a fallback provider) are dropped so the primary path still
 * works. Frames-only requests that are still too big are refused.
 */
export function fitPayload(
  plan: UploadPlan,
  videoBytes: number,
  frameBytes: readonly number[],
  limit = VERCEL_BODY_LIMIT_BYTES,
): PayloadDecision {
  const includeFrames = plan.wantFrames && frameBytes.length > 0
  const frames = includeFrames ? frameBytes : []
  const full = estimateRequestBytes(plan.sendVideo ? videoBytes : null, frames)
  if (full <= limit) return { ok: true, includeVideo: plan.sendVideo, includeFrames, bytes: full }
  if (plan.sendVideo && includeFrames) {
    const videoOnly = estimateRequestBytes(videoBytes, [])
    if (videoOnly <= limit) {
      return { ok: true, includeVideo: true, includeFrames: false, bytes: videoOnly }
    }
  }
  return { ok: false, bytes: full }
}

export const formatMegabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
