import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** Joins Tailwind class names, letting later classes override earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "Priya Sharma" → "PS"; falls back to the first letter of the email. */
export function initials(name: string | null | undefined, email = ""): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (email[0] ?? "?").toUpperCase()
}
