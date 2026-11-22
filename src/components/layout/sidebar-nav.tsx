"use client"

import { Suspense } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { NAV_ITEMS, isActive } from "./nav-items"

type NavProps = { onNavigate?: () => void }

/**
 * The current URL is request-time data, so the highlighted state streams in
 * behind Suspense; the plain list renders instantly as the fallback.
 */
export function SidebarNav(props: NavProps) {
  return (
    <Suspense fallback={<NavList pathname={null} {...props} />}>
      <ActiveSidebarNav {...props} />
    </Suspense>
  )
}

function ActiveSidebarNav(props: NavProps) {
  return <NavList pathname={usePathname()} {...props} />
}

function NavList({ pathname, onNavigate }: NavProps & { pathname: string | null }) {
  return (
    <nav aria-label="Main" className="grid gap-1">
      {NAV_ITEMS.map((item) => {
        const active = pathname !== null && isActive(item, pathname)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.phase ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                Soon
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
