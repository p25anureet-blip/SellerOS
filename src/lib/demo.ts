import type { CurrentOrganization, CurrentUser } from "@/lib/auth"

/**
 * DEMO_MODE (set DEMO_MODE=true in .env.local) runs SellerOS without Supabase:
 * no login, a built-in demo seller, and product data kept in the browser's
 * localStorage. The Supabase code paths are untouched and take over again
 * when DEMO_MODE is off.
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true"

export const DEMO_USER: CurrentUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "demo@selleros.in",
  fullName: "Ananya Iyer",
}

export const DEMO_ORGANIZATION: CurrentOrganization = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Iyer Naturals",
  gstin: "29ABCDE1234F1Z5",
  role: "owner",
}
