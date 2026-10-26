import { handlers } from "@/auth";

// Auth.js route handlers (dashboard Google Sign-In). Node runtime so the
// callbacks can use Prisma.
export const runtime = "nodejs";
export const { GET, POST } = handlers;
