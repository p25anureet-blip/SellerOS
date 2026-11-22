import type { Metadata } from "next"
import { Suspense } from "react"
import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getCurrentOrganization, getCurrentUser } from "@/lib/auth"
import { DEMO_MODE } from "@/lib/demo"
import { DemoData } from "./demo-data"
import { GeminiCheck } from "./gemini-check"
import { OrganizationForm } from "./organization-form"

export const metadata: Metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Your workspace details and system checks." />

      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>How your business appears across SellerOS.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-48" />}>
            <OrganizationSection />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>The login you are using.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-16" />}>
            <AccountSection />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI engine</CardTitle>
          <CardDescription>
            SellerOS uses Google Gemini for video attribute extraction and listing copy. This sends
            one small, real request to confirm the connection works.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GeminiCheck />
        </CardContent>
      </Card>

      {DEMO_MODE ? (
        <Card>
          <CardHeader>
            <CardTitle>Demo data</CardTitle>
            <CardDescription>
              Demo mode keeps products and listings in this browser&apos;s storage. Reset before a
              presentation to start from the sample catalogue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DemoData />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

async function OrganizationSection() {
  const organization = await getCurrentOrganization()
  return (
    <OrganizationForm
      name={organization.name}
      gstin={organization.gstin}
      canEdit={organization.role !== "member"}
    />
  )
}

async function AccountSection() {
  const [user, organization] = await Promise.all([getCurrentUser(), getCurrentOrganization()])
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-muted-foreground">Name</dt>
        <dd className="font-medium">{user.fullName ?? "Not set"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Email</dt>
        <dd className="font-medium break-all">{user.email}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Role</dt>
        <dd>
          <Badge variant="secondary" className="capitalize">
            {organization.role}
          </Badge>
        </dd>
      </div>
    </dl>
  )
}
