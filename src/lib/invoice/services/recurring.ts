import "server-only";
import { iQuery, iExecute } from "../db";
import { createInvoice } from "./invoices";
import { notifyOrg } from "./notifications";
import type { LineItemInput } from "../validation";

interface SubscriptionRow {
  id: string;
  organization_id: string;
  party_id: string | null;
  name: string;
  currency: string;
  frequency: string;
  recurring_items: unknown;
  tax_config: unknown;
  next_run_date: string | Date;
  end_date: string | Date | null;
}

function advance(date: Date, frequency: string): Date {
  const d = new Date(date);
  if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  else if (frequency === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1); // monthly default
  return d;
}

function toLines(items: unknown): LineItemInput[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => {
      const o = it as Record<string, unknown>;
      return {
        description: String(o.description ?? "Item"),
        hsnSac: o.hsnSac ? String(o.hsnSac) : undefined,
        quantity: String(o.quantity ?? "1"),
        unit: o.unit ? String(o.unit) : undefined,
        unitPrice: String(o.unitPrice ?? "0"),
        discount: o.discount ? String(o.discount) : undefined,
        gstRate: String(o.gstRate ?? "0"),
      } as LineItemInput;
    })
    .filter((l) => /^\d/.test(l.unitPrice));
}

/**
 * Generate invoice DRAFTS from recurring subscriptions due today. Per the spec,
 * recurring schedules create drafts (not issued/sent documents); a human issues
 * them later. Advances next_run_date and completes a subscription past its end.
 */
export async function runRecurring(organizationId: string): Promise<{ created: number }> {
  const subs = await iQuery<SubscriptionRow>(
    "SELECT * FROM `invoice_subscriptions` WHERE organization_id=? AND status='active' AND next_run_date IS NOT NULL AND next_run_date <= CURDATE() LIMIT 200",
    [organizationId],
  );
  let created = 0;
  const actor = { id: "system", email: "recurring@invoice-agent" };

  for (const s of subs) {
    const lines = toLines(s.recurring_items);
    if (lines.length === 0) continue;
    const interState = (s.tax_config as { interState?: boolean } | null)?.interState ? "true" : "false";

    await createInvoice(organizationId, actor, {
      header: {
        direction: "outgoing",
        partyId: s.party_id ?? undefined,
        currency: (s.currency as "INR" | "USD" | "EUR" | "GBP") ?? "INR",
        interState: interState as "true" | "false",
        roundTotal: "false",
        notes: `Auto-generated from recurring: ${s.name}`,
      },
      lines,
    });
    created += 1;

    const next = advance(new Date(s.next_run_date), s.frequency);
    const end = s.end_date ? new Date(s.end_date) : null;
    if (end && next > end) {
      await iExecute("UPDATE `invoice_subscriptions` SET `status`='completed', `next_run_date`=NULL WHERE id=?", [s.id]);
    } else {
      await iExecute("UPDATE `invoice_subscriptions` SET `next_run_date`=? WHERE id=?", [next.toISOString().slice(0, 10), s.id]);
    }
  }

  if (created > 0) {
    await notifyOrg(organizationId, {
      type: "recurring",
      title: `${created} recurring invoice draft(s) generated`,
      body: "Review and issue them from Outgoing Invoices.",
      link: "/invoices/outgoing",
    });
  }
  return { created };
}
