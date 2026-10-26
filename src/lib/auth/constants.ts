/**
 * The designated initial administrator. Only this verified Google identity can
 * be promoted to Admin through the one-time bootstrap (and only while no active
 * admin exists yet). Overridable via env for recovery, but defaults to the
 * designated account.
 */
export const BOOTSTRAP_ADMIN_EMAIL = (
  process.env.BOOTSTRAP_ADMIN_EMAIL ?? "tech@atlasuniversity.edu.in"
).toLowerCase();
