import type { Metadata } from "next"
import { Suspense } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Log in" }

export default function LoginPage() {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Log in to manage your catalogue and channels.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* The form reads ?next= from the URL, which happens at request time. */}
        <Suspense fallback={<Skeleton className="h-64" />}>
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  )
}
