import type { z } from "zod"

/** What a Server Action returns to a form (via React's useActionState). */
export type FormState = {
  status: "idle" | "error" | "success"
  message?: string
  fieldErrors?: Record<string, string[] | undefined>
  /** Echo of submitted text fields, so the form keeps what the user typed. */
  values?: Record<string, string>
}

export const initialFormState: FormState = { status: "idle" }

/** Reads the named text fields out of a submitted form. */
export function readFields<const K extends string>(
  formData: FormData,
  keys: readonly K[],
): Record<K, string> {
  return Object.fromEntries(
    keys.map((key) => {
      const value = formData.get(key)
      return [key, typeof value === "string" ? value : ""]
    }),
  ) as Record<K, string>
}

/** Turns a Zod failure into per-field messages for the form. */
export function validationError(error: z.ZodError, values: Record<string, string>): FormState {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form")
    ;(fieldErrors[key] ??= []).push(issue.message)
  }
  return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, values }
}
