import { NextResponse, connection } from "next/server"
import { checkModelAvailability, isGeminiConfigured } from "@/lib/ai/gemini"
import { type ProviderStatus, providerStatuses } from "@/lib/ai/providers/registry"

export type { ProviderStatus } from "@/lib/ai/providers/registry"

export type AiStatus = {
  /** At least one provider has a key. */
  configured: boolean
  /** Qwen, DeepSeek, Gemini: the Auto order. Never contains keys. */
  providers: ProviderStatus[]
  /** False when GEMINI_MODEL is not available to the Gemini key; null if unknown or not configured. */
  geminiModelAvailable: boolean | null
}

/** Lets the AI page show which providers are set up, and setup steps when none are. */
export async function GET() {
  // Answer per request: otherwise the build would freeze which keys were set at build time.
  await connection()
  const providers = await providerStatuses()
  const gemini = isGeminiConfigured() ? await checkModelAvailability() : null
  return NextResponse.json<AiStatus>({
    configured: providers.some((provider) => provider.configured),
    providers,
    geminiModelAvailable: gemini?.available ?? null,
  })
}
