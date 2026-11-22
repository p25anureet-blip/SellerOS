import { createBrowserClient } from "@supabase/ssr"
import { getSupabaseConfig } from "@/lib/env/public"
import type { Database } from "@/types/database"

/** Supabase client for Client Components. Uses the logged-in user's session. */
export function createClient() {
  const {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseKey,
  } = getSupabaseConfig()
  return createBrowserClient<Database>(supabaseUrl, supabaseKey)
}
