/**
 * Extracts representative still frames from a video in the browser (no
 * ffmpeg, no server work). Used for DeepSeek, which reads images, and as
 * Qwen's fallback when the video file is too large to send directly.
 *
 * The video is split into `count` equal slots. In each slot two candidate
 * moments are tried and the sharper one is kept (variance of the Laplacian),
 * so the frames favour moments where the label is in focus.
 */

export const DEFAULT_FRAME_COUNT = 12
export const FRAME_MAX_EDGE = 1024
const SHARPNESS_SAMPLE_EDGE = 160

export type ExtractedFrame = { timeSeconds: number; blob: Blob }

/** Candidate timestamps: two per slot, at 1/3 and 2/3 of the slot, kept clear of the very end. */
export function candidateTimes(durationSeconds: number, count = DEFAULT_FRAME_COUNT): number[][] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || count < 1) return []
  const slot = durationSeconds / count
  const last = Math.max(0, durationSeconds - 0.05)
  return Array.from({ length: count }, (_, index) =>
    [1 / 3, 2 / 3].map((fraction) => Math.min(last, (index + fraction) * slot)),
  )
}

/** Variance of the 4-neighbour Laplacian of a greyscale image: higher = sharper. */
export function sharpness(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0
  let sum = 0
  let sumSquares = 0
  let n = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const laplacian = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i]
      sum += laplacian
      sumSquares += laplacian * laplacian
      n++
    }
  }
  const mean = sum / n
  return sumSquares / n - mean * mean
}

/** Output size keeping the aspect ratio, longest edge at most `maxEdge`. */
export function fitWithin(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function once(target: EventTarget, event: string, timeoutMs = 10_000) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for video ${event}`)),
      timeoutMs,
    )
    target.addEventListener(event, () => (clearTimeout(timer), resolve()), { once: true })
    target.addEventListener(
      "error",
      () => (clearTimeout(timer), reject(new Error("The browser could not decode this video."))),
      { once: true },
    )
  })
}

async function seek(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.001) return
  const seeked = once(video, "seeked")
  video.currentTime = time
  await seeked
}

/** Some recordings (e.g. MediaRecorder WebM) report Infinity until the end has been seeked once. */
async function realDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration
  const changed = once(video, "durationchange")
  video.currentTime = Number.MAX_SAFE_INTEGER
  await changed.catch(() => undefined)
  const duration = video.duration
  await seek(video, 0)
  return Number.isFinite(duration) ? duration : 0
}

function grayscale(context: CanvasRenderingContext2D, width: number, height: number) {
  const { data } = context.getImageData(0, 0, width, height)
  const gray = new Float32Array(width * height)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }
  return gray
}

/** Extracts up to `count` sharp, evenly spread JPEG frames. Throws if the browser cannot decode the video. */
export async function extractFrames(
  file: File,
  { count = DEFAULT_FRAME_COUNT, maxEdge = FRAME_MAX_EDGE, quality = 0.82 } = {},
): Promise<ExtractedFrame[]> {
  const url = URL.createObjectURL(file)
  const video = document.createElement("video")
  video.muted = true
  video.playsInline = true
  video.preload = "auto"
  try {
    const loaded = once(video, "loadeddata", 20_000)
    video.src = url
    await loaded
    const duration = await realDuration(video)
    if (!video.videoWidth || !duration) throw new Error("The video has no readable frames.")

    const sample = fitWithin(video.videoWidth, video.videoHeight, SHARPNESS_SAMPLE_EDGE)
    const sampleCanvas = Object.assign(document.createElement("canvas"), sample)
    const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true })!
    const out = fitWithin(video.videoWidth, video.videoHeight, maxEdge)
    const canvas = Object.assign(document.createElement("canvas"), out)
    const context = canvas.getContext("2d")!

    const frames: ExtractedFrame[] = []
    for (const candidates of candidateTimes(duration, count)) {
      let best = { time: candidates[0], score: -1 }
      for (const time of candidates) {
        await seek(video, time)
        sampleContext.drawImage(video, 0, 0, sample.width, sample.height)
        const score = sharpness(
          grayscale(sampleContext, sample.width, sample.height),
          sample.width,
          sample.height,
        )
        if (score > best.score) best = { time, score }
      }
      await seek(video, best.time)
      context.drawImage(video, 0, 0, out.width, out.height)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      )
      if (blob) frames.push({ timeSeconds: Math.round(best.time * 100) / 100, blob })
    }
    return frames
  } finally {
    video.removeAttribute("src")
    video.load()
    URL.revokeObjectURL(url)
  }
}
