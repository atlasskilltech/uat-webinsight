import { describe, it, expect } from "vitest";
import { DEFAULT_POS, GAP, anchoredStyle, toAnchored, clampAnchored, isAnchored } from "@/lib/web-agent/anchor";

/**
 * Edge-anchored widget placement: the floating agent must stay put and visible
 * through window resize / minimise / maximise (it was drifting off-screen when
 * stored as an absolute top-left). These verify the pure geometry.
 */

const VW = 1440, VH = 900; // a "big" screen
const PANEL_W = 480, PANEL_H = 672;

describe("web-agent widget anchoring", () => {
  it("default is bottom-right", () => {
    expect(DEFAULT_POS).toEqual({ hx: "right", x: 20, vy: "bottom", y: 20 });
    const s = anchoredStyle(DEFAULT_POS);
    expect(s).toMatchObject({ right: 20, bottom: 20, left: "auto", top: "auto" });
  });

  it("anchors to the nearest corner (bottom-right stays bottom-right)", () => {
    // drop the panel near the bottom-right corner
    const a = toAnchored(VW - PANEL_W - 20, VH - PANEL_H - 20, PANEL_W, PANEL_H, VW, VH);
    expect(a.hx).toBe("right");
    expect(a.vy).toBe("bottom");
    expect(a.x).toBe(20);
    expect(a.y).toBe(20);
  });

  it("anchors to top-left when dropped there", () => {
    const a = toAnchored(16, 24, PANEL_W, PANEL_H, VW, VH);
    expect(a).toMatchObject({ hx: "left", vy: "top", x: 16, y: 24 });
  });

  it("clamps an off-screen drop back inside the viewport (GAP margin)", () => {
    const a = toAnchored(99999, 99999, PANEL_W, PANEL_H, VW, VH); // way past bottom-right
    const s = anchoredStyle(a);
    expect(a.hx).toBe("right");
    expect(a.vy).toBe("bottom");
    expect(a.x).toBe(GAP); // pinned to the corner with a GAP margin, not off-screen
    expect(a.y).toBe(GAP);
    expect(s.right).toBe(GAP);
  });

  it("re-clamps so a big-screen position stays visible on a small screen", () => {
    const H = 400; // a panel that fits the small viewport vertically
    // user parked it 600px from the LEFT on a wide screen…
    const wide = toAnchored(600, 200, PANEL_W, H, 1920, 1080);
    expect(wide.hx).toBe("left");
    expect(wide.x).toBe(600);
    // …then the window shrinks to 800×600: the left offset must shrink so the
    // panel (480 wide) still fits with a GAP margin.
    const small = clampAnchored(wide, PANEL_W, H, 800, 600);
    expect(small.x).toBeLessThanOrEqual(800 - PANEL_W - GAP);
    expect(small.x).toBeGreaterThanOrEqual(GAP);
    expect(small.y).toBeLessThanOrEqual(600 - H - GAP);
  });

  it("clamp never pushes a corner-anchored widget off a small screen", () => {
    // bottom-right at 20px stays 20px on any size that can hold it
    const a = clampAnchored(DEFAULT_POS, 56, 56, 360, 640); // small phone + launcher size
    expect(a).toEqual(DEFAULT_POS);
  });

  it("isAnchored accepts the new format and rejects the old {x,y} one", () => {
    expect(isAnchored({ hx: "right", x: 20, vy: "bottom", y: 20 })).toBe(true);
    expect(isAnchored({ x: 100, y: 200 })).toBe(false); // old absolute format → ignored
    expect(isAnchored(null)).toBe(false);
  });
});
