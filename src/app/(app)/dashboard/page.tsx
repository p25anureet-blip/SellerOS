import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { PlusIcon, SparklesIcon } from "lucide-react"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getCurrentOrganization, getCurrentUser } from "@/lib/auth"
import { DashboardOverview } from "./dashboard-overview"

export const metadata: Metadata = { title: "Dashboard" }

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Skeleton className="h-14 w-80" />}>
        <Greeting />
      </Suspense>
      <DashboardOverview />
    </div>
  )
}

async function Greeting() {
  const [user, organization] = await Promise.all([getCurrentUser(), getCurrentOrganization()])
  const firstName = user.fullName?.split(" ")[0]
  return (
    <PageHeader
      title={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
      description={`Here's how ${organization.name} is doing across your channels.`}
      actions={
        <>
          <Button variant="outline" asChild>
            <Link href="/media">
              <SparklesIcon /> Add from video
            </Link>
          </Button>
          <Button asChild>
            <Link href="/products/new">
              <PlusIcon /> Add product
            </Link>
          </Button>
        </>
      }
    />
  )
}
