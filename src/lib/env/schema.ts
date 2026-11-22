import { z } from "zod"

/**
 * Validation rules for environment variables. Kept free of `process.env`
 * access so it can be unit-tested and shared by the public and server modules.
 */

const nonEmpty = (name: string) =>
  z
    .string({ error: `${name} is missing` })
    .trim()
    .min(1, `${name} is missing`)

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: nonEmpty("NEXT_PUBLIC_SUPABASE_URL").pipe(
    z.url({ protocol: /^https?$/, error: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL" }),
  ),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: nonEmpty("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
})

/** Optional secret: blank or missing → undefined. */
const optionalKey = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined)

/** Optional setting with a default: blank (e.g. `QWEN_MODEL=`) means "use the default". */
const withDefault = (fallback: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => value || fallback)

const baseUrl = (fallback: string, name: string) =>
  withDefault(fallback).pipe(
    z
      .url({ protocol: /^https$/, error: `${name} must be an https URL` })
      .transform((url) => url.replace(/\/+$/, "")),
  )

/** Qwen (Alibaba Cloud Model Studio), Singapore / international region by default. */
export const DEFAULT_QWEN_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
export const DEFAULT_QWEN_MODEL = "qwen3-vl-flash"
/**
 * DeepSeek keys look like "sk-" followed by 32 hex characters. DeepSeek is
 * optional, so a blank, placeholder or malformed value leaves it switched off
 * instead of sending a request that can only fail.
 */
export const isPlausibleDeepSeekKey = (key: string | undefined): key is string =>
  Boolean(key && /^sk-[A-Za-z0-9]{20,}$/.test(key))

/** Primary AI provider model: fast, cheap and with a generous free quota. */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest"
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash-vision-exp"

// Every AI key is optional at startup so the rest of the app works without it;
// AI features check for keys and explain how to configure them (never a fake answer).
export const serverEnvSchema = z.object({
  GEMINI_API_KEY: optionalKey,
  GEMINI_MODEL: withDefault(DEFAULT_GEMINI_MODEL),
  QWEN_API_KEY: optionalKey,
  QWEN_MODEL: withDefault(DEFAULT_QWEN_MODEL),
  QWEN_BASE_URL: baseUrl(DEFAULT_QWEN_BASE_URL, "QWEN_BASE_URL"),
  DEEPSEEK_API_KEY: optionalKey,
  DEEPSEEK_MODEL: withDefault(DEFAULT_DEEPSEEK_MODEL),
  DEEPSEEK_BASE_URL: baseUrl(DEFAULT_DEEPSEEK_BASE_URL, "DEEPSEEK_BASE_URL"),
})

export type PublicEnv = z.infer<typeof publicEnvSchema>
export type ServerEnv = z.infer<typeof serverEnvSchema>

/** Parses `input`, throwing one readable error that lists every problem. */
export function parseEnv<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.message}`).join("\n")
    throw new Error(
      `Invalid environment configuration:\n${problems}\n` +
        `Copy .env.example to .env.local and fill in the values (see README).`,
    )
  }
  return result.data
}
