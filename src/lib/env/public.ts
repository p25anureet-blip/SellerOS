import { type PublicEnv, parseEnv, publicEnvSchema } from "./schema"

let cached: PublicEnv | undefined

/**
 * Supabase connection settings, validated on first use (not at import time) so
 * that DEMO_MODE can run the app without any Supabase credentials.
 */
export function getSupabaseConfig(): PublicEnv {
  // Each variable is referenced by its full literal name so Next.js can inline it
  // into browser bundles (it cannot inline `process.env[name]`).
  cached ??= parseEnv(publicEnvSchema, {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  })
  return cached
}
