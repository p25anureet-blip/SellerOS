import { randomUUID } from "node:crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

export type Client = SupabaseClient<Database>

/** Reads a required variable from .env.local, failing with a useful message. */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `${name} is not set. Integration tests use the real services: fill in .env.local (see README).`,
    )
  }
  return value
}

const options = { auth: { persistSession: false, autoRefreshToken: false } } as const

/** Bypasses RLS. Used only to set up and inspect test data. */
export function adminClient(): Client {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    options,
  )
}

/** A logged-out visitor: what anyone on the internet could do with the public key. */
export function anonClient(): Client {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    options,
  )
}

export type TestUser = {
  id: string
  email: string
  organizationId: string
  /** A client logged in as this user, so RLS applies exactly as in the app. */
  client: Client
}

/**
 * Creates a confirmed user (which fires the sign-up trigger), then logs in as
 * them with the public key.
 */
export async function createTestUser(admin: Client, label: string): Promise<TestUser> {
  const email = `selleros-test-${label}-${randomUUID().slice(0, 8)}@example.com`
  const password = `Test-${randomUUID()}`

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: `Test User ${label.toUpperCase()}`,
      organization_name: `Org ${label}`,
    },
  })
  if (error || !data.user) throw new Error(`Could not create test user: ${error?.message}`)

  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", data.user.id)
    .single()
  if (membershipError) {
    throw new Error(`Sign-up trigger did not create a membership: ${membershipError.message}`)
  }

  const client = anonClient()
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`Could not sign in test user: ${signInError.message}`)

  return { id: data.user.id, email, organizationId: membership.organization_id, client }
}

/** Removes the users and their organizations. Safe to call with partial setup. */
export async function deleteTestUsers(admin: Client, users: (TestUser | undefined)[]) {
  const created = users.filter((user): user is TestUser => Boolean(user))
  const orgIds = created.map((user) => user.organizationId)
  if (orgIds.length) await admin.from("organizations").delete().in("id", orgIds)
  for (const user of created) await admin.auth.admin.deleteUser(user.id)
}

/** PostgreSQL's "insufficient privilege" error code. */
export const PERMISSION_DENIED = "42501"
