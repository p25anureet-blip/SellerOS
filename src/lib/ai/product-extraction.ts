import "server-only"
import {
  type File as GeminiFile,
  type Part,
  FileState,
  type Schema,
  Type,
  createPartFromUri,
} from "@google/genai"
import { CATEGORY_CODES } from "@/lib/catalog/product"
import { type ClassifiedGeminiError, type GeminiErrorKind, timeBudgetError } from "./errors"
import { EXTRACTION_PROMPT, geminiFramesParts } from "./prompt"
import type { UploadedVideoRef } from "./extraction-api"
import { type ExtractionResult, extractionSchema } from "./extraction-schema"
import { classifyError, defaultModel, getGemini, safeLogText } from "./gemini"
import {
  MAX_GEMINI_RETRIES,
  MIN_ATTEMPT_MS,
  RetriesExhaustedError,
  TimeBudgetExceededError,
  isOutOfTime,
  remainingMs,
  timeoutWithin,
  withRetry,
} from "./retry"

/**
 * The AI Product Agent: sends a product video to Gemini and gets back
 * structured, validated product attributes. Always a real API call.
 *
 * Flow: upload the video to the Gemini Files API → wait until Google has
 * processed it → ask the model for JSON matching EXTRACTION_RESPONSE_SCHEMA →
 * validate with Zod → delete the uploaded video.
 *
 * Temporary failures (503 overloaded, 500/502/504) are retried with bounded
 * exponential backoff (lib/ai/retry.ts). If Gemini still fails, the uploaded
 * video is kept at Google (it expires after 48 h) and its reference returned,
 * so the user can retry, optionally with another model, without re-uploading.
 */

const fieldSchema = (type: Type, description: string, extra: Partial<Schema> = {}): Schema => ({
  type: Type.OBJECT,
  description,
  properties: {
    value: { type, nullable: true, ...extra },
    confidence: {
      type: Type.NUMBER,
      description: "0 to 1. How sure you are, based on how clearly it is visible.",
    },
    evidence: {
      type: Type.STRING,
      description:
        "Where you saw it, with a timestamp, e.g. '00:07 – front label reads Net Wt. 200 g'. Say 'Not visible' if value is null.",
    },
  },
  required: ["value", "confidence", "evidence"],
  propertyOrdering: ["value", "confidence", "evidence"],
})

const PROPERTY_ORDER = [
  "product_name",
  "brand",
  "category",
  "description",
  "ingredients",
  "manufacturer",
  "net_weight_grams",
  "mrp_inr",
  "length_cm",
  "width_cm",
  "height_cm",
  "color",
  "additional_attributes",
  "video_summary",
  "quality_warnings",
]

export const EXTRACTION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    product_name: fieldSchema(Type.STRING, "Product name as printed, without the brand"),
    brand: fieldSchema(Type.STRING, "Brand name as printed on the pack"),
    category: fieldSchema(Type.STRING, "Best-fitting catalogue category code", {
      enum: [...CATEGORY_CODES],
      format: "enum",
    }),
    description: fieldSchema(
      Type.STRING,
      "2–3 sentence factual product description for a marketplace listing, using only what is visible or stated",
    ),
    ingredients: fieldSchema(Type.STRING, "Ingredients list exactly as printed, comma-separated"),
    manufacturer: fieldSchema(Type.STRING, "Manufacturer / marketer name and address as printed"),
    net_weight_grams: fieldSchema(
      Type.NUMBER,
      "Net quantity in grams. Convert kg×1000; for liquids convert ml→g assuming 1 g/ml and say so in evidence",
    ),
    mrp_inr: fieldSchema(Type.NUMBER, "MRP in Indian rupees as printed (incl. of all taxes)"),
    length_cm: fieldSchema(
      Type.NUMBER,
      "Package length in cm, estimated from visual scale if not printed",
    ),
    width_cm: fieldSchema(Type.NUMBER, "Package width in cm, estimated if not printed"),
    height_cm: fieldSchema(Type.NUMBER, "Package height in cm, estimated if not printed"),
    color: fieldSchema(Type.STRING, "Main colour of the product or packaging"),
    additional_attributes: {
      type: Type.ARRAY,
      description:
        "Other useful listing attributes that are visible, e.g. flavour, variant, shelf life, FSSAI licence no., veg/non-veg mark, certifications, material, size",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          value: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          evidence: { type: Type.STRING },
        },
        required: ["name", "value", "confidence", "evidence"],
      },
    },
    video_summary: {
      type: Type.STRING,
      description: "One or two sentences describing what the video shows",
    },
    quality_warnings: {
      type: Type.ARRAY,
      description: "Problems that limited extraction, e.g. blurry label, back of pack never shown",
      items: { type: Type.STRING },
    },
  },
  required: PROPERTY_ORDER,
  propertyOrdering: PROPERTY_ORDER,
}

const PROMPT = EXTRACTION_PROMPT

const POLL_INTERVAL_MS = 2_000
const PROCESSING_TIMEOUT_MS = 180_000
const GENERATE_TIMEOUT_MS = 180_000
const UPLOAD_TIMEOUT_MS = 120_000
const FILE_GET_TIMEOUT_MS = 30_000

/** A failure that is not a Gemini API error (bad JSON, processing failed, …). */
export class ExtractionError extends Error {}

/** Gemini failed (after any automatic retries). Carries what the UI needs to offer a retry. */
export class GeminiCallError extends Error {
  constructor(
    readonly classified: ClassifiedGeminiError,
    readonly attempts: number,
    readonly model: string,
    /** Set when the video is still stored at Gemini, so a retry can skip the upload. */
    readonly upload: UploadedVideoRef | null,
  ) {
    super(classified.message)
    this.name = "GeminiCallError"
  }
}

type VideoMeta = UploadedVideoRef["video"]

/** Per-request options. `deadline` (epoch ms) is the server's time budget; see lib/ai/retry.ts. */
export type GeminiRunOptions = { deadline?: number }

/** Failures where trying again later (or with another model) can work, so the upload is kept. */
const KEEP_UPLOAD_FOR = new Set<GeminiErrorKind>([
  "overloaded",
  "server_error",
  "quota",
  "network",
  "model_unavailable",
  "time_budget",
])

/**
 * Retries only temporary server-side failures, at most MAX_GEMINI_RETRIES
 * times, and never starts an attempt (or retry) the time budget cannot cover.
 */
async function callWithRetry<T>(label: string, operation: () => Promise<T>, deadline?: number) {
  if (isOutOfTime(deadline)) throw new TimeBudgetExceededError(label)
  try {
    return await withRetry(operation, {
      maxRetries: MAX_GEMINI_RETRIES,
      shouldRetry: (error) => classifyError(error).retryable,
      deadline,
      onRetry: ({ retry, delayMs, error }) => {
        const { kind, status } = classifyError(error)
        console.warn(
          `[gemini] ${label}: ${kind} (HTTP ${status ?? "?"}), retry ${retry}/${MAX_GEMINI_RETRIES} in ${delayMs} ms`,
        )
      },
    })
  } catch (error) {
    throw error instanceof RetriesExhaustedError ? error : new RetriesExhaustedError(error, 1)
  }
}

/**
 * Turns any failure into a GeminiCallError. Running out of time (no budget for
 * another attempt, or a call cut short by the deadline) becomes "time_budget"
 * with a message saying what a retry will reuse.
 */
function toCallError(
  error: unknown,
  model: string,
  upload: UploadedVideoRef | null,
  {
    deadline,
    stage,
    kept,
  }: { deadline?: number; stage: string; kept: "stored_video" | "frames" | "none" },
) {
  if (error instanceof TimeBudgetExceededError) {
    console.error(`[gemini] ${model}: time budget exhausted before ${error.stage}`)
    return new GeminiCallError(timeBudgetError("Gemini", stage, kept), 1, model, upload)
  }
  const exhausted =
    error instanceof RetriesExhaustedError ? error : new RetriesExhaustedError(error, 1)
  const classified = classifyError(exhausted.lastError)
  console.error(
    `[gemini] ${model} failed after ${exhausted.attempts} attempt(s)${exhausted.outOfTime ? " (time budget)" : ""}:`,
    safeLogText(exhausted.lastError),
  )
  // A timeout or retry stop caused by the request deadline is a time-budget problem, not a network one.
  const outOfTime = exhausted.outOfTime || (classified.kind === "network" && isOutOfTime(deadline))
  const final = outOfTime ? timeBudgetError("Gemini", stage, kept) : classified
  return new GeminiCallError(
    final,
    exhausted.attempts,
    model,
    upload && KEEP_UPLOAD_FOR.has(final.kind) ? upload : null,
  )
}

/** Waits until Google has processed the video and it can be used in a prompt. */
async function waitUntilActive(
  file: GeminiFile,
  fileName: string,
  deadline?: number,
): Promise<GeminiFile> {
  const processingDeadline = Date.now() + PROCESSING_TIMEOUT_MS
  let current = file
  while (current.state === FileState.PROCESSING) {
    // The request budget runs out first: stop, keep the upload, let the user retry.
    if (remainingMs(deadline) < MIN_ATTEMPT_MS + POLL_INTERVAL_MS) {
      throw new TimeBudgetExceededError("processing the video")
    }
    if (Date.now() > processingDeadline) {
      throw new ExtractionError("Gemini took too long to process the video. Try a shorter clip.")
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    current = (
      await callWithRetry(
        "files.get",
        () =>
          getGemini().files.get({
            name: fileName,
            config: { httpOptions: { timeout: timeoutWithin(FILE_GET_TIMEOUT_MS, deadline) } },
          }),
        deadline,
      )
    ).value
  }
  if (current.state === FileState.FAILED || !current.uri) {
    throw new ExtractionError(
      `Gemini could not process this video${current.error?.message ? `: ${current.error.message}` : "."}`,
    )
  }
  return current
}

/** Best effort: otherwise Google keeps the file for 48 hours. */
async function deleteUpload(fileName: string) {
  await getGemini()
    .files.delete({ name: fileName })
    .catch(() => undefined)
}

/** One generateContent call (with retries) whose JSON answer is schema-validated. */
async function generateExtraction(
  parts: Part[],
  video: VideoMeta,
  model: string,
  started: number,
  deadline?: number,
): Promise<ExtractionResult> {
  const { value: response, attempts } = await callWithRetry(
    `generateContent ${model}`,
    () =>
      getGemini().models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          responseMimeType: "application/json",
          responseSchema: EXTRACTION_RESPONSE_SCHEMA,
          temperature: 0.2,
          httpOptions: { timeout: timeoutWithin(GENERATE_TIMEOUT_MS, deadline) },
        },
      }),
    deadline,
  )

  const rawJson = response.text?.trim() ?? ""
  if (!rawJson) throw new ExtractionError("Gemini returned an empty response.")
  let json: unknown
  try {
    json = JSON.parse(rawJson)
  } catch {
    throw new ExtractionError("Gemini returned text that is not valid JSON.")
  }
  const parsed = extractionSchema.safeParse(json)
  if (!parsed.success) {
    const problem = parsed.error.issues[0]
    throw new ExtractionError(
      `Gemini's JSON did not match the expected structure (${problem.path.join(".")}: ${problem.message}).`,
    )
  }

  return {
    extraction: parsed.data,
    rawJson: JSON.stringify(json, null, 2),
    model,
    durationMs: Math.round(performance.now() - started),
    attempts,
    usage: {
      promptTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      totalTokens: response.usageMetadata?.totalTokenCount ?? null,
    },
    video,
  }
}

/** Asks the model for structured attributes of an ACTIVE uploaded video. */
function analyse(
  file: GeminiFile,
  video: VideoMeta,
  model: string,
  started: number,
  deadline?: number,
) {
  const parts = [createPartFromUri(file.uri!, file.mimeType ?? video.mimeType), { text: PROMPT }]
  return generateExtraction(parts, video, model, started, deadline)
}

/**
 * Runs the analysis. Deletes the upload on success or on a permanent failure;
 * keeps it (and reports it) when a later retry could work.
 */
async function analyseAndCleanUp(
  file: GeminiFile,
  ref: UploadedVideoRef,
  model: string,
  started: number,
  deadline?: number,
) {
  try {
    const result = await analyse(file, ref.video, model, started, deadline)
    await deleteUpload(ref.fileName)
    return result
  } catch (error) {
    if (error instanceof ExtractionError) {
      await deleteUpload(ref.fileName)
      throw error
    }
    const callError = toCallError(error, model, ref, {
      deadline,
      stage: "analysing the video",
      kept: "stored_video",
    })
    if (!callError.upload) await deleteUpload(ref.fileName)
    throw callError
  }
}

/** Uploads a video (≤ 4 MB on Vercel) and analyses it. Throws GeminiCallError or ExtractionError. */
export async function extractProductFromVideo(
  video: File,
  model = defaultModel(),
  { deadline }: GeminiRunOptions = {},
): Promise<ExtractionResult> {
  const started = performance.now()
  const meta: VideoMeta = { name: video.name, sizeBytes: video.size, mimeType: video.type }

  let uploaded: GeminiFile
  try {
    uploaded = (
      await callWithRetry(
        "files.upload",
        () =>
          getGemini().files.upload({
            file: video,
            config: {
              mimeType: video.type,
              displayName: video.name.slice(0, 100),
              // Not httpOptions: with @google/genai 2.32 that sends the upload to a URL
              // that answers 404. An abort signal bounds the upload instead.
              abortSignal: AbortSignal.timeout(timeoutWithin(UPLOAD_TIMEOUT_MS, deadline)),
            },
          }),
        deadline,
      )
    ).value
  } catch (error) {
    throw toCallError(error, model, null, { deadline, stage: "uploading the video", kept: "none" })
  }
  if (!uploaded.name) throw new ExtractionError("Gemini did not return a file reference.")
  const ref: UploadedVideoRef = {
    fileName: uploaded.name,
    expiresAt: uploaded.expirationTime ?? null,
    video: meta,
  }

  let active: GeminiFile
  try {
    active = await waitUntilActive(uploaded, ref.fileName, deadline)
  } catch (error) {
    if (error instanceof ExtractionError) {
      await deleteUpload(ref.fileName)
      throw error
    }
    throw toCallError(error, model, ref, {
      deadline,
      stage: "processing the video",
      kept: "stored_video",
    })
  }
  return analyseAndCleanUp(active, ref, model, started, deadline)
}

/**
 * The frames path for large videos: the browser sends ~12 frames instead of
 * the file (Vercel's 4.5 MB body limit), and Gemini reads them as inline
 * images. No Files API upload, so nothing is stored at Google.
 */
export async function extractProductFromFrames(
  frames: readonly { timeSeconds: number; mimeType: string; base64: string }[],
  video: VideoMeta,
  model = defaultModel(),
  { deadline }: GeminiRunOptions = {},
): Promise<ExtractionResult> {
  if (frames.length === 0) throw new ExtractionError("No frames were provided.")
  const started = performance.now()
  try {
    return await generateExtraction(geminiFramesParts(frames), video, model, started, deadline)
  } catch (error) {
    if (error instanceof ExtractionError) throw error
    throw toCallError(error, model, null, {
      deadline,
      stage: "analysing the frames",
      kept: "frames",
    })
  }
}

/** Analyses a video that is already stored at Gemini again, without re-uploading it. */
export async function retryExtraction(
  fileName: string,
  video: VideoMeta,
  model = defaultModel(),
  { deadline }: GeminiRunOptions = {},
): Promise<ExtractionResult> {
  const started = performance.now()
  const kept: UploadedVideoRef = { fileName, expiresAt: null, video }
  let file: GeminiFile
  try {
    file = (
      await callWithRetry(
        "files.get",
        () =>
          getGemini().files.get({
            name: fileName,
            config: { httpOptions: { timeout: timeoutWithin(FILE_GET_TIMEOUT_MS, deadline) } },
          }),
        deadline,
      )
    ).value
  } catch (error) {
    const callError = toCallError(error, model, kept, {
      deadline,
      stage: "finding the stored video",
      kept: "stored_video",
    })
    const { kind, status } = callError.classified
    if (kind === "model_unavailable" || kind === "auth" || status === 403) {
      // files.get 404/403: the stored copy expired (48 h) or belongs to another key.
      throw new ExtractionError(
        "The uploaded copy of this video is no longer stored at Gemini (it is deleted after a successful analysis and expires after 48 hours). Please upload the video again.",
      )
    }
    throw new GeminiCallError(callError.classified, callError.attempts, model, kept)
  }
  const ref: UploadedVideoRef = { fileName, expiresAt: file.expirationTime ?? null, video }
  let active: GeminiFile
  try {
    active = await waitUntilActive(file, fileName, deadline)
  } catch (error) {
    if (error instanceof ExtractionError) throw error
    throw toCallError(error, model, ref, {
      deadline,
      stage: "processing the video",
      kept: "stored_video",
    })
  }
  return analyseAndCleanUp(active, ref, model, started, deadline)
}

/** Deletes a kept upload when the user gives up on it. */
export async function discardUpload(fileName: string) {
  await deleteUpload(fileName)
}
