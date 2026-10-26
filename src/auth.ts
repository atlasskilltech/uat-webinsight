import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/auth/audit";
import { BOOTSTRAP_ADMIN_EMAIL } from "@/lib/auth/constants";

/**
 * Auth.js (NextAuth v5) configuration for DASHBOARD login via Google Sign-In.
 *
 * This is entirely separate from the GSC/GA4 data OAuth (src/lib/google.ts,
 * /api/integrations/google/*) and from the CRON_SECRET endpoint. Google proves
 * identity; our own `User` table decides the role and whether access is allowed.
 *
 * Session strategy is JWT (no DB adapter needed). The `jwt` callback re-reads
 * the user's role/status from the database on every request, so deactivation
 * and role changes take effect immediately on the user's next request.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Google({
      // Prefer a dedicated login OAuth client (AUTH_GOOGLE_*) if provided, so
      // dashboard login can use a different client than the GSC/GA4 data OAuth.
      // Falls back to the shared GOOGLE_CLIENT_ID/SECRET when not set.
      clientId: process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  callbacks: {
    // Approval gate + one-time bootstrap. Uses Google's VERIFIED email only.
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified === true;
      if (!email || !verified) return false;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        if (existing.status !== "active") return false; // deactivated → denied
        await prisma.user.update({ where: { id: existing.id }, data: { lastLoginAt: new Date() } });
        await logAudit({ actorId: existing.id, actorEmail: email, action: "login.success", targetUserId: existing.id, targetEmail: email });
        return true;
      }

      // One-time bootstrap: only the designated email, only while no admin exists.
      if (email === BOOTSTRAP_ADMIN_EMAIL) {
        const adminExists = await prisma.user.findFirst({ where: { role: "admin", status: "active" } });
        if (!adminExists) {
          const created = await prisma.user.create({
            data: { email, name: profile?.name ?? "Administrator", role: "admin", status: "active", lastLoginAt: new Date() },
          });
          await logAudit({ actorId: created.id, actorEmail: email, action: "user.created", targetUserId: created.id, targetEmail: email, metadata: { via: "google-bootstrap", role: "admin" } });
          await logAudit({ actorId: created.id, actorEmail: email, action: "login.success", targetUserId: created.id, targetEmail: email });
          return true;
        }
      }

      // Unknown / unapproved account.
      await logAudit({ action: "login.failed", targetEmail: email, metadata: { reason: "not_approved" } });
      return false;
    },

    // Refresh role/status from the DB each request (instant deactivation).
    async jwt({ token }) {
      const email = token.email?.toLowerCase();
      if (email) {
        const dbUser = await prisma.user.findUnique({ where: { email } });
        if (dbUser) {
          token.userId = dbUser.id;
          token.role = dbUser.role;
          token.status = dbUser.status;
          token.name = dbUser.name;
        } else {
          token.status = "inactive";
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.userId as string) ?? "";
        session.user.role = (token.role as string) ?? "user";
        session.user.status = (token.status as string) ?? "inactive";
      }
      return session;
    },
  },
});
