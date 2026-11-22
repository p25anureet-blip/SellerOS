"use server"

import { redirect } from "next/navigation"
import { DEMO_MODE } from "@/lib/demo"
import { DEFAULT_AFTER_LOGIN, safeRedirectPath } from "@/lib/routes"
import { createClient } from "@/lib/supabase/server"
import { loginSchema, signupSchema } from "@/lib/validation/auth"
import { type FormState, readFields, validationError } from "@/lib/validation/form-state"

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const fields = readFields(formData, ["email", "password", "next"] as const)
  const values = { email: fields.email }

  const parsed = loginSchema.safeParse(fields)
  if (!parsed.success) return validationError(parsed.error, values)

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    const message =
      error.code === "email_not_confirmed"
        ? "Please confirm your email address first (check your inbox)."
        : error.code === "invalid_credentials"
          ? "Incorrect email or password."
          : `Could not log in: ${error.message}`
    return { status: "error", message, values }
  }

  // redirect() throws to end the action, so it must stay outside try/catch.
  redirect(safeRedirectPath(fields.next))
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const fields = readFields(formData, [
    "fullName",
    "organizationName",
    "email",
    "password",
  ] as const)
  // Echo back everything except the password.
  const values = {
    fullName: fields.fullName,
    organizationName: fields.organizationName,
    email: fields.email,
  }

  const parsed = signupSchema.safeParse(fields)
  if (!parsed.success) return validationError(parsed.error, values)

  const { fullName, organizationName, email, password } = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // Read by the handle_new_user() database trigger to name the profile and organization.
    options: { data: { full_name: fullName, organization_name: organizationName } },
  })

  if (error) {
    const message =
      error.code === "user_already_exists"
        ? "An account with this email already exists. Try logging in."
        : error.code === "weak_password"
          ? "That password is too weak. Try a longer one."
          : error.code === "over_email_send_rate_limit"
            ? "Too many sign-up attempts. Please wait a few minutes."
            : `Could not create your account: ${error.message}`
    return { status: "error", message, values }
  }

  // If the Supabase project requires email confirmation there is no session yet.
  if (!data.session) {
    return {
      status: "success",
      message: "Account created. Check your email to confirm it, then log in.",
      values,
    }
  }

  redirect(DEFAULT_AFTER_LOGIN)
}

export async function signOut(): Promise<void> {
  if (DEMO_MODE) redirect("/")
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
