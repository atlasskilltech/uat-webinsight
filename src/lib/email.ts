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

/** WebInsight horizontal logo (dark, for light backgrounds). */
export const EMAIL_LOGO_URL =
  "https://atlasuniversity.edu.in/brands/assets/logos/webinsight/webinsight-horizontal.png";

/** White/reversed WebInsight logo, used on the coloured hero header. */
export const EMAIL_LOGO_URL_WHITE =
  "https://atlasuniversity.edu.in/brands/assets/logos/webinsight/webinsight-horizontal-white.png";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export interface EmailLayoutInput {
  /** Strong status colour (hex) for the hero gradient start, pill and CTA. */
  accent: string;
  /** Darker shade (hex) for the hero gradient end. */
  accentDark: string;
  /** Status pill text in the hero, e.g. "SITE DOWN" / "RESOLVED". */
  pill: string;
  /** Big hero headline (plain text, escaped here). */
  title: string;
  /** Hero subtitle under the headline (plain text, escaped here). */
  subtitle: string;
  /** Body intro line — trusted HTML (caller escapes; may include <strong>). */
  introHtml: string;
  /** Detail rows; `value` is trusted HTML (caller escapes/links/colours). */
  rows: { label: string; value: string }[];
  /** Optional CTA button + paste-this-link fallback. */
  cta?: { label: string; url: string };
  /** Small print under the details. */
  footerNote?: string;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Branded, email-client-safe HTML (tables + inline styles, fluid 600px). A
 * coloured gradient hero carries a white logo chip, a status pill and the
 * headline; the body holds a detail card, a CTA button and a paste-this-link
 * fallback. Mirrors the Atlas transactional-email look. Mobile-responsive.
 */
export function emailLayout(i: EmailLayoutInput): string {
  const preview = i.title;
  const rowsHtml = i.rows
    .map(
      (r, idx) => `
        <tr>
          <td style="padding:11px 18px;border-top:${idx === 0 ? "0" : "1px solid #edf1f6"};color:#6b7280;font-size:13px;vertical-align:top;width:46%">${escapeHtml(r.label)}</td>
          <td style="padding:11px 18px;border-top:${idx === 0 ? "0" : "1px solid #edf1f6"};color:#111827;font-size:14px;font-weight:700;text-align:right;vertical-align:top">${r.value}</td>
        </tr>`,
    )
    .join("");

  const ctaHtml = i.cta
    ? `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 2px">
            <tr><td style="border-radius:10px;background:${i.accent}">
              <a href="${escapeHtml(i.cta.url)}" target="_blank"
                 style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">
                ${escapeHtml(i.cta.label)}
              </a>
            </td></tr>
          </table>
          <p style="margin:16px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;color:#9aa4b2">If the button doesn't work, paste this link into your browser:</p>
          <p style="margin:3px 0 0;font-family:${FONT};font-size:12px;line-height:1.5"><a href="${escapeHtml(i.cta.url)}" style="color:#2563eb;word-break:break-all">${escapeHtml(i.cta.url)}</a></p>`
    : "";

  const footerNoteHtml = i.footerNote
    ? `<p style="margin:14px 0 0;color:#9aa4b2;font-size:12px;line-height:1.6">${escapeHtml(i.footerNote)}</p>`
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
      .ei-px{padding-left:20px!important;padding-right:20px!important}
      .ei-hero{padding:24px 20px!important}
      .ei-title{font-size:22px!important}
      .ei-logo{height:36px!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#eef2f7;-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f7">
    <tr><td align="center" style="padding:26px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="ei-container" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(15,23,42,.10)">
        <!-- gradient hero -->
        <tr><td class="ei-hero" style="padding:28px 30px 30px;background-color:${i.accent};background-image:linear-gradient(135deg,${i.accent} 0%,${i.accentDark} 100%)">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="vertical-align:middle">
                <img src="${EMAIL_LOGO_URL_WHITE}" alt="Atlas WebInsight" height="42" class="ei-logo" style="height:42px;width:auto;max-width:70%;display:block;border:0;outline:none">
              </td>
              <td style="vertical-align:middle;text-align:right">
                <span style="font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:.12em;color:#ffffff;opacity:.8">UPTIME MONITOR</span>
              </td>
            </tr>
          </table>
          <div style="margin-top:22px">
            <span style="display:inline-block;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,.18);font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:.08em;color:#ffffff">${escapeHtml(i.pill)}</span>
          </div>
          <div class="ei-title" style="margin-top:14px;font-family:${FONT};font-size:27px;line-height:1.25;font-weight:800;color:#ffffff">${escapeHtml(i.title)}</div>
          <div style="margin-top:6px;font-family:${FONT};font-size:14px;line-height:1.5;color:#ffffff;opacity:.9">${escapeHtml(i.subtitle)}</div>
        </td></tr>
        <!-- body -->
        <tr><td class="ei-px" style="padding:28px 30px 10px">
          <p style="margin:0 0 20px;font-family:${FONT};font-size:15px;line-height:1.6;color:#374151">${i.introHtml}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #edf1f6;border-radius:12px;font-family:${FONT}">
            ${rowsHtml}
          </table>
          ${ctaHtml}
          ${footerNoteHtml}
        </td></tr>
        <!-- footer -->
        <tr><td class="ei-px" style="padding:20px 30px 26px;border-top:1px solid #edf1f6;background:#ffffff">
          <p style="margin:0;font-family:${FONT};font-size:12px;color:#9aa4b2;line-height:1.7">Atlas <strong style="color:#6b7280">WebInsight</strong> &middot; automated uptime monitoring<br>This is an automated message — please do not reply.</p>
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
