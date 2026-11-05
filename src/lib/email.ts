import "server-only";

/**
 * Minimal transactional-email sender. Supports Resend and SendGrid via their
 * HTTP APIs (no extra dependency — uses fetch). Configured entirely by env so
 * no secrets live in the database:
 *
 *   EMAIL_PROVIDER   "resend" | "sendgrid"   (default: "resend")
 *   EMAIL_API_KEY    the provider API key
 *   EMAIL_FROM       a verified sender address, e.g. alerts@atlasuniversity.edu.in
 *   EMAIL_FROM_NAME  optional display name (default: "Atlas Web Insight")
 *
 * If it isn't configured, send() is a no-op that reports why, so the monitor
 * keeps running instead of crashing.
 */

export interface SendEmailInput {
  to: string[];
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailResult {
  ok: boolean;
  skipped?: boolean;
  message: string;
}

function provider(): "resend" | "sendgrid" {
  return (process.env.EMAIL_PROVIDER ?? "resend").trim().toLowerCase() === "sendgrid"
    ? "sendgrid"
    : "resend";
}

export function isEmailConfigured(): boolean {
  return Boolean((process.env.EMAIL_API_KEY ?? "").trim() && (process.env.EMAIL_FROM ?? "").trim());
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = (process.env.EMAIL_API_KEY ?? "").trim();
  const from = (process.env.EMAIL_FROM ?? "").trim();
  const fromName = (process.env.EMAIL_FROM_NAME ?? "Atlas Web Insight").trim();
  const to = input.to.map((t) => t.trim()).filter(Boolean);

  if (!apiKey || !from) {
    return { ok: false, skipped: true, message: "Email not configured (set EMAIL_API_KEY and EMAIL_FROM)." };
  }
  if (to.length === 0) {
    return { ok: false, skipped: true, message: "No recipients configured." };
  }

  try {
    if (provider() === "sendgrid") {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: to.map((email) => ({ email })) }],
          from: { email: from, name: fromName },
          subject: input.subject,
          content: [
            ...(input.text ? [{ type: "text/plain", value: input.text }] : []),
            { type: "text/html", value: input.html },
          ],
        }),
      });
      if (!res.ok) {
        return { ok: false, message: `SendGrid error ${res.status}: ${(await res.text()).slice(0, 300)}` };
      }
      return { ok: true, message: `Sent to ${to.length} recipient(s) via SendGrid.` };
    }

    // Resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromName ? `${fromName} <${from}>` : from,
        to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
      }),
    });
    if (!res.ok) {
      return { ok: false, message: `Resend error ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    return { ok: true, message: `Sent to ${to.length} recipient(s) via Resend.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Email send failed." };
  }
}

/** Parse a newline/comma-separated recipients string into a clean list. */
export function parseRecipients(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
}
