import { z } from "zod"

/** Same rule as the `organizations.gstin` check constraint in the database. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

export const organizationSchema = z.object({
  name: z.string().trim().min(2, "Enter your store or company name").max(120, "Name is too long"),
  // Optional: blank means "not set". Stored upper-case, as GSTINs are printed.
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .transform((value) => (value === "" ? null : value))
    .refine((value) => value === null || GSTIN_PATTERN.test(value), {
      message: "Enter a valid 15-character GSTIN, e.g. 27AAPFU0939F1ZV",
    }),
})

export type OrganizationInput = z.infer<typeof organizationSchema>
