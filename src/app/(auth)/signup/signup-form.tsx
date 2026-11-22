"use client"

import { useActionState } from "react"
import Link from "next/link"
import { Loader2Icon } from "lucide-react"
import { signUp } from "../actions"
import { FormAlert } from "@/components/form-alert"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { initialFormState } from "@/lib/validation/form-state"

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, initialFormState)
  const errors = state.fieldErrors

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <FormAlert state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          name="fullName"
          label="Your name"
          autoComplete="name"
          placeholder="Priya Sharma"
          defaultValue={state.values?.fullName}
          errors={errors?.fullName}
          required
        />
        <FormField
          name="organizationName"
          label="Store / company"
          autoComplete="organization"
          placeholder="Sharma Handlooms"
          defaultValue={state.values?.organizationName}
          errors={errors?.organizationName}
          required
        />
      </div>
      <FormField
        name="email"
        label="Work email"
        type="email"
        autoComplete="email"
        placeholder="you@store.in"
        defaultValue={state.values?.email}
        errors={errors?.email}
        required
      />
      <FormField
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters, with a letter and a number."
        errors={errors?.password}
        required
      />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : null}
        {pending ? "Creating your workspace…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Log in
        </Link>
      </p>
    </form>
  )
}
