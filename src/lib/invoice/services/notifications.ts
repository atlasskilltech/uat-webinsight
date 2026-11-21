import "server-only";
import { iQuery, iExecute, ijson } from "../db";
import { createId } from "@/lib/id";

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: Date | null;
  created_at: Date;
}

export async function orgMemberUserIds(organizationId: string): Promise<{ id: string; email: string }[]> {
  return iQuery<{ id: string; email: string }>(
    "SELECT `user_id` AS id, `user_email` AS email FROM `organization_members` WHERE organization_id=? AND status='active'",
    [organizationId],
  );
}

export async function createNotification(
  organizationId: string,
  userId: string,
  n: { type: string; title: string; body?: string; link?: string; payload?: unknown },
): Promise<void> {
  await iExecute(
    "INSERT INTO `notifications` (`id`,`organization_id`,`user_id`,`type`,`title`,`body`,`link`,`payload`) VALUES (?,?,?,?,?,?,?,?)",
    [createId(), organizationId, userId, n.type, n.title.slice(0, 191), n.body ?? null, n.link ?? null, ijson(n.payload ?? null)],
  );
}

/** Notify every active member of an organization. */
export async function notifyOrg(
  organizationId: string,
  n: { type: string; title: string; body?: string; link?: string; payload?: unknown },
): Promise<number> {
  const members = await orgMemberUserIds(organizationId);
  for (const m of members) await createNotification(organizationId, m.id, n);
  return members.length;
}

export async function listNotifications(organizationId: string, userId: string, limit = 20): Promise<NotificationRow[]> {
  return iQuery<NotificationRow>(
    "SELECT id, type, title, body, link, read_at, created_at FROM `notifications` WHERE organization_id=? AND user_id=? ORDER BY created_at DESC LIMIT ?",
    [organizationId, userId, limit],
  );
}

export async function unreadCount(organizationId: string, userId: string): Promise<number> {
  const rows = await iQuery<{ c: number }>(
    "SELECT COUNT(*) c FROM `notifications` WHERE organization_id=? AND user_id=? AND read_at IS NULL",
    [organizationId, userId],
  );
  return Number(rows[0]?.c ?? 0);
}

export async function markNotificationsRead(organizationId: string, userId: string, id?: string): Promise<void> {
  if (id) {
    await iExecute("UPDATE `notifications` SET read_at=NOW(3) WHERE organization_id=? AND user_id=? AND id=? AND read_at IS NULL", [organizationId, userId, id]);
  } else {
    await iExecute("UPDATE `notifications` SET read_at=NOW(3) WHERE organization_id=? AND user_id=? AND read_at IS NULL", [organizationId, userId]);
  }
}
