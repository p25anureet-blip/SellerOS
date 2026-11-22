import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { DEMO_MODE } from "@/lib/demo"
import { getSupabaseConfig } from "@/lib/env/public"
import { isAuthPage, isPublicPath, safeRedirectPath } from "@/lib/routes"
import type { Database } from "@/types/database"

/**
 * Runs before every page request:
 *  1. Refreshes the Supabase session cookie if it is about to expire.
 *  2. Sends logged-out visitors on protected pages to /login.
 *  3. Sends logged-in users away from /login and /signup.
 *
 * This is a convenience for routing only. Real authorization happens in the
 * data access layer (src/lib/auth.ts) and in the database via RLS.
 */
export async function updateSession(request: NextRequest) {
  // Demo mode: no Supabase, no login. Everyone is the built-in demo seller.
  if (DEMO_MODE) {
    return isAuthPage(request.nextUrl.pathname)
      ? NextResponse.redirect(new URL("/dashboard", request.url))
      : NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })
  const {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseKey,
  } = getSupabaseConfig()

  const supabase = createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value))
      },
    },
  })

  // Do not put any code between createServerClient and getClaims(): getClaims
  // is what triggers the cookie refresh above.
  const { data } = await supabase.auth.getClaims()
  const isLoggedIn = Boolean(data?.claims?.sub)
  const { pathname, search } = request.nextUrl

  if (!isLoggedIn && !isPublicPath(pathname)) {
    return redirectPreservingCookies(request, response, "/login", {
      next: safeRedirectPath(pathname + search),
    })
  }

  if (isLoggedIn && isAuthPage(pathname)) {
    return redirectPreservingCookies(request, response, "/dashboard")
  }

  return response
}

function redirectPreservingCookies(
  request: NextRequest,
  from: NextResponse,
  pathname: string,
  params: Record<string, string> = {},
) {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  url.search = new URLSearchParams(params).toString()
  const redirect = NextResponse.redirect(url)
  // Carry over any refreshed session cookies so the user is not logged out.
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
  return redirect
}
