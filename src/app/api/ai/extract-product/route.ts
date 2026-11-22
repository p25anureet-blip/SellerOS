import { NextResponse } from "next/server"
import type { AiErrorKind } from "@/lib/ai/errors"
import {
  type ExtractErrorBody,
  GEMINI_FILE_NAME_PATTERN,
  providerSelectionSchema,
  retryRequestSchema,
} from "@/lib/ai/extraction-api"
import { type ExtractionResponse, type FallbackStep } from "@/lib/ai/extraction-schema"
import { classifyError, safeLogText } from "@/lib/ai/gemini"
import { MODEL_ID_PATTERN } from "@/lib/ai/model-choice"
import { discardUpload } from "@/lib/ai/product-extraction"
import { isAllowedGeminiModel, retryGeminiUpload } from "@/lib/ai/providers/gemini-provider"
import { type ProviderSelection, runExtraction } from "@/lib/ai/providers/orchestrate"
import { PROVIDERS, getProvider } from "@/lib/ai/providers/registry"
import {
  ExtractionFailedError,
  ProviderError,
  ProviderNotConfiguredError,
} from "@/lib/ai/providers/types"
import { requestDeadline } from "@/lib/ai/retry"
import { readUploadInput } from "@/lib/ai/upload-input"
import { getOptionalUser } from "@/lib/auth"

export type { ExtractErrorBody } from "@/lib/ai/extraction-api"

/**
 * Vercel Hobby's maximum (seconds). AI work stops starting new calls after
 * REQUEST_TIME_BUDGET_MS (270 s), so the route always answers with a useful
 * JSON error before the platform would cut it off with a bare 504.
 * Must be a literal: Next.js reads it statically.
 */
export const maxDuration = 300

const fail = (status: number, body: ExtractErrorBody) =>
  NextResponse.json<ExtractErrorBody>(body, { status })

/** HTTP status SellerOS answers with, so 503 (provider capacity) and 429 (your quota) stay distinct. */
const STATUS_FOR: Record<AiErrorKind, number> = {
  overloaded: 503,
  server_error: 502,
  quota: 429,
  insufficient_credits: 402,
  model_unavailable: 422,
  auth: 502,
  invalid_request: 502,
  network: 504,
  time_budget: 504,
  unknown: 502,
}
const RETRYABLE_LATER = new Set<AiErrorKind>([
  "overloaded",
  "server_error",
  "quota",
  "network",
  "time_budget",
])

const SETUP_HINT =
  "Add at least one key to .env.local (GEMINI_API_KEY, or optionally DEEPSEEK_API_KEY) and restart `npm run dev`. See README → AI providers."

/** Turns an orchestration failure into the error body the AI page renders. */
function failure(error: unknown, fallbacks: FallbackStep[]) {
  if (error instanceof ProviderNotConfiguredError) {
    const names = error.providers.map((id) => getProvider(id).keyEnv).join(" / ")
    return fail(503, {
      code: "provider_not_configured",
      error:
        error.providers.length === 1
          ? `${getProvider(error.providers[0]).label} is not configured: ${names} is not set in .env.local. Restart the server after adding it.`
          : `No AI provider is configured. ${SETUP_HINT}`,
      fallbacks,
    })
  }
  if (error instanceof ProviderError) {
    const { classified, attempts, model, provider } = error
    const label = getProvider(provider).label
    let message = classified.message
    if (classified.kind === "overloaded" || classified.kind === "server_error") {
      message += ` SellerOS tried ${attempts} time${attempts === 1 ? "" : "s"} with exponential backoff.`
    }
    if (classified.kind === "model_unavailable" && error.suggestedModels.length) {
      message += ` Available alternatives: ${error.suggestedModels.join(", ")}.`
    }
    return fail(STATUS_FOR[classified.kind], {
      error: message,
      code: `${provider}_${classified.kind}`,
      kind: classified.kind,
      provider,
      providerLabel: label,
      retryable: RETRYABLE_LATER.has(classified.kind),
      retryAfterSeconds: classified.retryAfterSeconds,
      attempts,
      model,
      suggestedModels: error.suggestedModels,
      upload: error.upload ?? undefined,
      fallbacks,
    })
  }
  if (error instanceof ExtractionFailedError) {
    return fail(502, {
      code: "extraction_failed",
      error: error.message,
      provider: error.provider,
      providerLabel: getProvider(error.provider).label,
      model: error.model,
      fallbacks,
    })
  }
  console.error("[extract-product]", safeLogText(error))
  return fail(502, { code: "unknown", error: classifyError(error).message, fallbacks })
}

/** A model picked in the UI must be one this provider offers. */
async function checkModel(selection: ProviderSelection, requested: string | null) {
  const model = requested?.trim() || undefined
  if (!model || selection === "auto") return { model: undefined }
  if (!MODEL_ID_PATTERN.test(model)) return { error: "Not a valid model id." }
  const allowed =
    selection === "gemini"
      ? await isAllowedGeminiModel(model)
      : (await getProvider(selection).modelChoices()).includes(model)
  return allowed
    ? { model }
    : { error: `"${model}" is not an available ${getProvider(selection).label} model.` }
}

/**
 * POST multipart/form-data:
 *   video (file), provider ("auto" | "qwen" | "deepseek" | "gemini", default auto),
 *   model (optional), frames (JPEG files, optional) + frameTimes (JSON seconds).
 * POST application/json { fileName, video, model? } → re-analyse a video kept at Gemini.
 */
export async function POST(request: Request) {
  // The time budget starts now; every AI call and retry checks it.
  const deadline = requestDeadline()
  if (!(await getOptionalUser())) {
    return fail(401, { code: "unauthorized", error: "Please log in first." })
  }

  if (request.headers.get("content-type")?.includes("application/json")) {
    const parsed = retryRequestSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return fail(400, { code: "bad_request", error: "Invalid retry request." })
    const { fileName, video, model } = parsed.data
    if (!getProvider("gemini").isConfigured())
      return failure(new ProviderNotConfiguredError(["gemini"]), [])
    if (model && !(await isAllowedGeminiModel(model))) {
      return fail(400, {
        code: "bad_model",
        error: `"${model}" is not available to your Gemini key.`,
      })
    }
    try {
      const { notes, ...result } = await retryGeminiUpload(fileName, video, model, deadline)
      return NextResponse.json<ExtractionResponse>({
        ...result,
        provider: "gemini",
        providerLabel: "Gemini",
        fallbacks: notes,
      })
    } catch (error) {
      return failure(error, [])
    }
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail(400, {
      code: "bad_request",
      error: "Send the video as multipart form data in a field named 'video'.",
    })
  }
  const input = await readUploadInput(form)
  if ("status" in input) return fail(input.status, { code: input.code, error: input.error })
  const selection = providerSelectionSchema.safeParse(form.get("provider") ?? "auto")
  if (!selection.success) return fail(400, { code: "bad_provider", error: "Unknown AI provider." })
  const requested = form.get("model")
  const checked = await checkModel(selection.data, typeof requested === "string" ? requested : null)
  if ("error" in checked) return fail(400, { code: "bad_model", error: checked.error! })

  const outcome = await runExtraction(PROVIDERS, selection.data, {
    ...input,
    model: checked.model,
    deadline,
  })
  if (outcome.ok) return NextResponse.json<ExtractionResponse>(outcome.response)
  return failure(outcome.error, outcome.fallbacks)
}

/** DELETE ?file=files/abc → remove a kept Gemini upload when the user starts over. */
export async function DELETE(request: Request) {
  if (!(await getOptionalUser())) {
    return fail(401, { code: "unauthorized", error: "Please log in first." })
  }
  const fileName = new URL(request.url).searchParams.get("file") ?? ""
  if (getProvider("gemini").isConfigured() && GEMINI_FILE_NAME_PATTERN.test(fileName)) {
    await discardUpload(fileName)
  }
  return new NextResponse(null, { status: 204 })
}
