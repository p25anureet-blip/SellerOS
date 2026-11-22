/**
 * Picks alternative Gemini models from the list your API key can use
 * (models.list via the SDK). Pure, so the ranking is unit-tested.
 */

/** "models/gemini-flash-latest" → "gemini-flash-latest". */
export const modelId = (name: string) => name.trim().replace(/^models\//, "")

/** Ids we accept from the UI for a retry: plain model ids only. */
export const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,79}$/

const NOT_FOR_VIDEO_TO_JSON =
  /tts|image|banana|transcribe|embedding|embed|live|audio|computer-use|robotics|customtools|deep-research|antigravity|lyria|veo|imagen|aqa|learnlm/

/** Gemini models that take video and return text: the ones useful for the product agent. */
export function isVideoAnalysisModel(id: string): boolean {
  return /^gemini-/.test(id) && /flash|pro/.test(id) && !NOT_FOR_VIDEO_TO_JSON.test(id)
}

/**
 * Ranking: "-latest" aliases (always a current model) > stable > preview;
 * Flash (fast, good at video) > Flash-Lite > Pro (slower, lower free quota);
 * the version number is only a tiebreaker.
 */
function score(id: string): number {
  const family = /lite/.test(id) ? 10 : /flash/.test(id) ? 15 : /pro/.test(id) ? 5 : 0
  const version = Number(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0)
  return (
    (/-latest$/.test(id) ? 40 : 0) +
    (/preview|exp/.test(id) ? 0 : 20) +
    family +
    Math.min(9, version)
  )
}

/** Up to `limit` alternatives to `current`, best first. */
export function suggestAlternativeModels(
  current: string,
  available: readonly string[],
  limit = 3,
): string[] {
  const currentId = modelId(current)
  return [...new Set(available.map(modelId))]
    .filter((id) => id !== currentId && isVideoAnalysisModel(id))
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b))
    .slice(0, limit)
}
