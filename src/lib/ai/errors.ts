/**
 * Classifies Gemini SDK errors so callers can decide whether to retry and can
 * show a message a seller (or developer) can act on. Pure: no SDK import, so
 * it is unit-testable and safe to share.
 */

export type GeminiErrorKind =
  /** 503 UNAVAILABLE: Google is short of capacity for this model. Temporary. */
  | "overloaded"
  /** 500 / 502 / 504: other temporary server-side failures. */
  | "server_error"
  /** 429 RESOURCE_EXHAUSTED: your key's rate limit or daily quota. Not fixed by retrying now. */
  | "quota"
  /** 404 / unsupported: the configured model does not exist for this key. */
  | "model_unavailable"
  /** 401 / 403 / invalid key. */
  | "auth"
  /** 400 INVALID_ARGUMENT other than a bad key. */
  | "invalid_request"
  /** Could not reach Google at all, or the request timed out. */
  | "network"
  /** Prepaid balance empty or payment overdue (DeepSeek 402, Qwen "Arrearage"). */
  | "insufficient_credits"
  /** The request's time budget (Vercel's 300 s function limit) ran out first. */
  | "time_budget"
  | "unknown"

/** The same categories are used for every AI provider (Gemini, Qwen, DeepSeek). */
export type AiErrorKind = GeminiErrorKind

/**
 * The answer when the server-side time budget runs out. `kept` says what a
 * retry reuses: the video stored at Gemini, the frames, or nothing.
 */
export function timeBudgetError(
  providerLabel: string,
  stage: string,
  kept: "stored_video" | "frames" | "none",
): ClassifiedGeminiError {
  const next =
    kept === "stored_video"
      ? "Your video is still stored at Gemini, so Retry continues without uploading it again."
      : kept === "frames"
        ? "Click Retry: only the small frames are sent again."
        : "Click Retry, or try a shorter clip."
  return {
    kind: "time_budget",
    status: null,
    retryable: false,
    retryAfterSeconds: null,
    message: `${providerLabel} did not finish ${stage} within the server's time limit (about 4½ minutes per request on Vercel). This is usually temporary slowness at the provider. ${next}`,
  }
}

export type ClassifiedGeminiError = {
  kind: GeminiErrorKind
  /** HTTP status from Google, when known. */
  status: number | null
  /** True only for temporary server-side failures, which are worth retrying automatically. */
  retryable: boolean
  /** From Google's RetryInfo (429s), in whole seconds. */
  retryAfterSeconds: number | null
  /** Safe to show: secrets are redacted. */
  message: string
}

const KEY_PATTERNS = [
  /AIza[0-9A-Za-z_-]{30,}/g, // Google
  /\bAQ\.[0-9A-Za-z_.-]{20,}/g, // Google (newer format)
  /\bsk-[0-9A-Za-z_-]{16,}/g, // DashScope / DeepSeek
  /(Bearer\s+)[0-9A-Za-z._-]{12,}/gi, // Authorization headers
]

/** Removes API keys (the configured one plus anything key-shaped) from text before it is shown or logged. */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[] = []): string {
  let safe = text
  for (const secret of secrets) {
    if (secret && secret.length >= 8) safe = safe.split(secret).join("[REDACTED]")
  }
  for (const pattern of KEY_PATTERNS) safe = safe.replace(pattern, "[REDACTED]")
  return safe.replace(/([?&]key=)[^&\s"']+/gi, "$1[REDACTED]")
}

function statusOf(error: unknown, message: string): number | null {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status
    if (typeof status === "number" && status >= 100 && status < 600) return status
  }
  const fromJson = message.match(/"code"\s*:\s*(\d{3})/)
  if (fromJson) return Number(fromJson[1])
  const fromText = message.match(/\b(400|401|403|404|429|500|502|503|504)\b/)
  return fromText ? Number(fromText[1]) : null
}

function retryAfterOf(message: string): number | null {
  const match =
    message.match(/"?retryDelay"?\s*:\s*"(\d+(?:\.\d+)?)s"/i) ??
    message.match(/retry in (\d+(?:\.\d+)?)\s*s/i)
  return match ? Math.ceil(Number(match[1])) : null
}

export function classifyGeminiError(
  error: unknown,
  secrets: readonly (string | undefined)[] = [],
): ClassifiedGeminiError {
  const raw = error instanceof Error ? error.message : String(error)
  const status = statusOf(error, raw)
  const base = { status, retryAfterSeconds: null, retryable: false }

  if (
    /API key not valid|API_KEY_INVALID|API key expired|UNAUTHENTICATED/i.test(raw) ||
    status === 401 ||
    (status === 403 && !/model/i.test(raw))
  ) {
    return {
      ...base,
      kind: "auth",
      message:
        "Gemini rejected the API key. Check GEMINI_API_KEY in .env.local and restart the server.",
    }
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    const retryAfterSeconds = retryAfterOf(raw)
    const daily = /per ?day|PerDay|daily/i.test(raw)
    return {
      ...base,
      kind: "quota",
      retryAfterSeconds,
      message: daily
        ? "Your Gemini API key has used up its daily quota (HTTP 429). This is a limit on your key, not a Google outage: try again tomorrow, switch GEMINI_MODEL to another model, or raise the quota in Google AI Studio."
        : `Your Gemini API key hit its rate limit (HTTP 429). This is a limit on your key, not a Google outage${retryAfterSeconds ? `: wait about ${retryAfterSeconds} s and retry` : ": wait a minute and retry"}, or check your quota in Google AI Studio.`,
    }
  }
  if (status === 503 || /UNAVAILABLE|overloaded|high demand/i.test(raw)) {
    return {
      ...base,
      kind: "overloaded",
      retryable: true,
      message:
        "Gemini is temporarily overloaded (HTTP 503: Google is short of capacity for this model). This is not a problem with your key or video.",
    }
  }
  if (status === 404 || /NOT_FOUND|is not found|not supported for generateContent/i.test(raw)) {
    return {
      ...base,
      kind: "model_unavailable",
      message:
        "The configured Gemini model is not available to your API key. Check GEMINI_MODEL in .env.local.",
    }
  }
  if (
    status === 500 ||
    status === 502 ||
    status === 504 ||
    /INTERNAL|DEADLINE_EXCEEDED/.test(raw)
  ) {
    return {
      ...base,
      kind: "server_error",
      retryable: true,
      message: `Gemini had a temporary server error${status ? ` (HTTP ${status})` : ""}.`,
    }
  }
  if (
    /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|ENOTFOUND|aborted/i.test(raw)
  ) {
    return {
      ...base,
      kind: "network",
      message:
        "Could not reach the Gemini API (network error or timeout). Check your internet connection.",
    }
  }
  if (status === 400 || /INVALID_ARGUMENT/.test(raw)) {
    return {
      ...base,
      kind: "invalid_request",
      message: `Gemini rejected the request: ${redactSecrets(raw, secrets).slice(0, 300)}`,
    }
  }
  return {
    ...base,
    kind: "unknown",
    message: `Gemini request failed: ${redactSecrets(raw, secrets).slice(0, 300)}`,
  }
}

/** Short message for places that only need text (e.g. the Settings connection check). */
export function describeGeminiError(
  error: unknown,
  secrets: readonly (string | undefined)[] = [],
): string {
  return classifyGeminiError(error, secrets).message
}
