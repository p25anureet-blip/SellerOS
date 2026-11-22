"use server"

import { refresh } from "next/cache"
import { checkGeminiConnection, type GeminiCheckResult } from "@/lib/ai/gemini"
import { getCurrentOrganization, getCurrentUser } from "@/lib/auth"
import { DEMO_MODE } from "@/lib/demo"
import { createClient } from "@/lib/supabase/server"
import { type FormState, readFields, validationError } from "@/lib/validation/form-state"
import { organizationSchema } from "@/lib/validation/organization"

export async function updateOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  const organization = await getCurrentOrganization()
  const values = readFields(formData, ["name", "gstin"] as const)

  if (organization.role === "member") {
    return { status: "error", message: "Only owners and admins can edit the organization.", values }
  }

  const parsed = organizationSchema.safeParse(values)
  if (!parsed.success) return validationError(parsed.error, values)

  if (DEMO_MODE) {
    return {
      status: "error",
      message: "Demo mode has a fixed demo seller. Connect Supabase to edit organization details.",
      values,
    }
  }

  const supabase = await createClient()
  // RLS also enforces the owner/admin rule; .select() lets us detect a silent no-op.
  const { data, error } = await supabase
    .from("organizations")
    .update({ name: parsed.data.name, gstin: parsed.data.gstin })
    .eq("id", organization.id)
    .select("id")

  if (error) {
    return { status: "error", message: `Could not save: ${error.message}`, values }
  }
  if (!data?.length) {
    return { status: "error", message: "You don't have permission to edit this organization." }
  }

  refresh()
  return {
    status: "success",
    message: "Organization details saved.",
    values: { name: parsed.data.name, gstin: parsed.data.gstin ?? "" },
  }
}

export async function runGeminiCheck(): Promise<GeminiCheckResult> {
  // Only signed-in users may spend the project's Gemini quota.
  await getCurrentUser()
  return checkGeminiConnection()
}
