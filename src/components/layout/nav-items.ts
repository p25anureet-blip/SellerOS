import {
  BoxIcon,
  IndianRupeeIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  PlugIcon,
  SettingsIcon,
  SparklesIcon,
  StoreIcon,
  WarehouseIcon,
} from "lucide-react"

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  description: string
  /** The roadmap phase that builds this section; undefined = available now. */
  phase?: number
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    description: "Your business at a glance.",
  },
  {
    href: "/products",
    label: "Products",
    icon: BoxIcon,
    description: "Your central catalogue: one source of truth for every channel.",
  },
  {
    href: "/media",
    label: "AI Product Agent",
    icon: SparklesIcon,
    description: "Upload a product video and let Gemini extract its attributes.",
  },
  {
    href: "/listings",
    label: "Listings",
    icon: StoreIcon,
    description: "Marketplace-ready listings, attribute mapping and CSV exports.",
  },
  {
    href: "/insights",
    label: "Pricing",
    icon: IndianRupeeIcon,
    description: "Work out costs, contribution margin and the right selling price.",
  },
  {
    href: "/inventory",
    label: "Inventory",
    icon: WarehouseIcon,
    description: "Split limited stock across marketplaces for maximum expected profit.",
  },
  {
    href: "/channels",
    label: "Channels",
    icon: PlugIcon,
    description: "The marketplaces SellerOS prepares listings for, and their fees.",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
    description: "Workspace details, demo data and system checks.",
  },
]

/** True when `pathname` is the item's page or one of its sub-pages. */
export function isActive(item: Pick<NavItem, "href">, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

export function findNavItem(href: string): NavItem {
  const item = NAV_ITEMS.find((candidate) => candidate.href === href)
  if (!item) throw new Error(`No navigation item for ${href}`)
  return item
}
