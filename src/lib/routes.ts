/** Pages a logged-out visitor may open. Everything else requires login. */
const PUBLIC_PATHS = new Set(["/", "/login", "/signup"])

/** Pages a logged-in user should not see (they get sent to the dashboard). */
const AUTH_PAGES = new Set(["/login", "/signup"])

export const DEFAULT_AFTER_LOGIN = "/dashboard"

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(normalize(pathname))
}

export function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.has(normalize(pathname))
}

/**
 * Returns `target` only if it is a same-site path such as "/products?page=2".
 * Anything else ("https://evil.com", "//evil.com", "/\\evil.com") falls back to
 * the dashboard, so a crafted ?next= link cannot redirect users off-site.
 */
export function safeRedirectPath(target: unknown, fallback = DEFAULT_AFTER_LOGIN): string {
  if (typeof target !== "string") return fallback
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return fallback
  if (/[\u0000-\u001f]/.test(target)) return fallback
  if (isAuthPage(target.split(/[?#]/)[0])) return fallback
  return target
}

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
}
