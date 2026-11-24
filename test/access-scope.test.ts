import { describe, it, expect } from "vitest";
import {
  normalizeAccessScope,
  isPathAllowedForScope,
  ACCESS_SCOPE_OPTIONS,
} from "@/lib/auth/access";
import { NAV_ITEMS } from "@/lib/nav";

describe("access scope: defaults & normalization", () => {
  it("defaults unknown / null / legacy values to full (existing users keep full access)", () => {
    expect(normalizeAccessScope(undefined)).toBe("full");
    expect(normalizeAccessScope(null)).toBe("full");
    expect(normalizeAccessScope("")).toBe("full");
    expect(normalizeAccessScope("something-else")).toBe("full");
  });
  it("recognizes invoice_only", () => {
    expect(normalizeAccessScope("invoice_only")).toBe("invoice_only");
  });
  it("offers exactly the two documented options", () => {
    expect(ACCESS_SCOPE_OPTIONS.map((o) => o.value)).toEqual(["full", "invoice_only"]);
  });
});

describe("access scope: full access reaches everything", () => {
  for (const p of ["/", "/invoices", "/invoices/settings", "/seo", "/reports", "/work", "/admin/users", "/settings"]) {
    it(`full access allows ${p}`, () => {
      expect(isPathAllowedForScope("full", p)).toBe(true);
    });
  }
});

describe("access scope: invoice_only is restricted to the Invoice Agent", () => {
  it("ALLOWS the Invoice Agent pages", () => {
    expect(isPathAllowedForScope("invoice_only", "/invoices")).toBe(true);
    expect(isPathAllowedForScope("invoice_only", "/invoices/email-accounts")).toBe(true);
    expect(isPathAllowedForScope("invoice_only", "/invoices/settings")).toBe(true);
    expect(isPathAllowedForScope("invoice_only", "/invoices/anything/deep")).toBe(true);
  });

  it("BLOCKS every other module (direct-URL access)", () => {
    for (const p of ["/", "/seo", "/analytics", "/reports", "/work", "/issues", "/inspector", "/operations", "/competitors", "/settings", "/admin/users"]) {
      expect(isPathAllowedForScope("invoice_only", p)).toBe(false);
    }
  });

  it("does not match a lookalike prefix (/invoicesX is NOT under /invoices)", () => {
    expect(isPathAllowedForScope("invoice_only", "/invoicesX")).toBe(false);
  });
});

describe("access scope: sidebar navigation filtering", () => {
  // Mirrors the sidebar filter: invoice_only shows all allowed invoice items
  // (adminOnly doesn't hide the user's own module); full-access keeps adminOnly.
  const navFor = (scope: "full" | "invoice_only", isAdmin: boolean) =>
    NAV_ITEMS.filter((i) => {
      if (!isPathAllowedForScope(scope, i.href)) return false;
      if (scope === "invoice_only") return true;
      return !i.adminOnly || isAdmin;
    }).map((i) => i.href);

  it("invoice_only sees ONLY the Invoice Agent group", () => {
    expect(navFor("invoice_only", false).sort()).toEqual(
      ["/invoices", "/invoices/email-accounts", "/invoices/settings"].sort(),
    );
    // Even an admin on invoice_only does not see User Management or other modules.
    expect(navFor("invoice_only", true).sort()).toEqual(
      ["/invoices", "/invoices/email-accounts", "/invoices/settings"].sort(),
    );
  });

  it("full access is unchanged — all non-admin modules visible, admin sees User Management", () => {
    const full = navFor("full", false);
    expect(full).toContain("/");
    expect(full).toContain("/seo");
    expect(full).toContain("/invoices");
    expect(full).not.toContain("/admin/users"); // adminOnly hidden for non-admins
    expect(navFor("full", true)).toContain("/admin/users");
  });
});
