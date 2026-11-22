import "server-only"
import { serverEnv } from "@/lib/env/server"
import { DEFAULT_QWEN_MODEL } from "@/lib/env/schema"
import type { FallbackStep } from "../extraction-schema"
import { safeLogText } from "../gemini"
import {
  ChatCallError,
  InvalidModelOutputError,
  extractWithChat,
  framesContent,
  videoFileContent,
} from "./openai-compatible"
import {
  ExtractionFailedError,
  type ProviderInput,
  type ProviderOutput,
  ProviderError,
  type VideoExtractionProvider,
} from "./types"

/**
 * Qwen-VL through Alibaba Cloud Model Studio (DashScope), OpenAI-compatible
 * mode. Default region: Singapore (https://dashscope-intl.aliyuncs.com).
 *
 * Video handling: Qwen3-VL accepts a video file directly. Local files go as
 * a Base64 data URL, which Model Studio limits to 10 MB after encoding
 * (≈7 MB original). Larger videos, or videos Qwen rejects (format or
 * duration), are sent as the browser-extracted frames instead.
 */

const LABELS = { label: "Qwen", keyEnv: "QWEN_API_KEY", modelEnv: "QWEN_MODEL" }

/** Largest original file sent as a Base64 data URL (10 MB limit after encoding). */
export const QWEN_DIRECT_VIDEO_MAX_BYTES = 7 * 1024 * 1024

/** Officially supported Qwen3-VL models offered in the UI. */
export const QWEN_MODELS = [DEFAULT_QWEN_MODEL, "qwen3-vl-plus"] as const

const baseConfig = () => ({
  baseUrl: serverEnv.QWEN_BASE_URL,
  apiKey: serverEnv.QWEN_API_KEY ?? "",
  labels: LABELS,
})

// Qwen3-VL Plus/Flash are hybrid thinking models; JSON mode needs thinking off.
const EXTRA = { enable_thinking: false }

function toProviderError(error: ChatCallError, model: string) {
  console.error(
    `[Qwen] ${model} failed after ${error.attempts} attempt(s):`,
    safeLogText(error.original),
  )
  const others = QWEN_MODELS.filter((id) => id !== model)
  return new ProviderError("qwen", model, error.classified, error.attempts, null, [...others])
}

async function extract({
  video,
  videoMeta: meta,
  frames,
  model: requested,
  deadline,
}: ProviderInput): Promise<ProviderOutput> {
  const model = requested ?? serverEnv.QWEN_MODEL
  const notes: FallbackStep[] = []
  const config = () => ({ ...baseConfig(), deadline })

  const viaFrames = async (): Promise<ProviderOutput> => {
    if (frames.length === 0) {
      throw new ExtractionFailedError(
        "qwen",
        model,
        "Qwen could not take this video file, and no frames were extracted in the browser to send instead.",
      )
    }
    const result = await extractWithChat(config(), model, framesContent(frames), meta, EXTRA)
    return { ...result, inputMode: "frames", frameCount: frames.length, notes }
  }

  try {
    if (!video || video.size > QWEN_DIRECT_VIDEO_MAX_BYTES) {
      notes.push({
        provider: "qwen",
        model,
        kind: "video_too_large_for_direct_input",
        message: `The video is too large to send as a file, so Qwen received ${frames.length} frames instead.`,
      })
      return await viaFrames()
    }
    try {
      const base64 = Buffer.from(await video.arrayBuffer()).toString("base64")
      const result = await extractWithChat(
        config(),
        model,
        videoFileContent(video.type, base64),
        meta,
        EXTRA,
      )
      return { ...result, inputMode: "video_file", frameCount: null, notes }
    } catch (error) {
      // Qwen refused the file itself (format, duration, size): use the frames instead.
      if (
        error instanceof ChatCallError &&
        error.classified.kind === "invalid_request" &&
        frames.length
      ) {
        notes.push({
          provider: "qwen",
          model,
          kind: "video_file_rejected",
          message: `Qwen did not accept the video file (${error.classified.message}), so it received ${frames.length} frames instead.`,
        })
        return await viaFrames()
      }
      throw error
    }
  } catch (error) {
    if (error instanceof ChatCallError) throw toProviderError(error, model)
    if (error instanceof InvalidModelOutputError) {
      throw new ExtractionFailedError("qwen", model, `Qwen (${model}): ${error.message}`)
    }
    throw error
  }
}

export const qwenProvider: VideoExtractionProvider = {
  id: "qwen",
  label: "Qwen",
  keyEnv: LABELS.keyEnv,
  needsFrames: false,
  isConfigured: () => Boolean(serverEnv.QWEN_API_KEY),
  defaultModel: () => serverEnv.QWEN_MODEL,
  modelChoices: async () => [...new Set([serverEnv.QWEN_MODEL, ...QWEN_MODELS])],
  extract,
}
