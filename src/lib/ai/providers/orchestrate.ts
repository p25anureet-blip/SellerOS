import type { AiErrorKind } from "../errors"
import { isOutOfTime } from "../retry"
import type { AiProviderId, ExtractionResponse, FallbackStep } from "../extraction-schema"
import {
  ExtractionFailedError,
  type ProviderInput,
  ProviderError,
  ProviderNotConfiguredError,
  type VideoExtractionProvider,
} from "./types"

/**
 * Chooses which provider handles a video. Pure (providers are passed in), so
 * the fallback rules are unit-tested with fake providers.
 *
 * Auto tries Gemini → DeepSeek (Qwen is manual-only). It moves on only for problems that
 * another provider can fix: quota, credits, an unavailable model, outages and
 * network errors. A rejected API key, a malformed request or an invalid
 * answer stops immediately, so a configuration mistake is never hidden.
 */

export const AUTO_ORDER: readonly AiProviderId[] = ["gemini", "deepseek"]

/** Every provider, in the order the UI lists them. Qwen stays available for manual use. */
export const ALL_PROVIDERS: readonly AiProviderId[] = ["gemini", "deepseek", "qwen"]

export type ProviderSelection = "auto" | AiProviderId

export const PROVIDER_SELECTIONS: readonly ProviderSelection[] = ["auto", ...ALL_PROVIDERS]

export const FALLBACK_KINDS: ReadonlySet<AiErrorKind> = new Set<AiErrorKind>([
  "quota",
  "insufficient_credits",
  "model_unavailable",
  "overloaded",
  "server_error",
  "network",
])

export type RunOutcome =
  | { ok: true; response: ExtractionResponse }
  | { ok: false; error: unknown; fallbacks: FallbackStep[] }

export async function runExtraction(
  providers: readonly VideoExtractionProvider[],
  selection: ProviderSelection,
  input: ProviderInput,
): Promise<RunOutcome> {
  const byId = new Map(providers.map((provider) => [provider.id, provider]))
  const fallbacks: FallbackStep[] = []

  const attempt = async (
    provider: VideoExtractionProvider,
    model?: string,
  ): Promise<RunOutcome> => {
    const output = await provider.extract({ ...input, model })
    const { notes, ...result } = output
    return {
      ok: true,
      response: {
        ...result,
        provider: provider.id,
        providerLabel: provider.label,
        fallbacks: [...fallbacks, ...notes],
      },
    }
  }

  if (selection !== "auto") {
    const provider = byId.get(selection)
    if (!provider?.isConfigured()) {
      return { ok: false, error: new ProviderNotConfiguredError([selection]), fallbacks }
    }
    if (provider.needsFrames && input.frames.length === 0) {
      return {
        ok: false,
        error: new ExtractionFailedError(
          provider.id,
          input.model ?? provider.defaultModel(),
          `${provider.label} reads frames from the video, but no frames could be extracted in the browser. Try another browser or a different video format.`,
        ),
        fallbacks,
      }
    }
    try {
      return await attempt(provider, input.model)
    } catch (error) {
      return { ok: false, error, fallbacks }
    }
  }

  const order = AUTO_ORDER.map((id) => byId.get(id)).filter(
    (provider): provider is VideoExtractionProvider => Boolean(provider),
  )
  if (!order.some((provider) => provider.isConfigured())) {
    return { ok: false, error: new ProviderNotConfiguredError([...AUTO_ORDER]), fallbacks }
  }

  let lastError: unknown = null
  for (const provider of order) {
    const model = provider.defaultModel()
    // Never start another provider without time left in this request (Vercel: 300 s).
    if (lastError && provider.isConfigured() && isOutOfTime(input.deadline)) {
      fallbacks.push({
        provider: provider.id,
        model,
        kind: "time_budget",
        message: "Not tried: no time left in this request.",
      })
      break
    }
    if (!provider.isConfigured()) {
      fallbacks.push({
        provider: provider.id,
        model,
        kind: "not_configured",
        message: `${provider.keyEnv} is not set.`,
      })
      continue
    }
    if (provider.needsFrames && input.frames.length === 0) {
      fallbacks.push({
        provider: provider.id,
        model,
        kind: "no_frames",
        message: "No frames could be extracted from the video in the browser.",
      })
      continue
    }
    try {
      // In Auto every provider uses its own configured model.
      return await attempt(provider)
    } catch (error) {
      if (error instanceof ProviderError && FALLBACK_KINDS.has(error.kind)) {
        fallbacks.push({
          provider: provider.id,
          model: error.model,
          kind: error.kind,
          message: error.message,
        })
        lastError = error
        continue
      }
      // Invalid key, malformed request or invalid answer: stop and show it.
      return { ok: false, error, fallbacks }
    }
  }
  // Every configured provider failed: report the last error itself, and the earlier ones as the trail.
  const lastIndex = fallbacks.findLastIndex(
    (step) => !["not_configured", "no_frames", "time_budget"].includes(step.kind),
  )
  return {
    ok: false,
    error: lastError,
    fallbacks: fallbacks.filter((_, index) => index !== lastIndex),
  }
}
