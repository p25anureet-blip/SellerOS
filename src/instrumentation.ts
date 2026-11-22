/**
 * Runs once when the Next.js server starts. Validating configuration here means
 * a missing or malformed key stops the app immediately with a clear message,
 * instead of failing later on whichever page first needs it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { isPlausibleDeepSeekKey, parseEnv, publicEnvSchema, serverEnvSchema } =
    await import("./lib/env/schema")
  const serverEnv = parseEnv(serverEnvSchema, process.env)

  if (process.env.DEMO_MODE === "true") {
    console.log("▶ SellerOS DEMO_MODE: no login, demo seller, data stored in the browser.")
  } else {
    parseEnv(publicEnvSchema, process.env)
  }

  const deepseekReady = isPlausibleDeepSeekKey(serverEnv.DEEPSEEK_API_KEY)
  if (serverEnv.DEEPSEEK_API_KEY && !deepseekReady) {
    console.warn("⚠ DEEPSEEK_API_KEY does not look like a DeepSeek key (sk-…): DeepSeek stays off.")
  }
  const providers = [
    serverEnv.GEMINI_API_KEY && `Gemini (${serverEnv.GEMINI_MODEL})`,
    deepseekReady && `DeepSeek (${serverEnv.DEEPSEEK_MODEL})`,
    serverEnv.QWEN_API_KEY && `Qwen (${serverEnv.QWEN_MODEL}, manual only)`,
  ].filter(Boolean)
  if (providers.length) {
    console.log(`▶ AI providers configured: ${providers.join(", ")}`)
  } else {
    console.warn(
      "⚠ No AI provider key is set (GEMINI_API_KEY, or optionally DEEPSEEK_API_KEY): the AI Product Agent will show setup instructions.",
    )
  }
}
