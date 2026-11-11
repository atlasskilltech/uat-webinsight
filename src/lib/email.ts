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

/** WebInsight horizontal logo (dark), shown on the white header strip. */
export const EMAIL_LOGO_URL =
  "https://atlasuniversity.edu.in/brands/assets/logos/webinsight/webinsight-horizontal.png";

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
/** Responsive <style> block shared by every WebInsight email. */
const EMAIL_RESPONSIVE_STYLE = `<style>
    @media only screen and (max-width:620px){
      .ei-container{width:100%!important;border-radius:0!important}
      .ei-px{padding-left:20px!important;padding-right:20px!important}
      .ei-herowrap{padding:16px 16px 2px!important}
      .ei-hero{padding:22px 20px!important}
      .ei-title{font-size:22px!important}
      .ei-head{padding:16px 20px!important}
      .ei-logo{height:30px!important}
      .ei-uptime{font-size:10px!important;letter-spacing:.12em!important}
    }
  </style>`;

/** Brand header row (green strip: logo left, "UPTIME MONITOR" right). */
function emailHeaderRow(): string {
  return `<tr><td class="ei-px ei-head" style="padding:20px 28px;background:#309e83">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="left" valign="middle" style="vertical-align:middle">
                <img src="${EMAIL_LOGO_URL}" alt="Atlas WebInsight" height="34" class="ei-logo" style="height:34px;width:auto;display:block;border:0;outline:none;background:transparent">
              </td>
              <td align="right" valign="middle" class="ei-uptime" style="vertical-align:middle;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:.18em;color:#d7f0e8;white-space:nowrap">UPTIME MONITOR</td>
            </tr>
          </table>
        </td></tr>`;
}

/** Inset rounded hero card (gradient from accent → accentDark, with a solid
 *  pill, headline and subtitle). Shared by the incident and report emails. */
function emailHeroRow(accent: string, accentDark: string, pill: string, title: string, subtitle: string): string {
  return `<tr><td class="ei-herowrap" style="padding:22px 24px 2px;background:#ffffff">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:16px;overflow:hidden">
            <tr><td class="ei-hero" style="padding:26px 26px 28px;border-radius:16px;background-color:${accent};background-image:linear-gradient(135deg,${accent} 0%,${accentDark} 100%)">
              <span style="display:inline-block;padding:6px 14px;border-radius:999px;background:#ffffff;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:.08em;color:${accent}"><span style="color:${accent}">&bull;</span>&nbsp;${escapeHtml(pill)}</span>
              <div class="ei-title" style="margin-top:14px;font-family:${FONT};font-size:27px;line-height:1.25;font-weight:800;color:#ffffff">${escapeHtml(title)}</div>
              <div style="margin-top:6px;font-family:${FONT};font-size:14px;line-height:1.5;color:#ffffff;opacity:.9">${escapeHtml(subtitle)}</div>
            </td></tr>
          </table>
        </td></tr>`;
}

/** Brand footer row. */
function emailFooterRow(): string {
  return `<tr><td class="ei-px" style="padding:20px 30px 26px;border-top:1px solid #edf1f6;background:#ffffff">
          <p style="margin:0;font-family:${FONT};font-size:12px;color:#9aa4b2;line-height:1.7">Atlas <strong style="color:#6b7280">WebInsight</strong> &middot; automated uptime monitoring<br>This is an automated message — please do not reply.</p>
        </td></tr>`;
}

/** Wrap header + the caller's rows (hero, body, …) + footer in the full,
 *  email-client-safe document skeleton (preview text, 600px rounded card). */
function emailDocument(preview: string, innerRows: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  ${EMAIL_RESPONSIVE_STYLE}
</head>
<body style="margin:0;padding:0;background:#eef2f7;-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f7">
    <tr><td align="center" style="padding:26px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="ei-container" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(15,23,42,.10)">
        ${emailHeaderRow()}
        ${innerRows}
        ${emailFooterRow()}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

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

  const body = `<tr><td class="ei-px" style="padding:20px 30px 10px">
          <p style="margin:0 0 20px;font-family:${FONT};font-size:15px;line-height:1.6;color:#374151">${i.introHtml}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #edf1f6;border-radius:12px;font-family:${FONT}">
            ${rowsHtml}
          </table>
          ${ctaHtml}
          ${footerNoteHtml}
        </td></tr>`;

  return emailDocument(preview, emailHeroRow(i.accent, i.accentDark, i.pill, i.title, i.subtitle) + body);
}

/** One site's current status, for the daily report table. */
export interface ReportSite {
  name: string;
  url: string | null;
  environment: string | null; // "Production" | "UAT" | …
  state: "up" | "degraded" | "down" | "unknown";
  detail: string; // e.g. "HTTP 200 · 180 ms" or "No response"
}

export interface DailyReportInput {
  dateLabel: string; // e.g. "Tue, 11 Nov 2026"
  up: number;
  down: number;
  degraded: number;
  unknown: number;
  total: number;
  sites: ReportSite[];
  cta?: { label: string; url: string };
}

const STATUS_STYLE: Record<ReportSite["state"], { label: string; color: string; bg: string }> = {
  up: { label: "UP", color: "#15803d", bg: "#e8f6ee" },
  degraded: { label: "DEGRADED", color: "#b45309", bg: "#fdf0db" },
  down: { label: "DOWN", color: "#b91c1c", bg: "#fde8e8" },
  unknown: { label: "UNKNOWN", color: "#6b7280", bg: "#eef1f5" },
};

/** Branded daily "site status" digest: a summary hero, count chips and a
 *  per-site table (down first). Shares the header/hero/footer of the alert
 *  emails, so it reads as the same system. */
export function dailyReportLayout(i: DailyReportInput): string {
  // Hero colour follows the worst current state.
  const accent = i.down > 0 ? "#dc2626" : i.degraded > 0 ? "#d97706" : "#16a34a";
  const accentDark = i.down > 0 ? "#991b1b" : i.degraded > 0 ? "#b45309" : "#15803d";
  const subtitle =
    i.down > 0
      ? `${i.down} of ${i.total} site${i.total === 1 ? "" : "s"} down`
      : i.degraded > 0
        ? `All reachable — ${i.degraded} degraded`
        : `All ${i.total} site${i.total === 1 ? "" : "s"} up`;

  const chip = (count: number, s: ReportSite["state"]) => {
    const st = STATUS_STYLE[s];
    return `<td style="padding:0 6px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:7px 12px;border-radius:999px;background:${st.bg};font-family:${FONT};font-size:12px;font-weight:700;color:${st.color};white-space:nowrap"><span style="color:${st.color}">&bull;</span>&nbsp;${count} ${st.label === "UP" ? "Up" : st.label === "DOWN" ? "Down" : st.label === "DEGRADED" ? "Degraded" : "Unknown"}</td></tr></table></td>`;
  };
  const chipsRow = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr>${chip(i.up, "up")}${chip(i.down, "down")}${i.degraded > 0 ? chip(i.degraded, "degraded") : ""}${i.unknown > 0 ? chip(i.unknown, "unknown") : ""}</tr></table>`;

  const rowsHtml = i.sites.length
    ? i.sites
        .map((s, idx) => {
          const st = STATUS_STYLE[s.state];
          const urlHtml = s.url
            ? `<div style="margin-top:2px;font-size:12px;color:#9aa4b2;word-break:break-all">${escapeHtml(s.url)}</div>`
            : "";
          return `
        <tr>
          <td style="padding:12px 16px;border-top:${idx === 0 ? "0" : "1px solid #edf1f6"};vertical-align:top">
            <div style="font-size:14px;font-weight:700;color:#111827">${escapeHtml(s.name)}</div>
            ${urlHtml}
            <div style="margin-top:4px;font-size:12px;color:#6b7280">${escapeHtml(s.detail)}${s.environment ? ` &middot; ${escapeHtml(s.environment)}` : ""}</div>
          </td>
          <td style="padding:12px 16px;border-top:${idx === 0 ? "0" : "1px solid #edf1f6"};text-align:right;vertical-align:top;white-space:nowrap">
            <span style="display:inline-block;padding:5px 11px;border-radius:999px;background:${st.bg};font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.04em;color:${st.color}">${st.label}</span>
          </td>
        </tr>`;
        })
        .join("")
    : `<tr><td style="padding:16px;font-family:${FONT};font-size:14px;color:#6b7280">No monitored sites yet. Add domains in the Server Inventory to see them here.</td></tr>`;

  const ctaHtml = i.cta
    ? `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 2px">
            <tr><td style="border-radius:10px;background:${accent}">
              <a href="${escapeHtml(i.cta.url)}" target="_blank"
                 style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">
                ${escapeHtml(i.cta.label)}
              </a>
            </td></tr>
          </table>`
    : "";

  const body = `<tr><td class="ei-px" style="padding:20px 30px 10px">
          <p style="margin:0 0 18px;font-family:${FONT};font-size:15px;line-height:1.6;color:#374151">Here is today's uptime summary for all monitored production sites, as of <strong>${escapeHtml(i.dateLabel)}</strong>.</p>
          ${chipsRow}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #edf1f6;border-radius:12px;font-family:${FONT}">
            ${rowsHtml}
          </table>
          ${ctaHtml}
        </td></tr>`;

  return emailDocument(`Daily uptime report — ${subtitle}`, emailHeroRow(accent, accentDark, "DAILY REPORT", "Daily uptime report", `${subtitle} · ${i.dateLabel}`) + body);
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
