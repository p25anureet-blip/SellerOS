"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowRightIcon,
  CircleAlertIcon,
  CloudCheckIcon,
  FileVideoIcon,
  ImagesIcon,
  KeyRoundIcon,
  Loader2Icon,
  RotateCcwIcon,
  SparklesIcon,
  UploadCloudIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { AiStatus, ProviderStatus } from "@/app/api/ai/status/route"
import { PageHeader } from "@/components/layout/page-header"
import { ProductForm } from "@/components/products/product-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import type { AiErrorKind } from "@/lib/ai/errors"
import type { ExtractErrorBody, UploadedVideoRef } from "@/lib/ai/extraction-api"
import {
  ACCEPTED_VIDEO_TYPES,
  type AiProviderId,
  type ExtractionField,
  type ExtractionResponse,
  type FallbackStep,
  MAX_VIDEO_BYTES,
} from "@/lib/ai/extraction-schema"
import {
  FIELD_FOR_EXTRACTION,
  confidenceLevel,
  extractionCoverage,
  extractionToForm,
} from "@/lib/ai/extraction-to-product"
import { addProduct } from "@/lib/store/app-store"
import { cn } from "@/lib/utils"
import {
  DIRECT_VIDEO_MAX_BYTES,
  VERCEL_BODY_LIMIT_BYTES,
  fitPayload,
  formatMegabytes,
  planUpload,
} from "@/lib/ai/upload-plan"
import { type ExtractedFrame, extractFrames } from "@/lib/video/frames"

type Selection = "auto" | AiProviderId

/** What the user asked for: a provider (or Auto) and, for a specific provider, a model. */
type Request = { selection: Selection; model: string | null }

/** "video": the file itself is uploaded; "frames": only frames extracted in the browser. */
type UploadMode = "video" | "frames"

type Phase =
  | { kind: "idle" }
  | { kind: "selected"; file: File; url: string }
  | { kind: "extracting"; file: File; url: string }
  | {
      kind: "uploading"
      file: File
      url: string
      progress: number
      mode: UploadMode
      /** Size of the request body being sent. */
      bytes: number
    }
  | {
      kind: "analysing"
      file: File
      url: string
      startedAt: number
      request: Request
      reusedUpload: boolean
      mode: UploadMode
      frameCount: number
    }
  | { kind: "review"; file: File; url: string; result: ExtractionResponse }
  | {
      kind: "error"
      file: File
      url: string
      failure: ExtractErrorBody
      request: Request
      at: number
    }

type Outcome = { ok: true; data: ExtractionResponse } | { ok: false; failure: ExtractErrorBody }

const PROVIDER_LABEL: Record<AiProviderId, string> = {
  qwen: "Qwen",
  deepseek: "DeepSeek",
  gemini: "Gemini",
}

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

const networkFailure: ExtractErrorBody = {
  code: "network",
  kind: "network",
  retryable: true,
  error: "Network error: is the SellerOS dev server running?",
}

/** A non-JSON error page from the hosting platform (e.g. Vercel's own 413 or 504). */
function platformFailure(status: number): ExtractErrorBody {
  if (status === 413) {
    return {
      code: "payload_too_large",
      error: `The upload was larger than the server accepts (${formatMegabytes(VERCEL_BODY_LIMIT_BYTES)}). Try again: videos over ${formatMegabytes(DIRECT_VIDEO_MAX_BYTES)} are sent as frames.`,
    }
  }
  if (status === 504) {
    return {
      code: "platform_timeout",
      kind: "time_budget",
      retryable: true,
      error: "The server ran out of time before the AI finished. Click Retry.",
    }
  }
  return { code: "http", error: `Request failed (HTTP ${status}).` }
}

/** XHR rather than fetch so we can show real upload progress. */
function sendVideo(
  file: File,
  request: Request,
  frames: ExtractedFrame[],
  includeVideo: boolean,
  onProgress: (percent: number) => void,
  onUploaded: () => void,
) {
  return new Promise<Outcome>((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/ai/extract-product")
    xhr.responseType = "json"
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.upload.onload = onUploaded
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
        resolve({ ok: true, data: xhr.response as ExtractionResponse })
      } else {
        const body = xhr.response as ExtractErrorBody | null
        resolve({ ok: false, failure: body ?? platformFailure(xhr.status) })
      }
    }
    xhr.onerror = () => resolve({ ok: false, failure: networkFailure })
    const form = new FormData()
    if (includeVideo) {
      form.append("video", file)
    } else {
      // Frames path: the video stays in the browser; describe it for the result.
      form.append(
        "videoMeta",
        JSON.stringify({ name: file.name, sizeBytes: file.size, mimeType: file.type }),
      )
    }
    form.append("provider", request.selection)
    if (request.model) form.append("model", request.model)
    frames.forEach((frame, index) => form.append("frames", frame.blob, `frame-${index}.jpg`))
    form.append("frameTimes", JSON.stringify(frames.map((frame) => frame.timeSeconds)))
    xhr.send(form)
  })
}

/** Re-analyses the copy already stored at Gemini: nothing is uploaded again. */
async function sendGeminiRetry(upload: UploadedVideoRef, model: string | null): Promise<Outcome> {
  try {
    const response = await fetch("/api/ai/extract-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: upload.fileName,
        video: upload.video,
        ...(model ? { model } : {}),
      }),
    })
    const body = (await response.json().catch(() => null)) as
      ExtractionResponse | ExtractErrorBody | null
    if (response.ok && body && "extraction" in body) return { ok: true, data: body }
    return {
      ok: false,
      failure:
        body && "error" in body
          ? body
          : { code: "http", error: `Request failed (HTTP ${response.status}).` },
    }
  } catch {
    return { ok: false, failure: networkFailure }
  }
}

/** Removes a kept Gemini upload when the user gives up on it (best effort). */
function discardKeptUpload(phase: Phase) {
  if (phase.kind === "error" && phase.failure.upload) {
    const file = encodeURIComponent(phase.failure.upload.fileName)
    fetch(`/api/ai/extract-product?file=${file}`, { method: "DELETE" }).catch(() => undefined)
  }
}

const describeRequest = (request: Request, providers: ProviderStatus[]) => {
  if (request.selection === "auto") {
    const order = providers
      .filter((provider) => provider.configured && provider.inAuto)
      .map((p) => p.label)
    return `Auto · ${order.join(" → ")}`
  }
  const provider = providers.find((p) => p.id === request.selection)
  return `${PROVIDER_LABEL[request.selection]} · ${request.model ?? provider?.model ?? ""}`
}

export function AiProductAgent() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [selection, setSelection] = useState<Selection>("auto")
  const [models, setModels] = useState<Partial<Record<AiProviderId, string>>>({})
  // Frames are extracted once per video and reused for retries and other providers.
  const framesCache = useRef<{ file: File; frames: ExtractedFrame[] } | null>(null)
  const router = useRouter()

  useEffect(() => {
    fetch("/api/ai/status")
      .then((response) => response.json() as Promise<AiStatus>)
      .then((next) => {
        setStatus(next)
        // GEMINI_MODEL unavailable to the key: start Gemini on the best alternative.
        const gemini = next.providers.find((provider) => provider.id === "gemini")
        if (next.geminiModelAvailable === false && gemini?.models[1]) {
          setModels((current) => ({ ...current, gemini: gemini.models[1] }))
        }
      })
      .catch(() => setStatusError(true))
  }, [])

  const providers = status?.providers ?? []
  const currentRequest: Request = {
    selection,
    model: selection === "auto" ? null : (models[selection] ?? null),
  }

  // Release the preview URL of a video we no longer show.
  const previewUrl = phase.kind === "idle" ? null : phase.url
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const choose = useCallback((file: File) => {
    if (!(ACCEPTED_VIDEO_TYPES as readonly string[]).includes(file.type)) {
      toast.error("Please choose an MP4 video (MOV and WebM also work).")
      return
    }
    if (file.size > MAX_VIDEO_BYTES) {
      toast.error("That video is larger than 100 MB. Please use a shorter clip.")
      return
    }
    setPhase({ kind: "selected", file, url: URL.createObjectURL(file) })
  }, [])

  function finish(file: File, url: string, request: Request, outcome: Outcome) {
    if (outcome.ok) {
      setPhase({ kind: "review", file, url, result: outcome.data })
      const { found, total } = extractionCoverage(outcome.data.extraction)
      toast.success(
        `${outcome.data.providerLabel} extracted ${found} of ${total} attributes (${outcome.data.model})`,
      )
    } else {
      setPhase({ kind: "error", file, url, failure: outcome.failure, request, at: Date.now() })
    }
  }

  /** Frames, extracted once per video (large videos, DeepSeek, Qwen's fallback). */
  async function framesFor(file: File, url: string) {
    if (framesCache.current?.file === file) return framesCache.current.frames
    setPhase({ kind: "extracting", file, url })
    try {
      const frames = await extractFrames(file)
      framesCache.current = { file, frames }
      return frames
    } catch (error) {
      toast.warning(
        `Could not extract frames in this browser (${error instanceof Error ? error.message : "unknown error"}). Providers that need frames will be skipped.`,
      )
      framesCache.current = { file, frames: [] }
      return []
    }
  }

  async function analyse(file: File, url: string, request: Request) {
    // Videos over 4 MB never leave the browser: their frames are sent instead (Vercel's 4.5 MB limit).
    const autoChain = providers.filter((p) => p.configured && p.inAuto).map((p) => p.id)
    const plan = planUpload(file.size, request.selection, autoChain)
    const frames = plan.wantFrames ? await framesFor(file, url) : []
    const fail = (error: string) =>
      setPhase({
        kind: "error",
        file,
        url,
        request,
        at: Date.now(),
        failure: { code: "upload_plan", error },
      })
    if (!plan.sendVideo && frames.length === 0) {
      return fail(
        `This video is ${formatMegabytes(file.size)}. Videos over ${formatMegabytes(DIRECT_VIDEO_MAX_BYTES)} are analysed from frames, but this browser could not extract frames from it. Try Chrome or Edge, or record a shorter clip (under ${formatMegabytes(DIRECT_VIDEO_MAX_BYTES)}).`,
      )
    }
    const payload = fitPayload(
      plan,
      file.size,
      frames.map((frame) => frame.blob.size),
    )
    if (!payload.ok) {
      return fail(
        `The upload would be ${formatMegabytes(payload.bytes)}, over the server limit of ${formatMegabytes(VERCEL_BODY_LIMIT_BYTES)}. Record a shorter or lower-resolution clip.`,
      )
    }
    const mode: UploadMode = payload.includeVideo ? "video" : "frames"
    const sentFrames = payload.includeFrames ? frames : []
    setPhase({ kind: "uploading", file, url, progress: 0, mode, bytes: payload.bytes })
    const outcome = await sendVideo(
      file,
      request,
      sentFrames,
      payload.includeVideo,
      (progress) =>
        setPhase({ kind: "uploading", file, url, progress, mode, bytes: payload.bytes }),
      () =>
        setPhase({
          kind: "analysing",
          file,
          url,
          startedAt: Date.now(),
          request,
          reusedUpload: false,
          mode,
          frameCount: sentFrames.length,
        }),
    )
    finish(file, url, request, outcome)
  }

  /** Retry: reuse the copy kept at Gemini when retrying on Gemini; otherwise resend the kept file. */
  async function retry(current: Extract<Phase, { kind: "error" }>, request: Request) {
    setSelection(request.selection)
    if (request.selection !== "auto" && request.model) {
      setModels((existing) => ({ ...existing, [request.selection]: request.model! }))
    }
    const { file, url, failure } = current
    if (request.selection === "gemini" && failure.upload) {
      setPhase({
        kind: "analysing",
        file,
        url,
        startedAt: Date.now(),
        request,
        reusedUpload: true,
        mode: "video",
        frameCount: 0,
      })
      return finish(file, url, request, await sendGeminiRetry(failure.upload, request.model))
    }
    return analyse(file, url, request)
  }

  function startOver() {
    discardKeptUpload(phase)
    framesCache.current = null
    setPhase({ kind: "idle" })
  }

  const configured = providers.filter((provider) => provider.configured)

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Product Agent"
        description="Upload a product video. An AI vision model reads the packaging and returns structured attributes for you to review."
        actions={
          configured.length ? (
            <Badge variant="success" className="h-7 px-3">
              <SparklesIcon /> {configured.map((provider) => provider.label).join(" · ")} connected
            </Badge>
          ) : null
        }
      />

      {status?.geminiModelAvailable === false ? (
        <ModelUnavailableNotice
          model={providers.find((provider) => provider.id === "gemini")?.model ?? ""}
          suggestions={
            providers.find((provider) => provider.id === "gemini")?.models.slice(1) ?? []
          }
        />
      ) : null}

      {statusError ? (
        <ErrorCard message="Could not reach the SellerOS server to check the AI configuration." />
      ) : !status ? (
        <Skeleton className="h-72" />
      ) : !status.configured ? (
        <SetupCard providers={providers} />
      ) : phase.kind === "idle" ? (
        <DropZone onFile={choose} />
      ) : phase.kind === "review" ? (
        <Review
          phase={phase}
          onRestart={startOver}
          onSave={(id) => router.push(`/products/${id}`)}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
          <VideoCard file={phase.file} url={phase.url} />
          <Card>
            <CardContent className="flex h-full flex-col justify-center gap-5 py-10">
              {phase.kind === "selected" ? (
                <>
                  <div>
                    <h2 className="text-lg font-semibold">Ready to analyse</h2>
                    <p className="text-sm text-muted-foreground">
                      Choose an AI provider. Analysis usually takes 10–90 seconds depending on the
                      provider and video length.
                    </p>
                  </div>
                  <UploadModeNote size={phase.file.size} />
                  <ProviderPicker
                    providers={providers}
                    selection={selection}
                    onSelect={setSelection}
                    model={currentRequest.model}
                    onModel={(id, model) => setModels((current) => ({ ...current, [id]: model }))}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="lg"
                      onClick={() => analyse(phase.file, phase.url, currentRequest)}
                    >
                      <SparklesIcon /> Analyse video
                    </Button>
                    <Button size="lg" variant="outline" onClick={startOver}>
                      Choose another
                    </Button>
                  </div>
                </>
              ) : phase.kind === "extracting" ? (
                <div className="flex items-center gap-3" role="status">
                  <ImagesIcon className="size-6 animate-pulse text-primary" />
                  <div>
                    <h2 className="text-lg font-semibold">Extracting frames…</h2>
                    <p className="text-sm text-muted-foreground">
                      Picking about 12 sharp frames in your browser (used by DeepSeek, and by Qwen
                      for large videos).
                    </p>
                  </div>
                </div>
              ) : phase.kind === "uploading" ? (
                <Progress
                  title={phase.mode === "frames" ? "Uploading frames…" : "Uploading video…"}
                  detail={`${phase.progress}% of ${formatBytes(phase.bytes)}`}
                  percent={phase.progress}
                />
              ) : phase.kind === "analysing" ? (
                <Analysing
                  startedAt={phase.startedAt}
                  label={`${describeRequest(phase.request, providers)} · ${
                    phase.mode === "frames"
                      ? `${phase.frameCount} frames extracted from the video`
                      : "full video"
                  }`}
                  reusedUpload={phase.reusedUpload}
                />
              ) : (
                <FailurePanel
                  phase={phase}
                  providers={providers}
                  onRetry={(request) => retry(phase, request)}
                  onStartOver={startOver}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

/** Tells the user up front whether the whole video or frames from it will be analysed. */
function UploadModeNote({ size }: { size: number }) {
  const large = size > DIRECT_VIDEO_MAX_BYTES
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-md px-3 py-2 text-xs",
        large
          ? "border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
          : "bg-muted/60 text-muted-foreground",
      )}
    >
      {large ? (
        <ImagesIcon className="mt-0.5 size-4 shrink-0" />
      ) : (
        <FileVideoIcon className="mt-0.5 size-4 shrink-0" />
      )}
      {large
        ? `This video is ${formatMegabytes(size)}, over the ${formatMegabytes(DIRECT_VIDEO_MAX_BYTES)} direct-upload limit. SellerOS will extract about 12 sharp frames in your browser and analyse those instead (no audio). The video itself is not uploaded.`
        : `This video is ${formatMegabytes(size)}: the full video (with audio) will be analysed.`}
    </p>
  )
}

function ProviderPicker({
  providers,
  selection,
  onSelect,
  model,
  onModel,
}: {
  providers: ProviderStatus[]
  selection: Selection
  onSelect: (selection: Selection) => void
  model: string | null
  onModel: (id: AiProviderId, model: string) => void
}) {
  const autoChain = providers.filter((provider) => provider.configured && provider.inAuto)
  const options: { id: Selection; title: string; detail: string; disabled: boolean }[] = [
    {
      id: "auto",
      title: "Auto",
      detail: `${autoChain.map((provider) => provider.label).join(" → ")}${autoChain.length > 1 ? ", falls back on quota, credit or outage" : ""}`,
      disabled: autoChain.length === 0,
    },
    ...providers.map((provider) => ({
      id: provider.id,
      title: provider.label,
      detail: provider.configured
        ? `${provider.model} · ${provider.input}`
        : `Not configured: set ${provider.keyEnv}`,
      disabled: !provider.configured,
    })),
  ]
  const chosen = providers.find((provider) => provider.id === selection)

  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="AI provider" className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selection === option.id}
            disabled={option.disabled}
            onClick={() => onSelect(option.id)}
            className={cn(
              "rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              selection === option.id ? "border-primary bg-accent" : "hover:bg-accent/40",
            )}
          >
            <span className="block font-medium">{option.title}</span>
            <span className="block text-xs text-muted-foreground">{option.detail}</span>
          </button>
        ))}
      </div>
      {chosen && chosen.models.length > 1 ? (
        <div className="grid max-w-sm gap-1.5">
          <Label htmlFor="ai-model">{chosen.label} model</Label>
          <NativeSelect
            id="ai-model"
            value={model ?? chosen.model}
            onChange={(event) => onModel(chosen.id, event.target.value)}
          >
            {chosen.models.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
                {choice === chosen.model ? ` (${chosen.id.toUpperCase()}_MODEL)` : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
    </div>
  )
}

function DropZone({ onFile }: { onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files[0]
          if (file) onFile(file)
        }}
        className={cn(
          "flex min-h-72 cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed bg-card p-8 text-center transition-colors lg:col-span-2",
          dragging ? "border-primary bg-accent" : "hover:border-primary/60 hover:bg-accent/40",
        )}
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <UploadCloudIcon className="size-7" />
        </span>
        <span>
          <span className="block text-lg font-semibold">Drop a product video here</span>
          <span className="text-sm text-muted-foreground">
            or click to choose · MP4 (MOV/WebM also work) · up to 100 MB
          </span>
        </span>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_VIDEO_TYPES.join(",")}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onFile(file)
            event.target.value = ""
          }}
        />
      </button>
      <Card>
        <CardHeader>
          <CardTitle>Tips for best results</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2.5 text-sm text-muted-foreground">
            {[
              "Slowly rotate the pack so every side is visible.",
              "Pause for a second on the ingredients, MRP and net weight.",
              "Use good light and avoid glare on glossy labels.",
              "10–60 seconds is plenty.",
            ].map((tip) => (
              <li key={tip} className="flex gap-2">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                {tip}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function VideoCard({ file, url }: { file: File; url: string }) {
  return (
    <Card className="gap-3 overflow-hidden py-0">
      <video src={url} controls muted playsInline className="aspect-video w-full bg-black" />
      <div className="flex items-center gap-2 px-4 pb-4 text-sm">
        <FileVideoIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{file.name}</span>
        <span className="ml-auto shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
      </div>
    </Card>
  )
}

function Progress({ title, detail, percent }: { title: string; detail: string; percent: number }) {
  return (
    <div className="grid gap-3" role="status">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{detail}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

const FAILURE_TITLE: Partial<Record<AiErrorKind, string>> = {
  overloaded: "is overloaded right now (HTTP 503)",
  server_error: "had a temporary server error",
  quota: "quota or rate limit reached (HTTP 429)",
  insufficient_credits: "account has no credit left",
  model_unavailable: "model is not available",
  auth: "rejected the API key",
  network: "could not be reached",
  time_budget: "ran out of time (server limit)",
}

const STEP_LABEL: Record<string, string> = {
  not_configured: "not configured",
  no_frames: "skipped: no frames",
  quota: "quota / rate limit",
  insufficient_credits: "no credit",
  model_unavailable: "model unavailable",
  overloaded: "overloaded (503)",
  server_error: "server error",
  network: "unreachable",
  video_file_rejected: "video file rejected, used frames",
  video_too_large_for_direct_input: "video too large to send as a file, used frames",
  time_budget: "not tried: no time left in this request",
}

/** "Qwen: quota → DeepSeek: no credit → …": how Auto reached the provider that answered. */
function FallbackTrail({ steps }: { steps: FallbackStep[] }) {
  if (!steps.length) return null
  return (
    <ul className="grid gap-1 text-xs text-muted-foreground">
      {steps.map((step, index) => (
        <li key={index} className="flex gap-1.5" title={step.message}>
          <ArrowRightIcon className="mt-0.5 size-3 shrink-0" />
          <span>
            <span className="font-medium text-foreground">{PROVIDER_LABEL[step.provider]}</span> (
            {step.model}): {STEP_LABEL[step.kind] ?? step.kind}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Seconds left until `at + seconds`, ticking once a second. */
function useCountdown(at: number, seconds: number | null | undefined) {
  const [now, setNow] = useState(at)
  useEffect(() => {
    if (!seconds) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [seconds])
  return seconds ? Math.max(0, Math.ceil((at + seconds * 1000 - now) / 1000)) : 0
}

function FailurePanel({
  phase,
  providers,
  onRetry,
  onStartOver,
}: {
  phase: Extract<Phase, { kind: "error" }>
  providers: ProviderStatus[]
  onRetry: (request: Request) => void
  onStartOver: () => void
}) {
  const { failure, request } = phase
  const provider = failure.provider
  const wait = useCountdown(phase.at, failure.kind === "quota" ? failure.retryAfterSeconds : null)
  const sameRequestUseful = failure.kind !== "auth" && failure.kind !== "model_unavailable"
  const title =
    provider && failure.kind && FAILURE_TITLE[failure.kind]
      ? `${PROVIDER_LABEL[provider]} ${FAILURE_TITLE[failure.kind]}`
      : "Analysis failed"
  // Other models of the failing provider, then the other configured providers.
  const otherModels = provider
    ? (failure.suggestedModels ?? []).filter((id) => id !== failure.model).slice(0, 2)
    : []
  const otherProviders = providers.filter(
    (candidate) => candidate.configured && candidate.id !== provider,
  )

  return (
    <div className="grid gap-4">
      <ErrorCard title={title} message={failure.error} bare />
      {failure.fallbacks?.length ? (
        <div className="grid gap-1.5">
          <p className="text-xs font-medium">Tried first</p>
          <FallbackTrail steps={failure.fallbacks} />
        </div>
      ) : null}
      {failure.upload ? (
        <p className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <CloudCheckIcon className="size-4 shrink-0 text-success" />
          Your video is still stored at Gemini, so retrying on Gemini will not upload it again.
        </p>
      ) : null}
      {failure.kind === "auth" ? (
        <p className="text-xs text-muted-foreground">
          SellerOS never falls back silently on a rejected key: fix the key in .env.local and
          restart, or pick another provider below.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {sameRequestUseful ? (
          <Button onClick={() => onRetry(request)} disabled={wait > 0}>
            <RotateCcwIcon />
            {wait > 0 ? `Retry in ${wait}s` : "Retry"}
          </Button>
        ) : null}
        {provider
          ? otherModels.map((model) => (
              <Button
                key={model}
                variant="outline"
                onClick={() => onRetry({ selection: provider, model })}
              >
                <SparklesIcon /> {PROVIDER_LABEL[provider]} · {model}
              </Button>
            ))
          : null}
        {otherProviders.map((candidate) => (
          <Button
            key={candidate.id}
            variant="outline"
            onClick={() => onRetry({ selection: candidate.id, model: null })}
          >
            <SparklesIcon /> Try {candidate.label}
          </Button>
        ))}
        <Button variant="ghost" onClick={onStartOver}>
          Choose another video
        </Button>
      </div>
    </div>
  )
}

function ModelUnavailableNotice({ model, suggestions }: { model: string; suggestions: string[] }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200"
    >
      <p className="font-medium">
        GEMINI_MODEL is set to &quot;{model}&quot;, which your Gemini key cannot use.
      </p>
      <p className="mt-1">
        {suggestions.length
          ? `Gemini will use ${suggestions[0]} when selected. Available alternatives: ${suggestions.join(", ")}. To make it permanent, set GEMINI_MODEL in .env.local and restart the server.`
          : "Run `npm run gemini:models` to list the models your key can use, set GEMINI_MODEL in .env.local, and restart the server."}
      </p>
    </div>
  )
}

function Analysing({
  startedAt,
  label,
  reusedUpload,
}: {
  startedAt: number
  label: string
  reusedUpload: boolean
}) {
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000))

  return (
    <div className="grid gap-4" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2Icon className="size-6 animate-spin text-primary" />
        <div>
          <h2 className="text-lg font-semibold">AI is watching your video…</h2>
          <p className="text-sm text-muted-foreground">
            {label} · {seconds}s elapsed
            {reusedUpload ? " · reusing the video already stored at Gemini" : ""}
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Temporary overloads (HTTP 503) are retried automatically up to 3 times with increasing
        waits. In Auto, quota, credit and outage problems move on to the next provider.
      </p>
      <ol className="grid gap-1.5 text-sm text-muted-foreground">
        <li>1. Video (or its key frames) sent to the provider&apos;s vision model</li>
        <li>2. Model reads labels, packaging and narration</li>
        <li>3. Answer returned as JSON matching SellerOS&apos;s schema, then validated</li>
      </ol>
    </div>
  )
}

const LEVEL_STYLE = {
  high: { label: "High confidence", className: "bg-success/15 text-success" },
  medium: {
    label: "Medium confidence",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  low: { label: "Low confidence: please check", className: "bg-destructive/15 text-destructive" },
  missing: { label: "Not found in video", className: "bg-muted text-muted-foreground" },
} as const

function ConfidenceNote({
  value,
  confidence,
  evidence,
}: {
  value: unknown
  confidence: number
  evidence: string
}) {
  const level = confidenceLevel(value, confidence)
  const style = LEVEL_STYLE[level]
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium",
          style.className,
        )}
      >
        <SparklesIcon className="size-3" />
        {style.label}
        {level !== "missing" ? ` · ${Math.round(confidence * 100)}%` : ""}
      </span>
      {evidence && level !== "missing" ? <span className="italic">{evidence}</span> : null}
    </div>
  )
}

function Review({
  phase,
  onRestart,
  onSave,
}: {
  phase: Extract<Phase, { kind: "review" }>
  onRestart: () => void
  onSave: (productId: string) => void
}) {
  const { extraction, model, durationMs, usage, rawJson, providerLabel, inputMode, frameCount } =
    phase.result
  const { found, total } = extractionCoverage(extraction)

  const notes: Record<string, React.ReactNode> = {}
  for (const [extractionField, formField] of Object.entries(FIELD_FOR_EXTRACTION)) {
    const item = extraction[extractionField as ExtractionField]
    notes[formField] = <ConfidenceNote {...item} />
  }
  notes.quantity = "Not visible in a video: enter your current stock."
  notes.costPrice = "Not visible in a video: enter what one unit costs you."
  notes.sku = "Suggested automatically. Use your own if you have one."

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      <div className="grid gap-6 lg:sticky lg:top-24">
        <VideoCard file={phase.file} url={phase.url} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SparklesIcon className="size-4 text-primary" /> Extraction result
            </CardTitle>
            <CardDescription>{extraction.video_summary}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <div className="grid gap-2 rounded-md border border-primary/30 bg-accent/40 px-3 py-2">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-muted-foreground">Processed by</span>
                <Badge variant="success">{providerLabel}</Badge>
                <span className="font-mono text-xs">{model}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {inputMode === "frames"
                  ? `Analysed ${frameCount ?? 0} frames extracted in your browser${
                      phase.file.size > DIRECT_VIDEO_MAX_BYTES
                        ? ` (the ${formatMegabytes(phase.file.size)} video is over the ${formatMegabytes(DIRECT_VIDEO_MAX_BYTES)} upload limit, so it was not uploaded)`
                        : ""
                    }`
                  : "Analysed the full video file"}
                {phase.result.attempts > 1 ? ` · ${phase.result.attempts} attempts` : ""}
              </p>
              {phase.result.fallbacks.length ? (
                <FallbackTrail steps={phase.result.fallbacks} />
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Attributes" value={`${found}/${total}`} />
              <Stat label="Extra" value={String(extraction.additional_attributes.length)} />
              <Stat label="Time" value={`${(durationMs / 1000).toFixed(1)}s`} />
            </div>
            {extraction.quality_warnings.length ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">
                <p className="mb-1 font-medium">{providerLabel} noted</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {extraction.quality_warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {usage.totalTokens !== null ? (
              <p className="text-xs text-muted-foreground">
                {usage.totalTokens.toLocaleString("en-IN")} tokens
              </p>
            ) : null}
            <details className="group rounded-md border">
              <summary className="cursor-pointer px-3 py-2 font-medium select-none">
                View structured JSON from {providerLabel}
              </summary>
              <pre className="max-h-96 overflow-auto border-t bg-muted/50 p-3 font-mono text-xs leading-relaxed">
                {rawJson}
              </pre>
            </details>
            <Button variant="outline" onClick={onRestart}>
              <RotateCcwIcon /> Analyse another video
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4">
        <div className="rounded-lg border border-primary/30 bg-accent/60 p-4 text-sm">
          <p className="font-medium text-accent-foreground">Review before saving</p>
          <p className="text-muted-foreground">
            Every field below was filled by {providerLabel} and can be edited. Check anything marked
            low confidence, add stock and cost, then approve.
          </p>
        </div>
        <ProductForm
          initial={extractionToForm(extraction)}
          submitLabel="Approve & save product"
          fieldNotes={notes}
          onCancel={onRestart}
          onSubmit={(input) => {
            const product = addProduct(input, "ai_video")
            toast.success(`Saved ${product.name} to your catalogue`)
            onSave(product.id)
          }}
        />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/60 px-2 py-2">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

const SETUP_LINKS: Record<AiProviderId, { href: string; where: string }> = {
  qwen: {
    href: "https://modelstudio.console.alibabacloud.com/",
    where: "Alibaba Cloud Model Studio (Singapore region) → API Keys",
  },
  deepseek: {
    href: "https://platform.deepseek.com/api_keys",
    where: "DeepSeek Platform → API keys",
  },
  gemini: { href: "https://aistudio.google.com/apikey", where: "Google AI Studio → API keys" },
}

const code = "rounded bg-muted px-1 py-0.5 font-mono"

function SetupCard({ providers }: { providers: ProviderStatus[] }) {
  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="size-5 text-amber-600" /> Connect an AI provider to use the agent
        </CardTitle>
        <CardDescription>
          The AI Product Agent always calls a real vision model. SellerOS never shows made-up
          results, so it needs at least one API key. Auto uses Gemini first, then DeepSeek if
          configured.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <ol className="grid list-decimal gap-2 pl-5">
          <li>
            Create a key for any of:{" "}
            {providers.map((provider, index) => (
              <span key={provider.id}>
                {index ? ", " : ""}
                <a
                  href={SETUP_LINKS[provider.id].href}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {SETUP_LINKS[provider.id].where}
                </a>
              </span>
            ))}
            .
          </li>
          <li>
            Open <code className={code}>.env.local</code> in the SellerOS folder and set{" "}
            {providers.map((provider, index) => (
              <span key={provider.id}>
                {index ? " and/or " : ""}
                <code className={code}>{provider.keyEnv}=…</code>
              </span>
            ))}
            .
          </li>
          <li>
            Stop the dev server (Ctrl+C) and run <code className={code}>npm run dev</code> again,
            then reload this page.
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">See README → AI providers for details.</p>
      </CardContent>
    </Card>
  )
}

function ErrorCard({
  message,
  title = "Analysis failed",
  bare = false,
}: {
  message: string
  title?: string
  bare?: boolean
}) {
  const content = (
    <div role="alert" className="flex gap-3 text-sm">
      <CircleAlertIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div>
        <p className="font-medium text-destructive">{title}</p>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  )
  return bare ? (
    content
  ) : (
    <Card>
      <CardContent>{content}</CardContent>
    </Card>
  )
}
