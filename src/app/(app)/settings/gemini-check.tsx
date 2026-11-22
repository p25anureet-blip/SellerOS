"use client"

import { useState, useTransition } from "react"
import { CircleAlertIcon, CircleCheckIcon, Loader2Icon, SparklesIcon } from "lucide-react"
import { runGeminiCheck } from "./actions"
import { Button } from "@/components/ui/button"
import type { GeminiCheckResult } from "@/lib/ai/gemini"

export function GeminiCheck() {
  const [result, setResult] = useState<GeminiCheckResult | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="grid gap-4">
      <div>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setResult(await runGeminiCheck())
            })
          }
        >
          {pending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
          {pending ? "Contacting Gemini…" : "Test AI connection"}
        </Button>
      </div>

      {result?.ok ? (
        <div
          role="status"
          className="grid gap-2 rounded-md border border-success/30 bg-success/10 p-4 text-sm"
        >
          <p className="flex items-center gap-2 font-medium text-success">
            <CircleCheckIcon className="size-4" /> Gemini is connected
          </p>
          <blockquote className="border-l-2 border-success/40 pl-3 text-foreground">
            {result.reply}
          </blockquote>
          <p className="text-xs text-muted-foreground">
            Model <code className="font-mono">{result.model}</code> · {result.latencyMs} ms
            {result.totalTokens !== null ? ` · ${result.totalTokens} tokens` : ""}
          </p>
        </div>
      ) : null}

      {result && !result.ok ? (
        <div
          role="alert"
          className="grid gap-1 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm"
        >
          <p className="flex items-center gap-2 font-medium text-destructive">
            <CircleAlertIcon className="size-4" /> Gemini check failed
          </p>
          <p>{result.error}</p>
          <p className="text-xs text-muted-foreground">
            Model <code className="font-mono">{result.model}</code>
          </p>
        </div>
      ) : null}
    </div>
  )
}
