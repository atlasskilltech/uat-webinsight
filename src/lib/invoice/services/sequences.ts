import "server-only";
import type { PoolConnection } from "mysql2/promise";
import { createId } from "@/lib/id";

/**
 * Allocate the next invoice number for an org/direction/series/financial-year,
 * atomically, INSIDE an existing transaction. The sequence row is locked with
 * SELECT ... FOR UPDATE so concurrent issues never collide. Returns a formatted
 * number like "INV/2026-2027/0001".
 */
export async function allocateInvoiceNumber(
  conn: PoolConnection,
  organizationId: string,
  opts: { direction: "incoming" | "outgoing"; series?: string; financialYear: string; prefix?: string },
): Promise<string> {
  const series = opts.series ?? "DEFAULT";
  const prefix = opts.prefix ?? "INV";

  const [rows] = await conn.query(
    "SELECT * FROM `invoice_sequences` WHERE organization_id=? AND direction=? AND series=? AND financial_year=? FOR UPDATE",
    [organizationId, opts.direction, series, opts.financialYear],
  );
  let seq = (rows as { id: string; next_number: number; prefix: string; padding: number }[])[0];

  if (!seq) {
    const id = createId();
    await conn.query(
      "INSERT INTO `invoice_sequences` (`id`,`organization_id`,`direction`,`series`,`financial_year`,`prefix`,`next_number`,`padding`) " +
        "VALUES (?,?,?,?,?,?,?,?)",
      [id, organizationId, opts.direction, series, opts.financialYear, prefix, 1, 4],
    );
    seq = { id, next_number: 1, prefix, padding: 4 };
  }

  const number = seq.next_number;
  await conn.query("UPDATE `invoice_sequences` SET `next_number`=? WHERE id=?", [number + 1, seq.id]);

  const padded = String(number).padStart(seq.padding, "0");
  return `${seq.prefix}/${opts.financialYear}/${padded}`;
}
