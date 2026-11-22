import { Suspense } from "react"
import { Logo } from "@/components/logo"
import { MobileNav } from "@/components/layout/mobile-nav"
import { SidebarNav } from "@/components/layout/sidebar-nav"
import { UserMenu } from "@/components/layout/user-menu"
import { ThemeToggle } from "@/components/theme-toggle"
import { Skeleton } from "@/components/ui/skeleton"
import { getCurrentOrganization, getCurrentUser } from "@/lib/auth"
import { DEMO_MODE } from "@/lib/demo"

/**
 * Shell for every logged-in page. The sidebar and top bar are static, so they
 * render instantly; only the account menu (which needs the session) streams in.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 lg:flex">
        <Logo href="/dashboard" className="mb-8 px-2" />
        <SidebarNav />
        {DEMO_MODE ? (
          <div className="mt-auto rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Demo mode</p>
            <p className="mt-0.5">Data is saved in this browser.</p>
          </div>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
          <MobileNav />
          <Logo href="/dashboard" className="lg:hidden" />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <Suspense fallback={<Skeleton className="h-10 w-44" />}>
              <AccountMenu />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      </div>
    </div>
  )
}

async function AccountMenu() {
  const [user, organization] = await Promise.all([getCurrentUser(), getCurrentOrganization()])
  return (
    <UserMenu fullName={user.fullName} email={user.email} organizationName={organization.name} />
  )
}
