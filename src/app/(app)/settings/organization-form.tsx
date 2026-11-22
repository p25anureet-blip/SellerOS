"use client"

import { useActionState, useEffect } from "react"
import { Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { updateOrganization } from "./actions"
import { FormAlert } from "@/components/form-alert"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { initialFormState } from "@/lib/validation/form-state"

type OrganizationFormProps = {
  name: string
  gstin: string | null
  canEdit: boolean
}

export function OrganizationForm({ name, gstin, canEdit }: OrganizationFormProps) {
  const [state, formAction, pending] = useActionState(updateOrganization, initialFormState)

  useEffect(() => {
    if (state.status === "success" && state.message) toast.success(state.message)
  }, [state])

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      {state.status === "error" ? <FormAlert state={state} /> : null}
      <FormField
        name="name"
        label="Store / company name"
        defaultValue={state.values?.name ?? name}
        errors={state.fieldErrors?.name}
        disabled={!canEdit}
        required
      />
      <FormField
        name="gstin"
        label="GSTIN (optional)"
        placeholder="27AAPFU0939F1ZV"
        hint="Your 15-character GST Identification Number. Used later on invoices and exports."
        defaultValue={state.values?.gstin ?? gstin ?? ""}
        errors={state.fieldErrors?.gstin}
        disabled={!canEdit}
        className="max-w-sm"
        autoCapitalize="characters"
        maxLength={15}
      />
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only owners and admins can edit these.</p>
      )}
    </form>
  )
}
