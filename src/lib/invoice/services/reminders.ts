import "server-only";
import { iQuery, iExecute } from "../db";
import { createId } from "@/lib/id";
import { notifyOrg, orgMemberUserIds } from "./notifications";
import { fmtMoney, fmtDate } from "../format";
import { isEmailConfigured, sendEmail, emailLayout, escapeHtml } from "@/lib/email";

interface DueRow {
  id: string;
  direction: "incoming" | "outgoing";
  invoice_number: string | null;
  due_date: Date | string;
  balance_due: string;
  currency: string;
  party_name: string | null;
  days: number;
}

function kindFor(days: number): "overdue" | "t_minus_1" | "t_minus_3" | "t_minus_7" | null {
  if (days < 0) return "overdue";
  if (days <= 1) return "t_minus_1";
  if (days <= 3) return "t_minus_3";
  if (days <= 7) return "t_minus_7";
  return null;
}

function label(kind: string, direction: string): string {
  const who = direction === "incoming" ? "Payable" : "Receivable";
  if (kind === "overdue") return `${who} overdue`;
  return `${who} due soon`;
}

export interface ReminderSummary {
  scanned: number;
  inappSent: number;
  emailsSent: number;
}

/**
 * Generate and send due-date reminders (in-app + email), deduplicated per
 * invoice+kind+channel via the invoice_reminders unique key, so each reminder
 * goes out at most once. Email sending is a no-op when email is not configured.
 */
export async function generateAndSendReminders(organizationId: string): Promise<ReminderSummary> {
  const rows = await iQuery<DueRow>(
    "SELECT i.id, i.direction, i.invoice_number, i.due_date, i.balance_due, i.currency, p.business_name AS party_name, " +
      "DATEDIFF(i.due_date, CURDATE()) AS days FROM `invoices` i LEFT JOIN `invoice_parties` p ON p.id=i.party_id " +
      "WHERE i.organization_id=? AND i.deleted_at IS NULL AND i.balance_due > 0 " +
      "AND i.payment_status IN ('UNPAID','PARTIALLY_PAID','OVERDUE') AND i.due_date IS NOT NULL " +
      "AND DATEDIFF(i.due_date, CURDATE()) <= 7 LIMIT 1000",
    [organizationId],
  );

  const summary: ReminderSummary = { scanned: rows.length, inappSent: 0, emailsSent: 0 };
  const emailOn = isEmailConfigured();
  const recipients = emailOn ? (await orgMemberUserIds(organizationId)).map((m) => m.email).filter(Boolean) : [];

  for (const r of rows) {
    const kind = kindFor(r.days);
    if (!kind) continue;
    const channels: ("inapp" | "email")[] = emailOn ? ["inapp", "email"] : ["inapp"];

    for (const channel of channels) {
      // Dedupe: insert returns affectedRows=1 only when it is a new reminder.
      const res = await iExecute(
        "INSERT INTO `invoice_reminders` (`id`,`organization_id`,`invoice_id`,`direction`,`kind`,`scheduled_for`,`channel`,`status`) " +
          "VALUES (?,?,?,?,?,?,?,'scheduled') ON DUPLICATE KEY UPDATE `id`=`id`",
        [createId(), organizationId, r.id, r.direction, kind, r.due_date, channel],
      );
      if (res.affectedRows !== 1) continue; // already sent for this invoice+kind+channel

      const title = `${label(kind, r.direction)}: ${r.invoice_number ?? "invoice"}`;
      const body = `${r.party_name ?? "—"} · ${fmtMoney(r.balance_due, r.currency)} · due ${fmtDate(r.due_date)}`;

      if (channel === "inapp") {
        await notifyOrg(organizationId, { type: "reminder", title, body, link: `/invoices/${r.id}` });
        summary.inappSent += 1;
      } else if (recipients.length) {
        const html = emailLayout({
          accent: r.days < 0 ? "#dc2626" : "#d97706",
          accentDark: r.days < 0 ? "#991b1b" : "#b45309",
          pill: r.days < 0 ? "OVERDUE" : "DUE SOON",
          title,
          subtitle: body,
          introHtml: `This invoice ${r.days < 0 ? "is overdue" : "is due soon"}.`,
          rows: [
            { label: "Invoice", value: escapeHtml(r.invoice_number ?? "—") },
            { label: "Party", value: escapeHtml(r.party_name ?? "—") },
            { label: "Balance", value: escapeHtml(fmtMoney(r.balance_due, r.currency)) },
            { label: "Due date", value: escapeHtml(fmtDate(r.due_date)) },
          ],
        });
        const sent = await sendEmail({ to: recipients, subject: title, html });
        if (sent.ok) summary.emailsSent += 1;
      }
      await iExecute("UPDATE `invoice_reminders` SET `status`='sent', `sent_at`=NOW(3) WHERE invoice_id=? AND kind=? AND channel=?", [r.id, kind, channel]);
    }
  }
  return summary;
}
