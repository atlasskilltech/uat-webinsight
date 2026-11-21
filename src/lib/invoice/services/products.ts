import "server-only";
import { iQuery, iQueryOne, iExecute } from "../db";
import { logInvoiceAudit } from "../audit";
import { createId } from "@/lib/id";
import type { ProductInput } from "../validation";

export interface ProductRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  sku: string | null;
  unit: string | null;
  default_price: string;
  default_gst_rate: string;
  hsn_sac: string | null;
  currency: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function listProducts(
  organizationId: string,
  opts: { q?: string; activeOnly?: boolean } = {},
): Promise<ProductRow[]> {
  const where: string[] = ["organization_id = ?", "deleted_at IS NULL"];
  const params: unknown[] = [organizationId];
  if (opts.activeOnly) where.push("is_active = 1");
  if (opts.q) {
    where.push("(name LIKE ? OR sku LIKE ? OR hsn_sac LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  return iQuery<ProductRow>(
    `SELECT * FROM \`products_services\` WHERE ${where.join(" AND ")} ORDER BY name ASC LIMIT 500`,
    params,
  );
}

export async function getProduct(organizationId: string, id: string): Promise<ProductRow | null> {
  return iQueryOne<ProductRow>(
    "SELECT * FROM `products_services` WHERE organization_id=? AND id=? AND deleted_at IS NULL",
    [organizationId, id],
  );
}

export async function createProduct(
  organizationId: string,
  actor: { id: string; email: string },
  input: ProductInput,
): Promise<string> {
  const id = createId();
  await iExecute(
    "INSERT INTO `products_services` " +
      "(`id`,`organization_id`,`name`,`description`,`sku`,`unit`,`default_price`,`default_gst_rate`,`hsn_sac`) " +
      "VALUES (?,?,?,?,?,?,?,?,?)",
    [
      id,
      organizationId,
      input.name,
      input.description ?? null,
      input.sku ?? null,
      input.unit ?? null,
      input.defaultPrice,
      input.defaultGstRate,
      input.hsnSac ?? null,
    ],
  );
  await logInvoiceAudit({
    organizationId,
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "product.created",
    entityType: "product_service",
    entityId: id,
    after: { name: input.name, defaultPrice: input.defaultPrice },
  });
  return id;
}

export async function updateProduct(
  organizationId: string,
  id: string,
  actor: { id: string; email: string },
  input: ProductInput,
): Promise<void> {
  await iExecute(
    "UPDATE `products_services` SET `name`=?,`description`=?,`sku`=?,`unit`=?,`default_price`=?," +
      "`default_gst_rate`=?,`hsn_sac`=? WHERE organization_id=? AND id=?",
    [
      input.name,
      input.description ?? null,
      input.sku ?? null,
      input.unit ?? null,
      input.defaultPrice,
      input.defaultGstRate,
      input.hsnSac ?? null,
      organizationId,
      id,
    ],
  );
  await logInvoiceAudit({
    organizationId,
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "product.updated",
    entityType: "product_service",
    entityId: id,
  });
}

export async function setProductActive(
  organizationId: string,
  id: string,
  active: boolean,
  actor: { id: string; email: string },
): Promise<void> {
  await iExecute("UPDATE `products_services` SET `is_active`=? WHERE organization_id=? AND id=?", [
    active,
    organizationId,
    id,
  ]);
  await logInvoiceAudit({
    organizationId,
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: active ? "product.activated" : "product.deactivated",
    entityType: "product_service",
    entityId: id,
  });
}
