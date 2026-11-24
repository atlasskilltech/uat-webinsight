import { describe, it, expect } from "vitest";
import { activeNavItem, NAV_ITEMS } from "@/lib/nav";

/**
 * Sidebar active-state: exactly ONE nav item highlights per path (the deepest
 * longest-prefix match), so a parent like /invoices is never active together
 * with a child like /invoices/email-accounts or /invoices/settings.
 */
describe("nav: active item (sidebar highlight)", () => {
  it("highlights only the Executive Dashboard on /", () => {
    expect(activeNavItem("/")?.href).toBe("/");
  });

  it("highlights only Invoice Agent on /invoices", () => {
    expect(activeNavItem("/invoices")?.href).toBe("/invoices");
  });

  it("highlights only Connected Accounts on /invoices/email-accounts (NOT the parent)", () => {
    expect(activeNavItem("/invoices/email-accounts")?.href).toBe("/invoices/email-accounts");
  });

  it("highlights only Agent Settings on /invoices/settings (NOT the parent)", () => {
    expect(activeNavItem("/invoices/settings")?.href).toBe("/invoices/settings");
  });

  it("handles NESTED routes — a sub-page highlights its closest nav item", () => {
    expect(activeNavItem("/invoices/settings/anything")?.href).toBe("/invoices/settings");
    expect(activeNavItem("/work/123")?.href).toBe("/work");
    // A route under /invoices with no dedicated child nav falls back to the parent.
    expect(activeNavItem("/invoices/review")?.href).toBe("/invoices");
  });

  it("matches on a path-SEGMENT boundary (no false prefix match)", () => {
    // '/invoicesX' must NOT be treated as under '/invoices'.
    expect(activeNavItem("/invoicesX")?.href).not.toBe("/invoices");
  });

  it("never returns more than one active item (deepest wins)", () => {
    const path: string = "/invoices/settings";
    const matches = NAV_ITEMS.filter((i) =>
      i.href === "/" ? path === "/" : path === i.href || path.startsWith(`${i.href}/`),
    );
    // Both /invoices and /invoices/settings are prefixes, but the resolver picks one.
    expect(matches.length).toBeGreaterThan(1);
    expect(activeNavItem(path)?.href).toBe("/invoices/settings");
  });
});
