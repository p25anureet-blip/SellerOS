import "server-only"
import { parseEnv, serverEnvSchema } from "./schema"

// Secrets. The "server-only" import makes the build fail if this module is
// ever imported from code that runs in the browser.
export const serverEnv = parseEnv(serverEnvSchema, {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || undefined,
  QWEN_API_KEY: process.env.QWEN_API_KEY,
  QWEN_MODEL: process.env.QWEN_MODEL || undefined,
  QWEN_BASE_URL: process.env.QWEN_BASE_URL || undefined,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || undefined,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || undefined,
})

/** Every configured AI key, so error messages and logs can redact them. */
export const aiSecrets = (): string[] =>
  [serverEnv.GEMINI_API_KEY, serverEnv.QWEN_API_KEY, serverEnv.DEEPSEEK_API_KEY].filter(
    (key): key is string => Boolean(key),
  )
