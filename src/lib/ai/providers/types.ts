import type { AiErrorKind, ClassifiedGeminiError } from "../errors"
import type { UploadedVideoRef } from "../extraction-api"
import type {
  AiProviderId,
  ExtractionResult,
  FallbackStep,
  VideoInputMode,
} from "../extraction-schema"

/**
 * The contract every AI provider implements. Adding a provider means writing
 * one adapter and registering it in ./registry.ts. Pure types and errors only.
 */

/** A still frame extracted from the video in the browser. */
export type VideoFrame = { timeSeconds: number; mimeType: string; base64: string }

export type VideoMeta = { name: string; sizeBytes: number; mimeType: string }

export type ProviderInput = {
  /**
   * The video file, or null when only frames were sent (videos over 4 MB:
   * Vercel's request body limit is 4.5 MB, see lib/ai/upload-plan.ts).
   */
  video: File | null
  /** Name, size and type of the original video, also when it was not uploaded. */
  videoMeta: VideoMeta
  /** Representative frames (browser-extracted). May be empty if extraction failed. */
  frames: VideoFrame[]
  /** A model id the user picked; the provider's default when omitted. */
  model?: string
  /** Epoch ms after which no new AI call may start (the function's time budget). */
  deadline?: number
}

export type ProviderOutput = ExtractionResult & {
  inputMode: VideoInputMode
  frameCount: number | null
  /** Steps inside this provider, e.g. Qwen rejecting the video file and using frames. */
  notes: FallbackStep[]
}

export interface VideoExtractionProvider {
  id: AiProviderId
  label: string
  /** The .env.local variable holding this provider's key. */
  keyEnv: string
  isConfigured(): boolean
  defaultModel(): string
  /** Model ids the UI may offer for this provider, default first. */
  modelChoices(): Promise<string[]>
  /** True when the provider can only work from frames (no direct video input). */
  needsFrames: boolean
  extract(input: ProviderInput): Promise<ProviderOutput>
}

/** An API failure from a provider (after its automatic 503 retries). */
export class ProviderError extends Error {
  constructor(
    readonly provider: AiProviderId,
    readonly model: string,
    readonly classified: ClassifiedGeminiError,
    readonly attempts: number,
    /** Gemini only: the video is still stored at Google for a no-upload retry. */
    readonly upload: UploadedVideoRef | null = null,
    readonly suggestedModels: string[] = [],
  ) {
    super(classified.message)
    this.name = "ProviderError"
  }
  get kind(): AiErrorKind {
    return this.classified.kind
  }
}

/**
 * The provider answered, but not with valid attributes (bad JSON, schema
 * mismatch), or could not process the video. Never triggers an automatic
 * fallback: the user decides whether to try another provider.
 */
export class ExtractionFailedError extends Error {
  constructor(
    readonly provider: AiProviderId,
    readonly model: string,
    message: string,
  ) {
    super(message)
    this.name = "ExtractionFailedError"
  }
}

/** The selected provider (or, in Auto, every provider) has no API key. */
export class ProviderNotConfiguredError extends Error {
  constructor(readonly providers: AiProviderId[]) {
    super("Not configured")
    this.name = "ProviderNotConfiguredError"
  }
}
