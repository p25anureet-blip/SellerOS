import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { DEMO_MODE, DEMO_ORGANIZATION, DEMO_USER } from "@/lib/demo"
import { createClient } from "@/lib/supabase/server"
import type { Enums } from "@/types/database"

/**
 * Data access layer for "who is this request from?".
 *
 * Every Server Component, Server Action and Route Handler that needs the user
 * calls these functions instead of trusting the proxy. React's cache() makes
 * repeated calls within one request free.
 *
 * Note: with Cache Components enabled, anything that calls these must render
 * inside a <Suspense> boundary because it reads the request's cookies.
 */

export type CurrentUser = {
  id: string
  email: string
  fullName: string | null
}

export type CurrentOrganization = {
  id: string
  name: string
  gstin: string | null
  role: Enums<"org_role">
}

/** The logged-in user, or null. Never redirects. */
export const getOptionalUser = cache(async (): Promise<CurrentUser | null> => {
  if (DEMO_MODE) return DEMO_USER
  const supabase = await createClient()
  // getClaims() verifies the session token's signature, unlike getSession().
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (error || !claims?.sub) return null

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", claims.sub)
    .maybeSingle()

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    fullName: profile?.full_name ?? null,
  }
})

/** The logged-in user. Sends the visitor to /login if there is none. */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const user = await getOptionalUser()
  if (!user) redirect("/login")
  return user
})

/**
 * The organization the user is working in. Each user currently has exactly one
 * (created at sign-up); when multi-organization support arrives, this is where
 * the "active organization" choice will be read.
 */
export const getCurrentOrganization = cache(async (): Promise<CurrentOrganization> => {
  if (DEMO_MODE) return DEMO_ORGANIZATION
  const user = await getCurrentUser()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organization:organizations (id, name, gstin)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Could not load your organization: ${error.message}`)
  if (!data?.organization) {
    // The sign-up trigger always creates one, so this means the account is broken.
    throw new Error("Your account is not linked to an organization.")
  }

  return {
    id: data.organization.id,
    name: data.organization.name,
    gstin: data.organization.gstin,
    role: data.role,
  }
})
