import "server-only";
import { iQuery, isMissingTableError } from "@/lib/invoice/db";
import { ApiError, type AgentUser, enumParam, likeParam, limitParam, todayUtc } from "./common";
import type { Action } from "./actions";

/**
 * READ-ONLY Agent API actions for the Atlas Invoice Agent (scope
 * `invoices.read`). These query the separate `atlas_invoice` database via
 * iQuery and reuse its models. Money is kept as DECIMAL strings (never parsed
 * through a JS float) with its currency.
 *
 * Multi-tenancy: invoice data belongs to organizations. A key with no acting
 * user (the admin connecting) sees every organization; a delegated key (acts as
 * the signed-in user) is limited to the organizations that user is an active
 * member of — matching the app's own finance access. Bank details, tokens and
 * other secrets are never exposed.
 */

const INCOMING = "incoming";
const OUTGOING = "outgoing";
const DIRECTIONS = [INCOMING, OUTGOING] as const;

/** Org ids this request may read: null = all (admin key); [] = none (403). */
async function allowedOrgIds(user: AgentUser | null): Promise<string[] | null> {
  if (!user) return null;
  const rows = await iQuery<{ organization_id: string }>(
    "SELECT `organization_id` FROM `organization_members` WHERE LOWER(`user_email`) = LOWER(?) AND `status` = 'active'",
    [user.email],
  );
  return rows.map((r) => r.organization_id);
}

/** Append an org-scope WHERE fragment. Returns the SQL and pushes params. */
function orgClause(orgIds: string[] | null, params: unknown[], alias = "i"): string {
  if (orgIds === null) return "";
  // Caller guarantees non-empty (empty is handled up front as 403).
  params.push(orgIds);
  return ` AND \`${alias}\`.\`organization_id\` IN (?)`;
}

/**
 * Resolve the org scope, turning "no finance access" into a clear 403 and a
 * missing/unreachable invoice database into a soft "unavailable" result rather
 * than a 500.
 */
async function withOrgScope<T>(
  user: AgentUser | null,
  run: (orgIds: string[] | null) => Promise<T>,
): Promise<T | { available: false; note: string }> {
  let orgIds: string[] | null;
  try {
    orgIds = await allowedOrgIds(user);
  } catch (e) {
    if (isMissingTableError(e)) return { available: false, note: "The Invoice Agent is not set up yet." };
    return { available: false, note: "Invoice Agent data is not available right now." };
  }
  if (orgIds !== null && orgIds.length === 0) {
    throw new ApiError(403, "You do not have finance access to any organization in the Invoice Agent.");
  }
  try {
    return await run(orgIds);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (isMissingTableError(e)) return { available: false, note: "The Invoice Agent is not set up yet." };
    return { available: false, note: "Invoice Agent data is not available right now." };
  }
}

const money = (v: unknown): string => (v == null ? "0.00" : String(v));

export const INVOICE_ACTIONS: Action[] = [
  {
    id: "invoice_overview",
    name: "Invoice overview",
    description:
      "Finance snapshot of EXTRACTED invoice RECORDS in the Invoice Agent: how many invoices there are by direction (incoming = bills from suppliers, outgoing = invoices to customers) and status, the total amount still outstanding, how many are overdue, and a per-organisation breakdown. Use for 'how much do we owe / what's overdue / invoices by amount'. For the dashboard counts of emails detected or forwarded, use invoice_forwarding instead.",
    method: "GET",
    path: "/invoices/overview",
    risk: "read",
    scope: "invoices.read",
    params: [],
    run: ({ user }) =>
      withOrgScope(user, async (orgIds) => {
        const today = todayUtc();
        const base = (extra: string, params: unknown[]) =>
          `FROM \`invoices\` \`i\` WHERE \`i\`.\`deleted_at\` IS NULL${orgClause(orgIds, params)}${extra}`;

        const byStatusParams: unknown[] = [];
        const byStatus = await iQuery<{ direction: string; processing_status: string; payment_status: string; c: number }>(
          `SELECT \`direction\`, \`processing_status\`, \`payment_status\`, COUNT(*) AS c ${base("", byStatusParams)} GROUP BY \`direction\`, \`processing_status\`, \`payment_status\``,
          byStatusParams,
        );
        const outstandingParams: unknown[] = [];
        const outstanding = await iQuery<{ direction: string; currency: string; total: string; n: number }>(
          `SELECT \`direction\`, \`currency\`, SUM(\`balance_due\`) AS total, COUNT(*) AS n ${base(
            " AND `i`.`balance_due` > 0 AND `i`.`payment_status` <> 'CANCELLED'",
            outstandingParams,
          )} GROUP BY \`direction\`, \`currency\``,
          outstandingParams,
        );
        const overdueParams: unknown[] = [today];
        const overdue = await iQuery<{ direction: string; n: number; total: string }>(
          `SELECT \`direction\`, COUNT(*) AS n, SUM(\`balance_due\`) AS total ${base(
            " AND `i`.`due_date` < ? AND `i`.`balance_due` > 0 AND `i`.`payment_status` NOT IN ('PAID','CANCELLED')",
            overdueParams,
          )} GROUP BY \`direction\``,
          overdueParams,
        );
        const orgParams: unknown[] = [];
        const byOrg = await iQuery<{ name: string; direction: string; c: number }>(
          `SELECT \`o\`.\`name\`, \`i\`.\`direction\`, COUNT(*) AS c FROM \`invoices\` \`i\` JOIN \`organizations\` \`o\` ON \`o\`.\`id\` = \`i\`.\`organization_id\` WHERE \`i\`.\`deleted_at\` IS NULL${orgClause(
            orgIds,
            orgParams,
          )} GROUP BY \`o\`.\`name\`, \`i\`.\`direction\``,
          orgParams,
        );

        const total = byStatus.reduce((s, r) => s + Number(r.c), 0);
        return {
          available: true,
          totalInvoices: total,
          byDirection: {
            incoming: byStatus.filter((r) => r.direction === INCOMING).reduce((s, r) => s + Number(r.c), 0),
            outgoing: byStatus.filter((r) => r.direction === OUTGOING).reduce((s, r) => s + Number(r.c), 0),
          },
          byProcessingStatus: byStatus.reduce<Record<string, number>>((m, r) => {
            m[r.processing_status] = (m[r.processing_status] ?? 0) + Number(r.c);
            return m;
          }, {}),
          outstanding: outstanding.map((r) => ({
            direction: r.direction,
            currency: r.currency,
            amount: money(r.total),
            invoices: Number(r.n),
          })),
          overdue: overdue.map((r) => ({ direction: r.direction, invoices: Number(r.n), amount: money(r.total) })),
          byOrganisation: byOrg.map((r) => ({ organisation: r.name, direction: r.direction, invoices: Number(r.c) })),
        };
      }),
  },
  {
    id: "invoice_forwarding",
    name: "Invoice forwarding status",
    description:
      "The figures shown on the Invoice Agent dashboard: how many invoice emails were DETECTED, how many were FORWARDED to the Finance destination, how many are PENDING APPROVAL and how many NEED REVIEW — with a per-organisation breakdown and the most recent forwards. Use this for 'how many invoices were forwarded / detected', 'what's pending approval', or any question about the counts on the Invoice Agent page. (For extracted invoice RECORDS with amounts and due dates, use invoice_overview or search_invoices instead.)",
    method: "GET",
    path: "/invoices/forwarding",
    risk: "read",
    scope: "invoices.read",
    params: [],
    run: ({ user }) =>
      withOrgScope(user, async (orgIds) => {
        // Detected = invoice-candidate emails (the "Invoice emails detected" tile).
        const detParams: unknown[] = [];
        const detected = await iQuery<{ name: string; c: number }>(
          `SELECT \`o\`.\`name\`, COUNT(*) AS c FROM \`email_messages\` \`m\` JOIN \`organizations\` \`o\` ON \`o\`.\`id\` = \`m\`.\`organization_id\` WHERE \`m\`.\`is_invoice_candidate\` = 1${orgClause(orgIds, detParams, "m")} GROUP BY \`o\`.\`name\``,
          detParams,
        );
        // Forwards grouped by status ("Invoices forwarded", "Pending approvals", "Needs review").
        const fwdParams: unknown[] = [];
        const forwards = await iQuery<{ name: string; status: string; c: number }>(
          `SELECT \`o\`.\`name\`, \`f\`.\`status\`, COUNT(*) AS c FROM \`invoice_forwards\` \`f\` JOIN \`organizations\` \`o\` ON \`o\`.\`id\` = \`f\`.\`organization_id\` WHERE 1=1${orgClause(orgIds, fwdParams, "f")} GROUP BY \`o\`.\`name\`, \`f\`.\`status\``,
          fwdParams,
        );
        const recParams: unknown[] = [];
        const recent = await iQuery<Record<string, unknown>>(
          `SELECT \`f\`.\`status\`, \`f\`.\`destination\`, \`f\`.\`confidence\`, \`m\`.\`subject\`, \`m\`.\`from_address\`, \`g\`.\`email\` AS account_email, \`o\`.\`name\` AS organisation FROM \`invoice_forwards\` \`f\` LEFT JOIN \`email_messages\` \`m\` ON \`m\`.\`id\` = \`f\`.\`email_message_id\` LEFT JOIN \`gmail_integrations\` \`g\` ON \`g\`.\`id\` = \`f\`.\`gmail_integration_id\` LEFT JOIN \`organizations\` \`o\` ON \`o\`.\`id\` = \`f\`.\`organization_id\` WHERE 1=1${orgClause(orgIds, recParams, "f")} ORDER BY \`f\`.\`created_at\` DESC LIMIT 10`,
          recParams,
        );

        const statusTotal = (s: string) => forwards.filter((r) => r.status === s).reduce((n, r) => n + Number(r.c), 0);
        const byStatus = forwards.reduce<Record<string, number>>((m, r) => {
          m[r.status] = (m[r.status] ?? 0) + Number(r.c);
          return m;
        }, {});

        // Per-organisation rollup so the answer can name the organisation.
        const orgMap = new Map<string, { organisation: string; detected: number; forwarded: number; pendingApprovals: number; needsReview: number }>();
        const ensure = (name: string) => {
          let e = orgMap.get(name);
          if (!e) { e = { organisation: name, detected: 0, forwarded: 0, pendingApprovals: 0, needsReview: 0 }; orgMap.set(name, e); }
          return e;
        };
        for (const r of detected) ensure(r.name).detected += Number(r.c);
        for (const r of forwards) {
          const e = ensure(r.name);
          if (r.status === "forwarded") e.forwarded += Number(r.c);
          else if (r.status === "pending") e.pendingApprovals += Number(r.c);
          else if (r.status === "review") e.needsReview += Number(r.c);
        }

        return {
          available: true,
          detected: detected.reduce((n, r) => n + Number(r.c), 0),
          forwarded: statusTotal("forwarded"),
          pendingApprovals: statusTotal("pending"),
          needsReview: statusTotal("review"),
          byStatus,
          byOrganisation: [...orgMap.values()],
          recentForwards: recent.map((r) => ({
            organisation: r.organisation,
            subject: r.subject,
            from: r.from_address,
            account: r.account_email,
            destination: r.destination,
            status: r.status,
            confidence: r.confidence == null ? null : Math.round(Number(r.confidence)),
          })),
        };
      }),
  },
  {
    id: "search_invoices",
    name: "Search invoices",
    description:
      "Invoices from the Invoice Agent, newest first. Filter by direction (incoming/outgoing), processing status, payment status, supplier/customer name, invoice number, or only overdue. Returns party, number, dates, amount, balance due and status.",
    method: "GET",
    path: "/invoices",
    risk: "read",
    scope: "invoices.read",
    params: [
      { name: "direction", in: "query", type: "string", enum: [...DIRECTIONS], description: "incoming (supplier bills) or outgoing (customer invoices)" },
      { name: "payment_status", in: "query", type: "string", enum: ["UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"] },
      { name: "processing_status", in: "query", type: "string", description: "e.g. RECEIVED, NEEDS_REVIEW, APPROVED, PAID" },
      { name: "party", in: "query", type: "string", description: "Part of the supplier/customer name" },
      { name: "number", in: "query", type: "string", description: "Part of the invoice number" },
      { name: "overdue", in: "query", type: "boolean", description: "true = only overdue, unpaid invoices" },
      { name: "limit", in: "query", type: "integer", description: "Max rows (default 50, max 200)" },
    ],
    run: ({ query: q, user }) =>
      withOrgScope(user, async (orgIds) => {
        const where: string[] = ["`i`.`deleted_at` IS NULL"];
        const params: unknown[] = [];
        const direction = enumParam(q.direction, "direction", DIRECTIONS);
        if (direction) { where.push("`i`.`direction` = ?"); params.push(direction); }
        const pay = enumParam(q.payment_status, "payment_status", ["UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"]);
        if (pay) { where.push("`i`.`payment_status` = ?"); params.push(pay); }
        if (q.processing_status) { where.push("`i`.`processing_status` = ?"); params.push(String(q.processing_status).trim().slice(0, 32)); }
        const party = likeParam(q.party);
        if (party) { where.push("(`i`.`party_name_raw` LIKE ? OR `p`.`business_name` LIKE ?)"); params.push(party, party); }
        const number = likeParam(q.number);
        if (number) { where.push("`i`.`invoice_number` LIKE ?"); params.push(number); }
        if (String(q.overdue || "").toLowerCase() === "true") {
          where.push("`i`.`due_date` < ? AND `i`.`balance_due` > 0 AND `i`.`payment_status` NOT IN ('PAID','CANCELLED')");
          params.push(todayUtc());
        }
        const orgSql = orgClause(orgIds, params);
        const limit = limitParam(q.limit);
        const rows = await iQuery<Record<string, unknown>>(
          "SELECT `i`.`id`, `i`.`direction`, `i`.`invoice_number`, `i`.`invoice_date`, `i`.`due_date`, " +
            "COALESCE(`p`.`business_name`, `i`.`party_name_raw`) AS party, `i`.`currency`, `i`.`grand_total`, `i`.`balance_due`, " +
            "`i`.`processing_status`, `i`.`payment_status`, `o`.`name` AS organisation, `i`.`updated_at` " +
            "FROM `invoices` `i` JOIN `organizations` `o` ON `o`.`id` = `i`.`organization_id` " +
            "LEFT JOIN `invoice_parties` `p` ON `p`.`id` = `i`.`party_id` " +
            `WHERE ${where.join(" AND ")}${orgSql} ORDER BY \`i\`.\`updated_at\` DESC LIMIT ?`,
          [...params, limit],
        );
        return {
          available: true,
          total: rows.length,
          invoices: rows.map((r) => ({
            id: r.id,
            direction: r.direction,
            number: r.invoice_number,
            party: r.party,
            organisation: r.organisation,
            invoiceDate: r.invoice_date,
            dueDate: r.due_date,
            currency: r.currency,
            grandTotal: money(r.grand_total),
            balanceDue: money(r.balance_due),
            processingStatus: r.processing_status,
            paymentStatus: r.payment_status,
          })),
        };
      }),
  },
  {
    id: "get_invoice",
    name: "Get an invoice",
    description: "One invoice from the Invoice Agent with its line items (description, quantity, amount) and totals. Bank details are not included.",
    method: "GET",
    path: "/invoices/{id}",
    risk: "read",
    scope: "invoices.read",
    params: [{ name: "id", in: "path", type: "string", required: true, description: "Invoice id (from search_invoices)" }],
    run: ({ path, user }) =>
      withOrgScope(user, async (orgIds) => {
        const params: unknown[] = [path.id];
        const inv = await iQuery<Record<string, unknown>>(
          "SELECT `i`.`id`, `i`.`direction`, `i`.`invoice_number`, `i`.`po_number`, `i`.`invoice_date`, `i`.`due_date`, " +
            "COALESCE(`p`.`business_name`, `i`.`party_name_raw`) AS party, `i`.`currency`, `i`.`subtotal`, `i`.`tax_total`, " +
            "`i`.`grand_total`, `i`.`amount_paid`, `i`.`balance_due`, `i`.`processing_status`, `i`.`payment_status`, " +
            "`i`.`source`, `i`.`notes`, `o`.`name` AS organisation, `i`.`created_at`, `i`.`updated_at` " +
            "FROM `invoices` `i` JOIN `organizations` `o` ON `o`.`id` = `i`.`organization_id` " +
            "LEFT JOIN `invoice_parties` `p` ON `p`.`id` = `i`.`party_id` " +
            `WHERE \`i\`.\`id\` = ? AND \`i\`.\`deleted_at\` IS NULL${orgClause(orgIds, params)} LIMIT 1`,
          params,
        );
        if (!inv[0]) throw new ApiError(404, "Invoice not found");
        const r = inv[0];
        const lines = await iQuery<Record<string, unknown>>(
          "SELECT `line_no`, `description`, `hsn_sac`, `quantity`, `unit_price`, `line_total` FROM `invoice_line_items` " +
            "WHERE `invoice_id` = ? ORDER BY `line_no` ASC",
          [path.id],
        );
        return {
          available: true,
          id: r.id,
          direction: r.direction,
          number: r.invoice_number,
          poNumber: r.po_number,
          party: r.party,
          organisation: r.organisation,
          invoiceDate: r.invoice_date,
          dueDate: r.due_date,
          currency: r.currency,
          subtotal: money(r.subtotal),
          taxTotal: money(r.tax_total),
          grandTotal: money(r.grand_total),
          amountPaid: money(r.amount_paid),
          balanceDue: money(r.balance_due),
          processingStatus: r.processing_status,
          paymentStatus: r.payment_status,
          source: r.source,
          notes: r.notes,
          lineItems: lines.map((l) => ({
            description: l.description,
            hsnSac: l.hsn_sac,
            quantity: l.quantity == null ? null : String(l.quantity),
            unitPrice: money(l.unit_price),
            lineTotal: money(l.line_total),
          })),
        };
      }),
  },
  {
    id: "invoice_agent_activity",
    name: "Invoice Agent activity",
    description: "What the Invoice Agent has recently done: its agent runs (instruction, status, start/finish) and recent activity-log events. Use for 'what has the invoice agent done'.",
    method: "GET",
    path: "/invoices/agent-activity",
    risk: "read",
    scope: "invoices.read",
    params: [{ name: "limit", in: "query", type: "integer", description: "Max rows per list (default 20, max 200)" }],
    run: ({ query: q, user }) =>
      withOrgScope(user, async (orgIds) => {
        const limit = limitParam(q.limit, 20);
        const rp: unknown[] = [];
        const runs = await iQuery<Record<string, unknown>>(
          `SELECT \`r\`.\`id\`, \`r\`.\`status\`, \`r\`.\`instruction\`, \`r\`.\`started_at\`, \`r\`.\`finished_at\`, \`o\`.\`name\` AS organisation ` +
            `FROM \`agent_runs\` \`r\` JOIN \`organizations\` \`o\` ON \`o\`.\`id\` = \`r\`.\`organization_id\` ` +
            `WHERE 1=1${orgClause(orgIds, rp, "r")} ORDER BY \`r\`.\`started_at\` DESC LIMIT ?`,
          [...rp, limit],
        );
        const ap: unknown[] = [];
        const activity = await iQuery<Record<string, unknown>>(
          `SELECT \`a\`.\`event\`, \`a\`.\`summary\`, \`a\`.\`created_at\`, \`o\`.\`name\` AS organisation ` +
            `FROM \`agent_activity_logs\` \`a\` JOIN \`organizations\` \`o\` ON \`o\`.\`id\` = \`a\`.\`organization_id\` ` +
            `WHERE 1=1${orgClause(orgIds, ap, "a")} ORDER BY \`a\`.\`created_at\` DESC LIMIT ?`,
          [...ap, limit],
        );
        return {
          available: true,
          runs: runs.map((r) => ({
            id: r.id, organisation: r.organisation, status: r.status,
            instruction: r.instruction, startedAt: r.started_at, finishedAt: r.finished_at,
          })),
          activity: activity.map((a) => ({ event: a.event, summary: a.summary, organisation: a.organisation, at: a.created_at })),
        };
      }),
  },
  {
    id: "invoice_email_accounts",
    name: "Connected invoice inboxes",
    description: "The Gmail inboxes the Invoice Agent monitors for invoices, with their connection status and last error. No tokens or secrets.",
    method: "GET",
    path: "/invoices/email-accounts",
    risk: "read",
    scope: "invoices.read",
    params: [],
    run: ({ user }) =>
      withOrgScope(user, async (orgIds) => {
        const p: unknown[] = [];
        const rows = await iQuery<Record<string, unknown>>(
          `SELECT \`g\`.\`email\`, \`g\`.\`status\`, \`g\`.\`last_error\`, \`g\`.\`token_expires_at\`, \`g\`.\`updated_at\`, \`o\`.\`name\` AS organisation ` +
            `FROM \`gmail_integrations\` \`g\` JOIN \`organizations\` \`o\` ON \`o\`.\`id\` = \`g\`.\`organization_id\` ` +
            `WHERE 1=1${orgClause(orgIds, p, "g")} ORDER BY \`g\`.\`updated_at\` DESC`,
          p,
        );
        return {
          available: true,
          total: rows.length,
          accounts: rows.map((r) => ({
            email: r.email, organisation: r.organisation, status: r.status,
            connected: r.status === "connected", lastError: r.last_error, updatedAt: r.updated_at,
          })),
        };
      }),
  },
];
