import { type ClassifiedGeminiError, redactSecrets, timeBudgetError } from "../errors"
import { type ExtractionResult, extractionSchema } from "../extraction-schema"
import { formatTimestamp, jsonPrompt } from "../prompt"
import {
  MAX_GEMINI_RETRIES,
  RetriesExhaustedError,
  TimeBudgetExceededError,
  isOutOfTime,
  timeoutWithin,
  withRetry,
} from "../retry"
import type { VideoFrame } from "./types"

/**
 * A small client for OpenAI-compatible Chat Completions APIs, used by both
 * Qwen (Alibaba Cloud Model Studio, compatible-mode) and DeepSeek. Plain
 * fetch, no SDK. The pure builders and classifiers are unit-tested; the API
 * key is passed in and never logged.
 */

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } }

export type ChatUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

/** Message content for a whole video file sent as a Base64 data URL (Qwen-VL). */
export function videoFileContent(mimeType: string, base64: string): ChatContentPart[] {
  return [
    { type: "video_url", video_url: { url: `data:${mimeType};base64,${base64}` } },
    { type: "text", text: jsonPrompt("video_file") },
  ]
}

/** Message content for frames sent as images, each labelled with its timestamp. */
export function framesContent(frames: readonly VideoFrame[]): ChatContentPart[] {
  const parts: ChatContentPart[] = []
  for (const frame of frames) {
    parts.push({ type: "text", text: `Frame at ${formatTimestamp(frame.timeSeconds)}` })
    parts.push({
      type: "image_url",
      image_url: { url: `data:${frame.mimeType};base64,${frame.base64}` },
    })
  }
  parts.push({
    type: "text",
    text: jsonPrompt(
      "frames",
      frames.map((frame) => frame.timeSeconds),
    ),
  })
  return parts
}

export function chatBody(
  model: string,
  content: ChatContentPart[],
  { jsonMode = true, extra = {} }: { jsonMode?: boolean; extra?: Record<string, unknown> } = {},
) {
  return {
    model,
    messages: [{ role: "user", content }],
    temperature: 0.2,
    max_tokens: 4096,
    stream: false,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    ...extra,
  }
}

/** A non-2xx HTTP answer. */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodyText: string,
    readonly retryAfterSeconds: number | null,
  ) {
    super(`HTTP ${status}`)
    this.name = "ProviderHttpError"
  }
}

type ErrorBody = { message: string; code: string }

function readErrorBody(text: string): ErrorBody {
  try {
    const json = JSON.parse(text) as {
      error?: { message?: string; code?: string | number; type?: string }
      message?: string
      code?: string
    }
    return {
      message: json.error?.message ?? json.message ?? text,
      code: String(json.error?.code ?? json.error?.type ?? json.code ?? ""),
    }
  } catch {
    return { message: text, code: "" }
  }
}

export type ProviderLabels = { label: string; keyEnv: string; modelEnv: string }

/** Maps an HTTP / network failure from Qwen or DeepSeek onto the shared error categories. */
export function classifyProviderError(
  error: unknown,
  { label, keyEnv, modelEnv }: ProviderLabels,
  secrets: readonly string[] = [],
): ClassifiedGeminiError {
  const base = { retryable: false, retryAfterSeconds: null as number | null }
  if (!(error instanceof ProviderHttpError)) {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    const timeout = /timeout|aborted/i.test(text)
    return {
      ...base,
      kind: "network",
      status: null,
      message: timeout
        ? `${label} did not answer in time (timeout).`
        : `Could not reach the ${label} API (${redactSecrets(text, secrets).slice(0, 120)}).`,
    }
  }

  const { status } = error
  const { message: raw, code } = readErrorBody(error.bodyText)
  const detail = redactSecrets(`${code ? `${code}: ` : ""}${raw}`, secrets).slice(0, 240)
  const all = `${code} ${raw}`

  if (status === 401 || /InvalidApiKey|invalid_api_key|authentication/i.test(all)) {
    return {
      ...base,
      kind: "auth",
      status,
      message: `${label} rejected the API key (HTTP ${status}). Check ${keyEnv} in .env.local (keys are region-specific) and restart the server.`,
    }
  }
  if (status === 402 || /insufficient.?balance|Arrearage|good standing|overdue/i.test(all)) {
    return {
      ...base,
      kind: "insufficient_credits",
      status,
      message: `${label} account has no credit left or a payment is overdue (HTTP ${status}). Top up the balance in the ${label} console. (${detail})`,
    }
  }
  if (status === 429) {
    const freeQuota = /insufficient_quota|AllocationQuota|free ?tier|free quota|quota/i.test(all)
    return {
      ...base,
      kind: "quota",
      status,
      retryAfterSeconds: error.retryAfterSeconds,
      message: freeQuota
        ? `${label} quota for this key or model is used up (HTTP 429). (${detail})`
        : `${label} rate limit reached (HTTP 429): too many requests right now.${error.retryAfterSeconds ? ` Wait about ${error.retryAfterSeconds} s.` : ""}`,
    }
  }
  if (
    status === 404 ||
    /ModelNotFound|model_not_found|Model not exist|does not support (image|video)|not support(ed)? (image|video)|Model\.AccessDenied|not activated|model .*not (found|exist)/i.test(
      all,
    )
  ) {
    return {
      ...base,
      kind: "model_unavailable",
      status,
      message: `The ${label} model is not available to this key or cannot read this input (HTTP ${status}). Check ${modelEnv} in .env.local. (${detail})`,
    }
  }
  if (status === 403) {
    return {
      ...base,
      kind: "auth",
      status,
      message: `${label} denied access (HTTP 403). Check ${keyEnv} and that the model is activated for your account. (${detail})`,
    }
  }
  if (status === 503) {
    return {
      ...base,
      kind: "overloaded",
      status,
      retryable: true,
      message: `${label} is temporarily overloaded (HTTP 503).`,
    }
  }
  if (status >= 500) {
    return {
      ...base,
      kind: "server_error",
      status,
      retryable: true,
      message: `${label} had a temporary server error (HTTP ${status}).`,
    }
  }
  if (status === 400 || status === 413 || status === 422) {
    return {
      ...base,
      kind: "invalid_request",
      status,
      message: `${label} rejected the request (HTTP ${status}): ${detail}`,
    }
  }
  return {
    ...base,
    kind: "unknown",
    status,
    message: `${label} request failed (HTTP ${status}): ${detail}`,
  }
}

/** True when a 400 says JSON mode (response_format) is not supported for this model. */
export function isJsonModeUnsupported(error: unknown): boolean {
  return (
    error instanceof ProviderHttpError &&
    error.status === 400 &&
    /response_format|json mode|json_object/i.test(error.bodyText)
  )
}

/** Thrown when the model's answer is not valid JSON matching the extraction schema. */
export class InvalidModelOutputError extends Error {}

/** Accepts plain JSON or JSON wrapped in a ```json fence; validates against extractionSchema. */
export function parseExtraction(text: string) {
  let candidate = text.trim()
  const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) candidate = fenced[1]
  let json: unknown
  try {
    json = JSON.parse(candidate)
  } catch {
    throw new InvalidModelOutputError("The model returned text that is not valid JSON.")
  }
  const parsed = extractionSchema.safeParse(json)
  if (!parsed.success) {
    const problem = parsed.error.issues[0]
    throw new InvalidModelOutputError(
      `The model's JSON did not match the SellerOS extraction schema (${problem.path.join(".") || "root"}: ${problem.message}).`,
    )
  }
  return { extraction: parsed.data, rawJson: JSON.stringify(json, null, 2) }
}

export type ChatClientConfig = {
  baseUrl: string
  apiKey: string
  labels: ProviderLabels
  timeoutMs?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Epoch ms: no call or retry starts after this, and calls are cut off at it. */
  deadline?: number
  now?: () => number
}

type ChatResponse = {
  model?: string
  choices?: { message?: { content?: string | null }; finish_reason?: string }[]
  usage?: ChatUsage
}

async function postOnce(config: ChatClientConfig, body: unknown): Promise<ChatResponse> {
  const response = await (config.fetchImpl ?? fetch)(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutWithin(config.timeoutMs ?? 180_000, config.deadline)),
  })
  const text = await response.text()
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"))
    throw new ProviderHttpError(
      response.status,
      text,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    )
  }
  try {
    return JSON.parse(text) as ChatResponse
  } catch {
    throw new InvalidModelOutputError("The API returned a response that is not JSON.")
  }
}

/** Raised after retries are exhausted, carrying the classified error and attempt count. */
export class ChatCallError extends Error {
  constructor(
    readonly classified: ClassifiedGeminiError,
    readonly attempts: number,
    readonly original: unknown,
  ) {
    super(classified.message)
    this.name = "ChatCallError"
  }
}

/**
 * Sends one extraction request with bounded 503/5xx retries. If the model does
 * not support JSON mode, retries once without it (the prompt still demands
 * JSON and the answer is still schema-validated).
 */
export async function extractWithChat(
  config: ChatClientConfig,
  model: string,
  content: ChatContentPart[],
  video: ExtractionResult["video"],
  extra: Record<string, unknown> = {},
): Promise<ExtractionResult> {
  const started = performance.now()
  const classify = (error: unknown) => classifyProviderError(error, config.labels, [config.apiKey])
  let jsonMode = true
  let attempts = 0

  const outOfTime = () =>
    new ChatCallError(
      timeBudgetError(config.labels.label, "analysing the video", "frames"),
      Math.max(1, attempts),
      new TimeBudgetExceededError(config.labels.label),
    )

  for (;;) {
    if (isOutOfTime(config.deadline, config.now?.())) throw outOfTime()
    try {
      const { value, attempts: used } = await withRetry(
        () => postOnce(config, chatBody(model, content, { jsonMode, extra })),
        {
          maxRetries: MAX_GEMINI_RETRIES,
          shouldRetry: (error) => classify(error).retryable,
          sleep: config.sleep,
          deadline: config.deadline,
          now: config.now,
          onRetry: ({ retry, delayMs, error }) =>
            console.warn(
              `[${config.labels.label}] ${classify(error).kind} (HTTP ${classify(error).status ?? "?"}), retry ${retry}/${MAX_GEMINI_RETRIES} in ${delayMs} ms`,
            ),
        },
      )
      attempts += used
      const choice = value.choices?.[0]
      const text = choice?.message?.content?.trim() ?? ""
      if (!text) throw new InvalidModelOutputError("The model returned an empty answer.")
      if (choice?.finish_reason === "length") {
        throw new InvalidModelOutputError("The model's answer was cut off (output token limit).")
      }
      const { extraction, rawJson } = parseExtraction(text)
      return {
        extraction,
        rawJson,
        model: value.model ?? model,
        durationMs: Math.round(performance.now() - started),
        attempts,
        usage: {
          promptTokens: value.usage?.prompt_tokens ?? null,
          outputTokens: value.usage?.completion_tokens ?? null,
          totalTokens: value.usage?.total_tokens ?? null,
        },
        video,
      }
    } catch (caught) {
      if (caught instanceof InvalidModelOutputError) throw caught
      const error = caught instanceof RetriesExhaustedError ? caught.lastError : caught
      const used = caught instanceof RetriesExhaustedError ? caught.attempts : 1
      attempts += used
      if (jsonMode && isJsonModeUnsupported(error)) {
        jsonMode = false
        continue
      }
      // Stopped by the request deadline (no time for a retry, or a call cut short): say so.
      const timedOut =
        (caught instanceof RetriesExhaustedError && caught.outOfTime) ||
        (classify(error).kind === "network" && isOutOfTime(config.deadline, config.now?.()))
      if (timedOut) throw outOfTime()
      throw new ChatCallError(classify(error), attempts, error)
    }
  }
}
