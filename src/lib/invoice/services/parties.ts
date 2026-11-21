import "server-only";
import { iQuery, iQueryOne, iExecute, ijson } from "../db";
import { logInvoiceAudit } from "../audit";
import { createId } from "@/lib/id";
import type { PartyInput } from "../validation";

export interface PartyRow {
  id: string;
  organization_id: string;
  kind: string;
  business_name: string;
  legal_name: string | null;
  gstin: string | null;
  pan: string | null;
  email: string | null;
  phone: string | null;
  contact_person: string | null;
  billing_address: unknown;
  payment_terms: string | null;
  default_currency: string;
  notes: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PartyListRow extends PartyRow {
  payable: string;
  receivable: string;
  invoice_count: number;
}

export async function listParties(
  organizationId: string,
  opts: { kind?: string; q?: string; activeOnly?: boolean } = {},
): Promise<PartyListRow[]> {
  const where: string[] = ["p.organization_id = ?", "p.deleted_at IS NULL"];
  const params: unknown[] = [organizationId];
  if (opts.kind && opts.kind !== "all") {
    where.push("(p.kind = ? OR p.kind = 'both')");
    params.push(opts.kind);
  }
  if (opts.activeOnly) where.push("p.is_active = 1");
  if (opts.q) {
    where.push("(p.business_name LIKE ? OR p.gstin LIKE ? OR p.email LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  return iQuery<PartyListRow>(
    "SELECT p.*, " +
      "(SELECT COALESCE(SUM(balance_due),0) FROM `invoices` i WHERE i.party_id=p.id AND i.direction='incoming' AND i.payment_status<>'CANCELLED' AND i.deleted_at IS NULL) AS payable, " +
      "(SELECT COALESCE(SUM(balance_due),0) FROM `invoices` i WHERE i.party_id=p.id AND i.direction='outgoing' AND i.payment_status<>'CANCELLED' AND i.deleted_at IS NULL) AS receivable, " +
      "(SELECT COUNT(*) FROM `invoices` i WHERE i.party_id=p.id AND i.deleted_at IS NULL) AS invoice_count " +
      `FROM \`invoice_parties\` p WHERE ${where.join(" AND ")} ORDER BY p.business_name ASC LIMIT 500`,
    params,
  );
}

export async function getParty(organizationId: string, id: string): Promise<PartyRow | null> {
  return iQueryOne<PartyRow>(
    "SELECT * FROM `invoice_parties` WHERE organization_id=? AND id=? AND deleted_at IS NULL",
    [organizationId, id],
  );
}

function addressJson(text?: string): string | null {
  return text ? ijson({ text }) : null;
}

export async function createParty(
  organizationId: string,
  actor: { id: string; email: string },
  input: PartyInput,
): Promise<string> {
  const id = createId();
  await iExecute(
    "INSERT INTO `invoice_parties` " +
      "(`id`,`organization_id`,`kind`,`business_name`,`legal_name`,`gstin`,`pan`,`email`,`phone`," +
      "`contact_person`,`billing_address`,`payment_terms`,`notes`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      organizationId,
      input.kind,
      input.businessName,
      input.legalName ?? null,
      input.gstin ?? null,
      input.pan ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.contactPerson ?? null,
      addressJson(input.billingAddress),
      input.paymentTerms ?? null,
      input.notes ?? null,
    ],
  );
  await logInvoiceAudit({
    organizationId,
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "party.created",
    entityType: "party",
    entityId: id,
    after: { kind: input.kind, businessName: input.businessName, gstin: input.gstin },
  });
  return id;
}

export async function updateParty(
  organizationId: string,
  id: string,
  actor: { id: string; email: string },
  input: PartyInput,
): Promise<void> {
  const before = await getParty(organizationId, id);
  if (!before) throw new Error("Party not found.");
  await iExecute(
    "UPDATE `invoice_parties` SET `kind`=?,`business_name`=?,`legal_name`=?,`gstin`=?,`pan`=?," +
      "`email`=?,`phone`=?,`contact_person`=?,`billing_address`=?,`payment_terms`=?,`notes`=? " +
      "WHERE organization_id=? AND id=?",
    [
      input.kind,
      input.businessName,
      input.legalName ?? null,
      input.gstin ?? null,
      input.pan ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.contactPerson ?? null,
      addressJson(input.billingAddress),
      input.paymentTerms ?? null,
      input.notes ?? null,
      organizationId,
      id,
    ],
  );
  await logInvoiceAudit({
    organizationId,
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "party.updated",
    entityType: "party",
    entityId: id,
    before: { businessName: before.business_name, gstin: before.gstin },
    after: { businessName: input.businessName, gstin: input.gstin },
  });
}

export async function setPartyActive(
  organizationId: string,
  id: string,
  active: boolean,
  actor: { id: string; email: string },
): Promise<void> {
  await iExecute(
    "UPDATE `invoice_parties` SET `is_active`=? WHERE organization_id=? AND id=?",
    [active, organizationId, id],
  );
  await logInvoiceAudit({
    organizationId,
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: active ? "party.activated" : "party.deactivated",
    entityType: "party",
    entityId: id,
  });
}
