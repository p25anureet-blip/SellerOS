import { z } from "zod"

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email")
  .pipe(z.email("Enter a valid email address"))

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password"),
})

export const signupSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter your name (at least 2 characters)")
    .max(120, "Name is too long"),
  organizationName: z
    .string()
    .trim()
    .min(2, "Enter your store or company name")
    .max(120, "Name is too long"),
  email,
  password: z
    .string()
    .min(8, "Use at least 8 characters")
    .max(72, "Use at most 72 characters")
    .regex(/[A-Za-z]/, "Include at least one letter")
    .regex(/[0-9]/, "Include at least one number"),
})

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
