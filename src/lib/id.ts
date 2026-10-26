/**
 * Generate a collision-resistant, URL-safe id for primary keys.
 *
 * Replaces Prisma's `@default(cuid())`. Ids are opaque strings stored in
 * VARCHAR(191) columns, so any unique string works; we use a timestamp prefix
 * plus random bytes for roughly sortable, compact values.
 */
import { randomBytes } from "node:crypto";

export function createId(): string {
  const time = Date.now().toString(36);
  const rand = randomBytes(10).toString("hex");
  return `${time}${rand}`;
}
