import "server-only"
import { GoogleGenAI } from "@google/genai"
import { aiSecrets, serverEnv } from "@/lib/env/server"
import { type ClassifiedGeminiError, classifyGeminiError, redactSecrets } from "./errors"
import { modelId, suggestAlternativeModels } from "./model-choice"
import { RetriesExhaustedError, withRetry } from "./retry"

let client: GoogleGenAI | undefined

/** Shown whenever an AI feature is used without a key. Never replaced by fake output. */
export const GEMINI_SETUP_MESSAGE =
  "GEMINI_API_KEY is not set. Create a key at https://aistudio.google.com (Get API key → " +
  "Create API key), add GEMINI_API_KEY=<your key> to .env.local, then restart `npm run dev`."

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super(GEMINI_SETUP_MESSAGE)
    this.name = "GeminiNotConfiguredError"
  }
}

export function isGeminiConfigured(): boolean {
  return Boolean(serverEnv.GEMINI_API_KEY)
}

/** Shared Gemini client. Server-only, so the API key never reaches the browser. */
export function getGemini(): GoogleGenAI {
  if (!serverEnv.GEMINI_API_KEY) throw new GeminiNotConfiguredError()
  // No SDK-level retries: SellerOS retries itself (lib/ai/retry.ts) so the policy is visible and bounded.
  client ??= new GoogleGenAI({ apiKey: serverEnv.GEMINI_API_KEY })
  return client
}

/** The model from GEMINI_MODEL in .env.local (default gemini-flash-lite-latest). */
export function defaultModel(): string {
  return modelId(serverEnv.GEMINI_MODEL)
}

/** Classifies an SDK error with the API key redacted from every message. */
export function classifyError(error: unknown): ClassifiedGeminiError {
  return classifyGeminiError(error, aiSecrets())
}

/** Redacts the API key from anything about to be logged. */
export function safeLogText(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return redactSecrets(text, aiSecrets()).slice(0, 500)
}

const MODEL_CACHE_MS = 10 * 60_000
let modelCache: { at: number; ids: string[] } | undefined

/**
 * Models this API key can call with generateContent, from the official SDK's
 * models.list(). Cached for 10 minutes; returns null if listing fails.
 */
export async function listAvailableModels(): Promise<string[] | null> {
  if (!isGeminiConfigured()) return null
  if (modelCache && Date.now() - modelCache.at < MODEL_CACHE_MS) return modelCache.ids
  try {
    const ids: string[] = []
    const pager = await getGemini().models.list({
      config: { pageSize: 100, httpOptions: { timeout: 15_000 } },
    })
    for await (const model of pager) {
      if (model.name && model.supportedActions?.includes("generateContent")) {
        ids.push(modelId(model.name))
      }
    }
    ids.sort()
    modelCache = { at: Date.now(), ids }
    return ids
  } catch (error) {
    console.warn("[gemini] could not list models:", safeLogText(error))
    return null
  }
}

export type ModelAvailability = {
  model: string
  /** null when the model list could not be fetched. */
  available: boolean | null
  suggestedModels: string[]
}

export async function checkModelAvailability(model = defaultModel()): Promise<ModelAvailability> {
  const ids = await listAvailableModels()
  if (!ids) return { model, available: null, suggestedModels: [] }
  return {
    model,
    available: ids.includes(modelId(model)),
    suggestedModels: suggestAlternativeModels(model, ids),
  }
}

export type GeminiCheckResult =
  | {
      ok: true
      model: string
      reply: string
      latencyMs: number
      totalTokens: number | null
    }
  | { ok: false; model: string; error: string }

const PING_PROMPT =
  "You are the AI engine of SellerOS, a product-management tool for Indian online sellers. " +
  "In one short sentence, confirm you are online and name one product attribute you could " +
  "extract from a product video."

/** Makes one small, real request to Gemini to prove the key, model and quota work. */
export async function checkGeminiConnection(): Promise<GeminiCheckResult> {
  const model = defaultModel()
  if (!isGeminiConfigured()) return { ok: false, model, error: GEMINI_SETUP_MESSAGE }
  const started = performance.now()

  try {
    const { value: response } = await withRetry(
      () =>
        getGemini().models.generateContent({
          model,
          contents: PING_PROMPT,
          // Generous cap: "thinking" models spend part of this budget before replying.
          config: { maxOutputTokens: 1024, httpOptions: { timeout: 30_000 } },
        }),
      { shouldRetry: (error) => classifyError(error).retryable },
    )
    const reply = response.text?.trim()
    if (!reply) {
      return { ok: false, model, error: "Gemini returned an empty response." }
    }
    return {
      ok: true,
      model,
      reply,
      latencyMs: Math.round(performance.now() - started),
      totalTokens: response.usageMetadata?.totalTokenCount ?? null,
    }
  } catch (caught) {
    const error = caught instanceof RetriesExhaustedError ? caught.lastError : caught
    const classified = classifyError(error)
    let message = classified.message
    if (classified.kind === "model_unavailable" || classified.kind === "overloaded") {
      const { suggestedModels } = await checkModelAvailability(model)
      if (suggestedModels.length)
        message += ` Models your key can use: ${suggestedModels.join(", ")}.`
    }
    return { ok: false, model, error: message }
  }
}
