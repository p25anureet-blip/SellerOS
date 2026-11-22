import { z } from "zod"
import { CATEGORIES } from "@/lib/catalog/product"
import { extractionSchema } from "./extraction-schema"

/**
 * The extraction instructions shared by every AI provider, so Gemini, Qwen and
 * DeepSeek follow the same rules and return the same schema. Pure.
 */

export const EXTRACTION_PROMPT = `You are the product data agent of SellerOS, a catalogue tool for Indian e-commerce and quick-commerce sellers.

Watch the attached product video carefully, including any text on labels, packaging, price stickers and anything spoken aloud. Extract the product's attributes for a marketplace listing.

Rules:
- Only report what you can actually see or hear. If something is not visible, set "value" to null and "confidence" to 0. Never invent ingredients, prices, addresses or weights.
- Copy printed text (brand, ingredients, manufacturer) exactly; fix only obvious OCR-style errors.
- Indian packs show "MRP ₹… (incl. of all taxes)" and "Net Wt." or "Net Qty." – use these.
- Dimensions are usually not printed: you may estimate them from visual scale (hands, common objects), but give confidence 0.5 or lower and say "estimated" in the evidence.
- category must be one of: ${CATEGORIES.map((category) => `${category.value} (${category.label})`).join(", ")}.
- Evidence must include the timestamp (mm:ss) where you saw the information.
- The description must be factual and based only on what the video shows.`

/** JSON Schema of the extraction, generated from the same Zod schema the server validates with. */
export const EXTRACTION_JSON_SCHEMA = z.toJSONSchema(extractionSchema)

/**
 * For OpenAI-compatible providers (Qwen, DeepSeek), which get the schema in
 * the prompt and return JSON mode output. The word "JSON" is required by
 * both APIs when response_format is json_object.
 */
export function jsonPrompt(input: "video_file" | "frames", frameTimes: readonly number[] = []) {
  const media =
    input === "frames" ? framesNote(frameTimes.length) : "You are given the product video file."
  return `${EXTRACTION_PROMPT}

${media}

Answer with a single JSON object and nothing else (no markdown, no code fences). It must match this JSON Schema exactly: every property is required; use null for "value" when something is not visible.
${JSON.stringify(EXTRACTION_JSON_SCHEMA)}`
}

/** "75.4" seconds → "01:15". */
export function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`
}

/** Tells the model it sees still frames, not the video, and how to cite them. */
export function framesNote(count: number) {
  return `You are given ${count} still frames taken from the product video, in order, instead of the video itself (there is no audio). Each frame is preceded by its timestamp; use those timestamps (mm:ss) as evidence.`
}

/** A frame as Gemini content parts: its timestamp label, then the inline image. */
export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

/** Gemini request parts for the frames path (large videos): labelled inline images, then the prompt. */
export function geminiFramesParts(
  frames: readonly { timeSeconds: number; mimeType: string; base64: string }[],
): GeminiPart[] {
  const parts: GeminiPart[] = []
  for (const frame of frames) {
    parts.push({ text: `Frame at ${formatTimestamp(frame.timeSeconds)}` })
    parts.push({ inlineData: { mimeType: frame.mimeType, data: frame.base64 } })
  }
  parts.push({ text: `${EXTRACTION_PROMPT}\n\n${framesNote(frames.length)}` })
  return parts
}
