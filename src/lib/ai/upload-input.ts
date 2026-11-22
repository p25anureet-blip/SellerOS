import {
  FRAME_MIME_TYPES,
  MAX_FRAMES,
  MAX_FRAME_BYTES,
  frameTimesSchema,
  videoMetaSchema,
} from "./extraction-api"
import { ACCEPTED_VIDEO_TYPES, MAX_VIDEO_BYTES } from "./extraction-schema"
import type { VideoFrame, VideoMeta } from "./providers/types"

/**
 * Parses the multipart body of POST /api/ai/extract-product. Two shapes:
 *
 * - video path (videos ≤ 4 MB): "video" file, optional "frames" + "frameTimes";
 * - frames path (larger videos, which would exceed Vercel's 4.5 MB body
 *   limit): no "video", but "frames" + "frameTimes" + "videoMeta" (JSON
 *   {name, sizeBytes, mimeType} describing the original file).
 *
 * Returns the input or an HTTP status with a message the UI can show.
 */

export type UploadInput = { video: File | null; videoMeta: VideoMeta; frames: VideoFrame[] }
export type UploadInputError = { status: number; code: string; error: string }

/** Reads the browser-extracted frames (multipart "frames" files + "frameTimes" JSON). */
export async function readFrames(form: FormData): Promise<VideoFrame[] | string> {
  const files = form.getAll("frames").filter((entry): entry is File => entry instanceof File)
  if (files.length === 0) return []
  if (files.length > MAX_FRAMES) return `Send at most ${MAX_FRAMES} frames.`
  let times: number[]
  try {
    times = frameTimesSchema.parse(JSON.parse(String(form.get("frameTimes") ?? "[]")))
  } catch {
    return "frameTimes must be a JSON array of seconds."
  }
  if (times.length !== files.length) return "frameTimes must have one entry per frame."
  const frames: VideoFrame[] = []
  for (const [index, file] of files.entries()) {
    if (
      !(FRAME_MIME_TYPES as readonly string[]).includes(file.type) ||
      file.size > MAX_FRAME_BYTES
    ) {
      return "Frames must be JPEG, PNG or WebP images under 2 MB."
    }
    frames.push({
      timeSeconds: times[index],
      mimeType: file.type,
      base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
    })
  }
  return frames
}

export async function readUploadInput(form: FormData): Promise<UploadInput | UploadInputError> {
  const frames = await readFrames(form)
  if (typeof frames === "string") return { status: 400, code: "bad_frames", error: frames }

  const entry = form.get("video")
  const video = entry instanceof File && entry.size > 0 ? entry : null

  if (video) {
    if (!(ACCEPTED_VIDEO_TYPES as readonly string[]).includes(video.type)) {
      return {
        status: 415,
        code: "unsupported_type",
        error: "Upload an MP4 video (MOV and WebM also work).",
      }
    }
    if (video.size > MAX_VIDEO_BYTES) {
      return {
        status: 413,
        code: "too_large",
        error: "The video is larger than 100 MB. Please upload a shorter clip.",
      }
    }
    return {
      video,
      videoMeta: { name: video.name, sizeBytes: video.size, mimeType: video.type },
      frames,
    }
  }

  // Frames path: the video itself stayed in the browser.
  if (frames.length === 0) {
    return {
      status: 400,
      code: "no_video",
      error: "No video was uploaded (send the video file, or frames extracted from it).",
    }
  }
  let meta: unknown
  try {
    meta = JSON.parse(String(form.get("videoMeta") ?? ""))
  } catch {
    meta = null
  }
  const parsed = videoMetaSchema.safeParse(meta)
  if (!parsed.success) {
    return {
      status: 400,
      code: "bad_video_meta",
      error: "When only frames are sent, videoMeta must describe the original video.",
    }
  }
  return { video: null, videoMeta: parsed.data, frames }
}
