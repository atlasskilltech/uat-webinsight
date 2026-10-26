import { z } from "zod";

/** Normalised email: trimmed, validated, lower-cased. */
const email = z
  .string()
  .trim()
  .email("Enter a valid email address.")
  .transform((s) => s.toLowerCase());

const name = z.string().trim().min(1, "Name is required.").max(120, "Name is too long.");

export const createUserSchema = z.object({
  name,
  email,
  role: z.enum(["admin", "user"]),
});

export const updateUserSchema = z.object({
  userId: z.string().min(1),
  name,
  email,
});

export const roleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["admin", "user"]),
});

export const statusSchema = z.object({
  userId: z.string().min(1),
  status: z.enum(["active", "inactive"]),
});
