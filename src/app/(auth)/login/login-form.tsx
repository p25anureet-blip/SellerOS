"use client"

import { useActionState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2Icon } from "lucide-react"
import { signIn } from "../actions"
import { FormAlert } from "@/components/form-alert"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { initialFormState } from "@/lib/validation/form-state"

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialFormState)
  const next = useSearchParams().get("next") ?? ""

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormAlert state={state} />
      <FormField
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="you@store.in"
        defaultValue={state.values?.email}
        errors={state.fieldErrors?.email}
        required
      />
      <FormField
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        errors={state.fieldErrors?.password}
        required
      />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : null}
        {pending ? "Logging in…" : "Log in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New to SellerOS?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  )
}
