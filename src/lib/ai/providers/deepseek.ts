import "server-only"
import { isPlausibleDeepSeekKey } from "@/lib/env/schema"
import { serverEnv } from "@/lib/env/server"
import { safeLogText } from "../gemini"
import {
  ChatCallError,
  InvalidModelOutputError,
  extractWithChat,
  framesContent,
} from "./openai-compatible"
import {
  ExtractionFailedError,
  type ProviderInput,
  type ProviderOutput,
  ProviderError,
  type VideoExtractionProvider,
} from "./types"

/**
 * DeepSeek vision via its OpenAI-compatible API (https://api.deepseek.com).
 * DeepSeek takes images, not video, so it receives the representative frames
 * extracted in the browser. Image input is new at DeepSeek and only some
 * models accept it; a text-only model answers "does not support image",
 * which is reported as an unavailable model (and Auto moves on).
 */

const LABELS = { label: "DeepSeek", keyEnv: "DEEPSEEK_API_KEY", modelEnv: "DEEPSEEK_MODEL" }

async function extract({
  videoMeta,
  deadline,
  frames,
  model: requested,
}: ProviderInput): Promise<ProviderOutput> {
  const model = requested ?? serverEnv.DEEPSEEK_MODEL
  if (frames.length === 0) {
    throw new ExtractionFailedError(
      "deepseek",
      model,
      "DeepSeek needs frames from the video, but none were extracted.",
    )
  }
  try {
    const result = await extractWithChat(
      {
        baseUrl: serverEnv.DEEPSEEK_BASE_URL,
        apiKey: serverEnv.DEEPSEEK_API_KEY ?? "",
        labels: LABELS,
        deadline,
      },
      model,
      framesContent(frames),
      videoMeta,
    )
    return { ...result, inputMode: "frames", frameCount: frames.length, notes: [] }
  } catch (error) {
    if (error instanceof ChatCallError) {
      console.error(
        `[DeepSeek] ${model} failed after ${error.attempts} attempt(s):`,
        safeLogText(error.original),
      )
      throw new ProviderError("deepseek", model, error.classified, error.attempts)
    }
    if (error instanceof InvalidModelOutputError) {
      throw new ExtractionFailedError("deepseek", model, `DeepSeek (${model}): ${error.message}`)
    }
    throw error
  }
}

export const deepseekProvider: VideoExtractionProvider = {
  id: "deepseek",
  label: "DeepSeek",
  keyEnv: LABELS.keyEnv,
  needsFrames: true,
  // Only active with a real-looking key: a placeholder never triggers requests.
  isConfigured: () => isPlausibleDeepSeekKey(serverEnv.DEEPSEEK_API_KEY),
  defaultModel: () => serverEnv.DEEPSEEK_MODEL,
  modelChoices: async () => [serverEnv.DEEPSEEK_MODEL],
  extract,
}
