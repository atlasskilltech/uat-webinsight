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
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
}

/** WebInsight horizontal logo, shown in the email header. */
export const EMAIL_LOGO_URL =
  "https://atlasuniversity.edu.in/brands/assets/logos/webinsight/webinsight-horizontal.png";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export interface EmailLayoutInput {
  /** Accent colour (hex) for the status bar, badge and CTA button. */
  accent: string;
  /** Short status word, e.g. "SITE DOWN" / "RECOVERED". */
  badge: string;
  /** Headline under the badge (plain text, escaped here). */
  title: string;
  /** Intro sentence (plain text, escaped here). */
  intro: string;
  /** Detail rows; `value` is treated as trusted HTML (caller escapes/links). */
  rows: { label: string; value: string }[];
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Small print under the button. */
  footerNote?: string;
}

/**
 * Branded, email-client-safe HTML (tables + inline styles, 600px, dark-text on
 * light so it renders well everywhere). Used for the down + recovery alerts.
 */
export function emailLayout(i: EmailLayoutInput): string {
  const rowsHtml = i.rows
    .map(
      (r) => `
        <tr>
          <td style="padding:6px 16px 6px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top">${escapeHtml(r.label)}</td>
          <td style="padding:6px 0;color:#0f172a;font-size:14px;vertical-align:top">${r.value}</td>
        </tr>`,
    )
    .join("");

  const ctaHtml = i.cta
    ? `
      <tr><td style="padding:24px 0 4px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="border-radius:8px;background:${i.accent}">
            <a href="${escapeHtml(i.cta.url)}" target="_blank"
               style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px">
              ${escapeHtml(i.cta.label)} &nbsp;&rarr;
            </a>
          </td></tr>
        </table>
      </td></tr>`
    : "";

  const footerNoteHtml = i.footerNote
    ? `<p style="margin:16px 0 0;color:#94a3b8;font-size:12px;line-height:1.5">${escapeHtml(i.footerNote)}</p>`
    : "";

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
        <!-- header -->
        <tr><td style="padding:20px 24px;border-bottom:1px solid #eef2f7">
          <img src="${EMAIL_LOGO_URL}" alt="WebInsight" height="32" style="height:32px;display:block;border:0;outline:none">
        </td></tr>
        <!-- status bar -->
        <tr><td style="height:4px;background:${i.accent};font-size:0;line-height:0">&nbsp;</td></tr>
        <!-- body -->
        <tr><td style="padding:24px">
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${i.accent};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:.04em">${escapeHtml(i.badge)}</span>
          <h1 style="margin:14px 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:1.3;color:#0f172a">${escapeHtml(i.title)}</h1>
          <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#334155">${escapeHtml(i.intro)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;font-family:Arial,Helvetica,sans-serif">
            ${rowsHtml}
            ${ctaHtml}
          </table>
          ${footerNoteHtml}
        </td></tr>
        <!-- footer -->
        <tr><td style="padding:16px 24px;border-top:1px solid #eef2f7;background:#f8fafc">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94a3b8">Atlas WebInsight · automated uptime monitoring</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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
  const cc = (input.cc ?? []).map((t) => t.trim()).filter(Boolean);

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
          personalizations: [
            {
              to: to.map((email) => ({ email })),
              ...(cc.length ? { cc: cc.map((email) => ({ email })) } : {}),
            },
          ],
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
        ...(cc.length ? { cc } : {}),
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
