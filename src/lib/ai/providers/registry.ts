import "server-only"
import type { AiProviderId } from "../extraction-schema"
import { deepseekProvider } from "./deepseek"
import { geminiProvider } from "./gemini-provider"
import { ALL_PROVIDERS, AUTO_ORDER } from "./orchestrate"
import { qwenProvider } from "./qwen"
import type { VideoExtractionProvider } from "./types"

/** All video-extraction providers. Auto uses Gemini (primary) → DeepSeek; Qwen is manual-only. */
export const PROVIDERS: readonly VideoExtractionProvider[] = [
  qwenProvider,
  deepseekProvider,
  geminiProvider,
]

export const getProvider = (id: AiProviderId) => PROVIDERS.find((provider) => provider.id === id)!

export type ProviderStatus = {
  id: AiProviderId
  label: string
  configured: boolean
  keyEnv: string
  model: string
  /** Models the UI may offer, default first. */
  models: string[]
  /** Part of the Auto chain (Gemini → DeepSeek). */
  inAuto: boolean
  /** How this provider receives the video. */
  input: string
}

const INPUT_NOTE: Record<AiProviderId, string> = {
  qwen: "Video file (frames if over 7 MB)",
  deepseek: "12 frames extracted in your browser",
  gemini: "Video file via the Gemini Files API",
}

export async function providerStatuses(): Promise<ProviderStatus[]> {
  return Promise.all(
    // Qwen is listed only when a key is set: it is not part of the demo setup.
    ALL_PROVIDERS.filter((id) => id !== "qwen" || getProvider(id).isConfigured()).map(
      async (id) => {
        const provider = getProvider(id)
        const configured = provider.isConfigured()
        return {
          id,
          label: provider.label,
          configured,
          keyEnv: provider.keyEnv,
          model: provider.defaultModel(),
          models: configured ? await provider.modelChoices() : [provider.defaultModel()],
          inAuto: AUTO_ORDER.includes(id),
          input: INPUT_NOTE[id],
        }
      },
    ),
  )
}
