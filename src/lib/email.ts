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
  /** Accent colour (hex) for the hero band, badge and CTA button. */
  accent: string;
  /** Emoji shown large in the hero, e.g. "⚠️" / "✅". */
  icon: string;
  /** Short status word, e.g. "SITE DOWN" / "RESOLVED". */
  badge: string;
  /** Headline (plain text, escaped here). */
  title: string;
  /** Intro sentence (plain text, escaped here). Also used as inbox preview. */
  intro: string;
  /** Detail rows; `value` is treated as trusted HTML (caller escapes/links). */
  rows: { label: string; value: string }[];
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Small print under the details. */
  footerNote?: string;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Branded, email-client-safe HTML (tables + inline styles, 600px, dark text on
 * light). A coloured hero band carries the status; details sit in a soft card.
 * Used for the down, recovery and test emails.
 */
export function emailLayout(i: EmailLayoutInput): string {
  const rowsHtml = i.rows
    .map(
      (r, idx) => `
        <tr>
          <td style="padding:10px 16px;border-top:${idx === 0 ? "0" : "1px solid #eef2f7"};color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top;width:38%">${escapeHtml(r.label)}</td>
          <td style="padding:10px 16px;border-top:${idx === 0 ? "0" : "1px solid #eef2f7"};color:#0f172a;font-size:14px;font-weight:600;vertical-align:top">${r.value}</td>
        </tr>`,
    )
    .join("");

  const ctaHtml = i.cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px auto 4px">
        <tr><td style="border-radius:10px;background:${i.accent};box-shadow:0 2px 6px rgba(15,23,42,.18)">
          <a href="${escapeHtml(i.cta.url)}" target="_blank"
             style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">
            ${escapeHtml(i.cta.label)} &nbsp;&rarr;
          </a>
        </td></tr>
      </table>`
    : "";

  const footerNoteHtml = i.footerNote
    ? `<p style="margin:18px 0 0;color:#94a3b8;font-size:12px;line-height:1.6;text-align:center">${escapeHtml(i.footerNote)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <style>
    @media only screen and (max-width:620px){
      .ei-container{width:100%!important;border-radius:0!important}
      .ei-px{padding-left:18px!important;padding-right:18px!important}
      .ei-hero{padding-left:16px!important;padding-right:16px!important}
      .ei-title{font-size:20px!important}
      .ei-logo{height:44px!important}
      .ei-icon{font-size:38px!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#eef2f7;-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(i.intro)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f7">
    <tr><td align="center" style="padding:28px 14px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="ei-container" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.08)">
        <!-- brand header -->
        <tr><td class="ei-px" style="padding:26px 28px 24px;text-align:center;border-bottom:1px solid #eef2f7">
          <img src="${EMAIL_LOGO_URL}" alt="Atlas WebInsight" width="240" class="ei-logo" style="height:52px;width:auto;max-width:72%;display:inline-block;border:0;outline:none;text-decoration:none">
        </td></tr>
        <!-- status hero -->
        <tr><td class="ei-hero" style="background:${i.accent};padding:32px 24px;text-align:center">
          <div class="ei-icon" style="font-size:44px;line-height:1">${i.icon}</div>
          <div style="margin-top:12px;font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:.14em;color:#ffffff;opacity:.92">${escapeHtml(i.badge)}</div>
          <div class="ei-title" style="margin-top:6px;font-family:${FONT};font-size:24px;line-height:1.3;font-weight:bold;color:#ffffff">${escapeHtml(i.title)}</div>
        </td></tr>
        <!-- body -->
        <tr><td class="ei-px" style="padding:28px 28px 10px">
          <p style="margin:0 0 20px;font-family:${FONT};font-size:15px;line-height:1.6;color:#334155;text-align:center">${escapeHtml(i.intro)}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #eef2f7;border-radius:12px;font-family:${FONT}">
            ${rowsHtml}
          </table>
          ${ctaHtml}
          ${footerNoteHtml}
        </td></tr>
        <!-- footer -->
        <tr><td class="ei-px" style="padding:20px 28px 26px;border-top:1px solid #eef2f7;background:#ffffff;text-align:center">
          <p style="margin:0;font-family:${FONT};font-size:12px;color:#94a3b8;line-height:1.7">Atlas <strong style="color:#64748b">WebInsight</strong> &middot; automated uptime monitoring<br>This is an automated message — please do not reply.</p>
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
