import "server-only"
import type { UploadedVideoRef } from "../extraction-api"
import type { ExtractionResult } from "../extraction-schema"
import {
  checkModelAvailability,
  defaultModel,
  isGeminiConfigured,
  listAvailableModels,
} from "../gemini"
import {
  ExtractionError,
  GeminiCallError,
  extractProductFromFrames,
  extractProductFromVideo,
  retryExtraction,
} from "../product-extraction"
import {
  ExtractionFailedError,
  type ProviderInput,
  type ProviderOutput,
  ProviderError,
  type VideoExtractionProvider,
} from "./types"

/**
 * Adapter around the Gemini integration (lib/ai/product-extraction.ts).
 * Two paths:
 * - video file (≤ 4 MB): Files API upload, 503 backoff, kept uploads for retry;
 * - frames (larger videos): ~12 browser-extracted frames as inline images.
 */

async function wrap(
  model: string,
  frameCount: number | null,
  run: () => Promise<ExtractionResult>,
): Promise<ProviderOutput> {
  try {
    const result = await run()
    return {
      ...result,
      inputMode: frameCount === null ? "video_file" : "frames",
      frameCount,
      notes: [],
    }
  } catch (error) {
    if (error instanceof GeminiCallError) {
      const { suggestedModels } =
        error.classified.kind === "time_budget"
          ? { suggestedModels: [] }
          : await checkModelAvailability(error.model)
      throw new ProviderError(
        "gemini",
        error.model,
        error.classified,
        error.attempts,
        error.upload,
        suggestedModels,
      )
    }
    if (error instanceof ExtractionError) {
      throw new ExtractionFailedError("gemini", model, error.message)
    }
    throw error
  }
}

export const geminiProvider: VideoExtractionProvider = {
  id: "gemini",
  label: "Gemini",
  keyEnv: "GEMINI_API_KEY",
  needsFrames: false,
  isConfigured: isGeminiConfigured,
  defaultModel,
  modelChoices: async () => {
    const { suggestedModels } = await checkModelAvailability()
    return [defaultModel(), ...suggestedModels]
  },
  extract: ({ video, videoMeta, frames, model = defaultModel(), deadline }: ProviderInput) => {
    if (video) return wrap(model, null, () => extractProductFromVideo(video, model, { deadline }))
    if (frames.length === 0) {
      throw new ExtractionFailedError(
        "gemini",
        model,
        "Neither the video nor frames from it were received. Please choose the video again.",
      )
    }
    return wrap(model, frames.length, () =>
      extractProductFromFrames(frames, videoMeta, model, { deadline }),
    )
  },
}

/** Re-analyse a video still stored at Gemini, without uploading it again. */
export function retryGeminiUpload(
  fileName: string,
  video: UploadedVideoRef["video"],
  model = defaultModel(),
  deadline?: number,
) {
  return wrap(model, null, () => retryExtraction(fileName, video, model, { deadline }))
}

/** A Gemini model chosen in the UI must be one this key can use. */
export async function isAllowedGeminiModel(model: string) {
  if (model === defaultModel()) return true
  const available = await listAvailableModels()
  return available ? available.includes(model) : false
}
