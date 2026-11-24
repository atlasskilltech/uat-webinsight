import { describe, it, expect } from "vitest";
import { normalizeGstin, normalizeOptionalText } from "@/lib/invoice/services/org-admin";

describe("org-admin: GSTIN / optional-text normalization", () => {
  it("collapses empty and whitespace-only GSTIN to NULL (never stores \"\")", () => {
    expect(normalizeGstin("")).toBeNull();
    expect(normalizeGstin("   ")).toBeNull();
    expect(normalizeGstin("\t\n")).toBeNull();
    expect(normalizeGstin(null)).toBeNull();
    expect(normalizeGstin(undefined)).toBeNull();
  });

  it("trims and uppercases a real GSTIN", () => {
    expect(normalizeGstin("  27aaaaa0000a1z5 ")).toBe("27AAAAA0000A1Z5");
    expect(normalizeGstin("27AAAAA0000A1Z5")).toBe("27AAAAA0000A1Z5");
  });

  it("normalizes optional text the same way (empty -> NULL, trimmed)", () => {
    expect(normalizeOptionalText("")).toBeNull();
    expect(normalizeOptionalText("   ")).toBeNull();
    expect(normalizeOptionalText(null)).toBeNull();
    expect(normalizeOptionalText("  Atlas SkillTech  ")).toBe("Atlas SkillTech");
  });
});
